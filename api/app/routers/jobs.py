import csv
import io
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, defer, joinedload

from app.auth import get_current_user, require_admin
from app.database import get_db
from app.models import Job, JobFile, Location, Transaction, User, Vendor
from app.schemas import (
    JobActivityLine, JobCreate, JobFileIn, JobFileMetaOut, JobFileOut, JobMaterialLine, JobMaterialsOut, JobOut,
    JobUpdate,
)

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.get("", response_model=list[JobOut])
def list_jobs(status: str = "", search: str = "", db: Session = Depends(get_db),
              user: User = Depends(get_current_user)):
    q = db.query(Job)
    if status:
        q = q.filter(Job.status == status)
    if search:
        like = f"%{search.strip()}%"
        q = q.filter(or_(Job.job_number.ilike(like), Job.name.ilike(like), Job.customer.ilike(like)))
    return q.order_by(Job.status, Job.job_number.desc()).all()


@router.get("/recent", response_model=list[JobOut])
def recent_jobs(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """The 5 active jobs this user most recently signed material out to — powers the job picker."""
    rows = db.execute(
        select(Transaction.job_id, Transaction.created_at)
        .where(Transaction.user_id == user.id, Transaction.job_id.isnot(None))
        .order_by(Transaction.created_at.desc(), Transaction.id.desc())
        .limit(200)
    ).all()
    seen: list[int] = []
    for job_id, _ in rows:
        if job_id not in seen:
            seen.append(job_id)
        if len(seen) >= 5:
            break
    if not seen:
        return []
    jobs = db.query(Job).filter(Job.id.in_(seen), Job.status == "active").all()
    by_id = {j.id: j for j in jobs}
    return [by_id[i] for i in seen if i in by_id]


@router.get("/{job_id}", response_model=JobOut)
def get_job(job_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


def _source_label(loc: Location | None) -> str:
    if not loc:
        return "Stock"
    return "Stock" if loc.type == "shop" else loc.name


def _job_materials(db: Session, job: Job) -> JobMaterialsOut:
    """Grouped by (item, source location) -- SIGN_OUT's from_location and
    RETURN's to_location both describe "the truck or stock this movement
    touched", so a return nets against the same source bucket it came from."""
    txns = (
        db.query(Transaction)
        .options(joinedload(Transaction.item), joinedload(Transaction.from_location),
                 joinedload(Transaction.to_location), joinedload(Transaction.user))
        .filter(Transaction.job_id == job.id, Transaction.type.in_(["SIGN_OUT", "RETURN"]))
        .all()
    )

    item_ids = {t.item_id for t in txns}
    vendors_by_item: dict[int, str] = {}
    if item_ids:
        vendor_names: dict[int, list[str]] = {}
        for iid, vname in (
            db.query(Transaction.item_id, Vendor.name)
            .join(Vendor, Transaction.vendor_id == Vendor.id)
            .filter(Transaction.type == "RECEIVE", Transaction.item_id.in_(item_ids))
            .distinct()
            .all()
        ):
            vendor_names.setdefault(iid, []).append(vname)
        vendors_by_item = {iid: ", ".join(sorted(names)) for iid, names in vendor_names.items()}

    agg: dict[tuple, dict] = {}
    for t in txns:
        loc = t.from_location if t.type == "SIGN_OUT" else t.to_location
        key = (t.item_id, loc.id if loc else None)
        line = agg.setdefault(key, {
            "item": t.item, "source": _source_label(loc),
            "out_qty": Decimal("0"), "ret_qty": Decimal("0"),
            "out_cost": Decimal("0"), "ret_cost": Decimal("0"),
            "last_at": t.created_at,
        })
        cost = (t.unit_cost or Decimal("0")) * t.qty
        if t.type == "SIGN_OUT":
            line["out_qty"] += t.qty
            line["out_cost"] += cost
        else:
            line["ret_qty"] += t.qty
            line["ret_cost"] += cost
        if t.created_at > line["last_at"]:
            line["last_at"] = t.created_at
    rows = []
    total = Decimal("0")
    for data in agg.values():
        item = data["item"]
        net_qty = data["out_qty"] - data["ret_qty"]
        net_cost = (data["out_cost"] - data["ret_cost"]).quantize(Decimal("0.01"))
        avg_snap = (net_cost / net_qty).quantize(Decimal("0.0001")) if net_qty else Decimal("0")
        total += net_cost
        rows.append((data["last_at"], JobMaterialLine(
            item_id=item.id, sku=item.sku, name=item.name, unit=item.unit,
            image_data=item.image_data, source=data["source"],
            vendor=vendors_by_item.get(item.id),
            qty_signed_out=data["out_qty"], qty_returned=data["ret_qty"],
            net_qty=net_qty, avg_snapshot_cost=avg_snap, net_cost=net_cost,
        )))
    rows.sort(key=lambda r: r[0], reverse=True)  # most recent activity first
    lines = [r[1] for r in rows]

    activity = [
        JobActivityLine(
            id=t.id, created_at=t.created_at, type=t.type,
            sku=t.item.sku, item_name=t.item.name, unit=t.item.unit,
            image_data=t.item.image_data, qty=t.qty,
            source=_source_label(t.from_location if t.type == "SIGN_OUT" else t.to_location),
            vendor=vendors_by_item.get(t.item_id),
            user_name=t.user.name if t.user else "?",
        )
        for t in sorted(txns, key=lambda t: t.created_at, reverse=True)
    ]

    return JobMaterialsOut(job=JobOut.model_validate(job), lines=lines, activity=activity,
                           total_cost=total.quantize(Decimal("0.01")))


@router.get("/{job_id}/materials", dependencies=[Depends(require_admin)])
def job_materials(job_id: int, format: str = "", db: Session = Depends(get_db)):
    """Itemized usage + total cost — the billing recovery view. Admin only (costs)."""
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    out = _job_materials(db, job)
    if format == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["SKU", "Item", "Source", "Vendor", "Unit", "Signed Out", "Returned", "Net Qty", "Avg Cost", "Net Cost"])
        for l in out.lines:
            w.writerow([l.sku, l.name, l.source, l.vendor or "", l.unit, l.qty_signed_out, l.qty_returned,
                        l.net_qty, l.avg_snapshot_cost, l.net_cost])
        w.writerow([])
        w.writerow(["", "", "", "", "", "", "", "", "TOTAL", out.total_cost])
        buf.seek(0)
        return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers={
            "Content-Disposition": f'attachment; filename="{job.job_number}-materials.csv"'})
    return out


@router.post("", response_model=JobOut, status_code=201, dependencies=[Depends(require_admin)])
def create_job(body: JobCreate, db: Session = Depends(get_db)):
    if db.query(Job).filter(Job.job_number == body.job_number.strip()).first():
        raise HTTPException(status_code=400, detail="Job number already exists")
    job = Job(job_number=body.job_number.strip(), name=body.name.strip(),
              customer=body.customer, address=body.address, status="active")
    db.add(job)
    db.commit()
    return job


@router.patch("/{job_id}", response_model=JobOut, dependencies=[Depends(require_admin)])
def update_job(job_id: int, body: JobUpdate, db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    data = body.model_dump(exclude_unset=True)
    if "job_number" in data:
        dupe = db.query(Job).filter(Job.job_number == data["job_number"].strip(),
                                    Job.id != job_id).first()
        if dupe:
            raise HTTPException(status_code=400, detail="Job number already exists")
        data["job_number"] = data["job_number"].strip()
    for field, value in data.items():
        setattr(job, field, value)
    db.commit()
    return job


def _file_out(f: JobFile) -> JobFileOut:
    return JobFileOut(
        id=f.id, job_id=f.job_id, kind=f.kind, filename=f.filename, mime_type=f.mime_type, data=f.data,
        uploaded_by_name=f.uploader.name if f.uploader else None,
        created_at=f.created_at, updated_at=f.updated_at,
    )


def _file_meta_out(f: JobFile, size_bytes: int) -> JobFileMetaOut:
    return JobFileMetaOut(
        id=f.id, job_id=f.job_id, kind=f.kind, filename=f.filename, mime_type=f.mime_type, size_bytes=size_bytes,
        uploaded_by_name=f.uploader.name if f.uploader else None,
        created_at=f.created_at, updated_at=f.updated_at,
    )


@router.get("/{job_id}/files", response_model=list[JobFileMetaOut], dependencies=[Depends(require_admin)])
def list_job_files(job_id: int, db: Session = Depends(get_db)):
    if not db.get(Job, job_id):
        raise HTTPException(status_code=404, detail="Job not found")
    # `data` holds the full base64 file content and can be huge -- defer it here (Postgres
    # computes the length server-side via func.length) so listing a job with many/large
    # files can't balloon API memory. Fetch a single file's data via GET /jobs/files/{id}.
    rows = (
        db.query(JobFile, func.length(JobFile.data))
        .options(joinedload(JobFile.uploader), defer(JobFile.data))
        .filter(JobFile.job_id == job_id)
        .order_by(JobFile.created_at.desc())
        .all()
    )
    return [_file_meta_out(f, size_bytes) for f, size_bytes in rows]


@router.get("/files/{file_id}", response_model=JobFileOut, dependencies=[Depends(require_admin)])
def get_job_file(file_id: int, db: Session = Depends(get_db)):
    f = db.get(JobFile, file_id)
    if not f:
        raise HTTPException(status_code=404, detail="File not found")
    return _file_out(f)


@router.post("/{job_id}/files", response_model=JobFileOut, status_code=201, dependencies=[Depends(require_admin)])
def upload_job_file(job_id: int, body: JobFileIn, db: Session = Depends(get_db),
                    user: User = Depends(get_current_user)):
    if not db.get(Job, job_id):
        raise HTTPException(status_code=404, detail="Job not found")
    f = JobFile(
        job_id=job_id, kind=body.kind, filename=body.filename, mime_type=body.mime_type,
        data=body.data, uploaded_by=user.id,
    )
    db.add(f)
    db.commit()
    db.refresh(f)
    return _file_out(f)


@router.delete("/files/{file_id}", status_code=204, dependencies=[Depends(require_admin)])
def delete_job_file(file_id: int, db: Session = Depends(get_db)):
    f = db.get(JobFile, file_id)
    if f:
        db.delete(f)
        db.commit()
