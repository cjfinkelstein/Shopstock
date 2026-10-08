import os
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.auth import get_current_user, require_admin
from app.config import settings
from app.database import get_db
from app.models import ClockEvent, ClockOutPhoto, Job, LocationPing, User, utcnow
from app.schemas import (
    ClockInIn, ClockOutIn, ClockOutPhotoOut, ClockStatusOut, LocationPingIn, MyShiftOut, RoutePoint, ShiftRouteOut,
    WorkerLiveOut,
)

router = APIRouter(prefix="/time", tags=["time"])

# Only real photo types -- rejects anything else (a PDF, a video, a
# disguised script) before it's ever written to disk.
_PHOTO_EXTENSIONS = {
    "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
    "image/heic": ".heic", "image/heif": ".heif",
}


def _open_event(db: Session, user_id: int) -> ClockEvent | None:
    return (
        db.query(ClockEvent)
        .filter(ClockEvent.user_id == user_id, ClockEvent.clock_out_at.is_(None))
        .order_by(ClockEvent.clock_in_at.desc())
        .first()
    )


def _status_for(ev: ClockEvent | None, *, consented: bool) -> ClockStatusOut:
    if not ev:
        return ClockStatusOut(clocked_in=False, gps_consent_given=consented)
    return ClockStatusOut(
        clocked_in=True,
        clock_event_id=ev.id,
        clock_in_at=ev.clock_in_at,
        job_id=ev.job_id,
        job_number=ev.job.job_number if ev.job else None,
        job_name=ev.job.name if ev.job else None,
        approval_status=ev.approval_status,
        gps_consent_given=consented,
    )


@router.get("/status", response_model=ClockStatusOut)
def status(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ev = _open_event(db, user.id)
    return _status_for(ev, consented=user.gps_consent_at is not None)


@router.post("/gps-consent", response_model=ClockStatusOut)
def gps_consent(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """One-time, permanent record that this tech was shown and agreed to the
    GPS-while-clocked-in notice. Never cleared once set."""
    if user.role != "tech":
        raise HTTPException(status_code=400, detail="Only field techs need to agree to this")
    if user.gps_consent_at is None:
        user.gps_consent_at = utcnow()
        db.commit()
    ev = _open_event(db, user.id)
    return _status_for(ev, consented=True)


@router.post("/clock-in", response_model=ClockStatusOut)
def clock_in(body: ClockInIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role != "tech":
        raise HTTPException(status_code=400, detail="Only field techs clock in")
    if user.gps_consent_at is None:
        raise HTTPException(status_code=403, detail="You must agree to GPS tracking before clocking in")
    if _open_event(db, user.id):
        raise HTTPException(status_code=400, detail="Already clocked in")
    job = db.get(Job, body.job_id)
    if not job or job.status != "active":
        raise HTTPException(status_code=400, detail="Pick a job to clock into")
    ev = ClockEvent(user_id=user.id, job_id=job.id, clock_in_lat=body.lat, clock_in_lng=body.lng)
    db.add(ev)
    db.commit()
    return _status_for(ev, consented=True)


@router.post("/clock-out", response_model=ClockStatusOut)
def clock_out(body: ClockOutIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ev = _open_event(db, user.id)
    if not ev:
        raise HTTPException(status_code=400, detail="Not clocked in")
    ev.clock_out_at = utcnow()
    ev.clock_out_lat = body.lat
    ev.clock_out_lng = body.lng
    ev.clock_out_note = body.note
    db.commit()
    return ClockStatusOut(clocked_in=False)


@router.post("/clock-out/photos", response_model=ClockOutPhotoOut, status_code=201)
async def upload_clock_out_photo(
    file: UploadFile = File(...),
    caption: str | None = Form(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Attaches a photo (with an optional caption) to the tech's currently
    open shift -- uploaded while the clock-out sheet is still open, before
    the final clock-out call, so there's always a stable clock_event_id to
    attach to. No offline queueing here (unlike clock in/out/pings): a
    multipart upload is a much bigger thing to replay reliably than a small
    JSON body, so this just fails with a clear error if there's no signal
    rather than silently queuing."""
    ev = _open_event(db, user.id)
    if not ev:
        raise HTTPException(status_code=400, detail="Not clocked in")
    ext = _PHOTO_EXTENSIONS.get(file.content_type or "")
    if not ext:
        raise HTTPException(status_code=400, detail="Only photo uploads are allowed")
    data = await file.read()
    if len(data) > settings.max_photo_bytes:
        raise HTTPException(status_code=400, detail="Photo is too large")

    rel_dir = f"clock_photos/{ev.id}"
    os.makedirs(os.path.join(settings.uploads_dir, rel_dir), exist_ok=True)
    rel_path = f"{rel_dir}/{uuid.uuid4().hex}{ext}"
    with open(os.path.join(settings.uploads_dir, rel_path), "wb") as f:
        f.write(data)

    photo = ClockOutPhoto(
        clock_event_id=ev.id, uploaded_by=user.id,
        caption=(caption or "").strip() or None,
        file_path=rel_path, content_type=file.content_type,
    )
    db.add(photo)
    db.commit()
    db.refresh(photo)
    return ClockOutPhotoOut(id=photo.id, caption=photo.caption, url=f"/time/photos/{photo.id}", created_at=photo.created_at)


@router.get("/photos/{photo_id}")
def get_clock_out_photo(photo_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Admin can see any photo (same as clock_out_note); a tech can only
    ever see their own -- never another tech's clock-out photos."""
    photo = db.get(ClockOutPhoto, photo_id)
    if not photo:
        raise HTTPException(status_code=404, detail="Not found")
    if user.role != "admin" and photo.uploaded_by != user.id:
        raise HTTPException(status_code=403, detail="Not allowed")
    full_path = os.path.join(settings.uploads_dir, photo.file_path)
    if not os.path.isfile(full_path):
        raise HTTPException(status_code=404, detail="Photo file missing")
    return FileResponse(full_path, media_type=photo.content_type)


@router.post("/ping", status_code=204)
def ping(body: LocationPingIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    # Idempotency: a retried offline-queued ping (same client_ref) replays as
    # a no-op instead of writing a duplicate point into the shift's route.
    if body.client_ref:
        existing = db.scalars(
            select(LocationPing).where(LocationPing.client_ref == body.client_ref)
        ).first()
        if existing is not None:
            return
    ev = _open_event(db, user.id)
    if not ev:
        raise HTTPException(status_code=400, detail="Not clocked in")
    ping_row = LocationPing(
        clock_event_id=ev.id,
        user_id=user.id,
        lat=body.lat,
        lng=body.lng,
        client_ref=body.client_ref,
        **({"recorded_at": body.recorded_at} if body.recorded_at is not None else {}),
    )
    db.add(ping_row)
    if body.client_ref:
        # Guards the race where two requests with the same client_ref flush
        # at once -- the unique index catches it, and we treat the loser as
        # the no-op replay instead of raising.
        try:
            with db.begin_nested():
                db.flush()
        except IntegrityError:
            pass
    db.commit()


@router.get("/my-shifts", response_model=list[MyShiftOut])
def my_shifts(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """A tech's own clock-in/out history -- never another tech's."""
    events = (
        db.query(ClockEvent)
        .options(joinedload(ClockEvent.job))
        .filter(ClockEvent.user_id == user.id)
        .order_by(ClockEvent.clock_in_at.desc())
        .limit(200)
        .all()
    )
    now = utcnow()
    return [
        MyShiftOut(
            id=e.id,
            clock_in_at=e.clock_in_at,
            clock_out_at=e.clock_out_at,
            still_clocked_in=e.clock_out_at is None,
            hours=round(((e.clock_out_at or now) - e.clock_in_at).total_seconds() / 3600, 2),
            job_number=e.job.job_number if e.job else None,
            job_name=e.job.name if e.job else None,
            approval_status=e.approval_status,
        )
        for e in events
    ]


@router.get("/live", response_model=list[WorkerLiveOut])
def live(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    events = db.query(ClockEvent).filter(ClockEvent.clock_out_at.is_(None)).all()
    out = []
    for ev in events:
        last_ping = (
            db.query(LocationPing)
            .filter(LocationPing.clock_event_id == ev.id)
            .order_by(LocationPing.recorded_at.desc())
            .first()
        )
        out.append(
            WorkerLiveOut(
                user_id=ev.user_id,
                user_name=ev.user.name,
                job_number=ev.job.job_number if ev.job else None,
                job_name=ev.job.name if ev.job else None,
                clock_in_at=ev.clock_in_at,
                approval_status=ev.approval_status,
                lat=last_ping.lat if last_ping else ev.clock_in_lat,
                lng=last_ping.lng if last_ping else ev.clock_in_lng,
                last_ping_at=last_ping.recorded_at if last_ping else None,
            )
        )
    return out


@router.get("/{event_id}/route", response_model=ShiftRouteOut)
def shift_route(event_id: int, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    """Every GPS point recorded for one shift, in order: where a tech clocked
    in, every periodic ping while they were on the clock, and where they
    clocked out -- the full trail an admin can trace on a map."""
    ev = db.get(ClockEvent, event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Shift not found")

    points: list[RoutePoint] = []
    if ev.clock_in_lat is not None and ev.clock_in_lng is not None:
        points.append(RoutePoint(lat=ev.clock_in_lat, lng=ev.clock_in_lng, at=ev.clock_in_at, kind="clock_in"))

    pings = (
        db.query(LocationPing)
        .filter(LocationPing.clock_event_id == event_id)
        .order_by(LocationPing.recorded_at)
        .all()
    )
    points.extend(RoutePoint(lat=p.lat, lng=p.lng, at=p.recorded_at, kind="ping") for p in pings)

    if ev.clock_out_at is not None and ev.clock_out_lat is not None and ev.clock_out_lng is not None:
        points.append(RoutePoint(lat=ev.clock_out_lat, lng=ev.clock_out_lng, at=ev.clock_out_at, kind="clock_out"))

    return ShiftRouteOut(
        user_name=ev.user.name,
        job_number=ev.job.job_number if ev.job else None,
        job_name=ev.job.name if ev.job else None,
        clock_in_at=ev.clock_in_at,
        clock_out_at=ev.clock_out_at,
        points=points,
    )


def _shift_out(ev: ClockEvent) -> MyShiftOut:
    now = utcnow()
    return MyShiftOut(
        id=ev.id,
        clock_in_at=ev.clock_in_at,
        clock_out_at=ev.clock_out_at,
        still_clocked_in=ev.clock_out_at is None,
        hours=round(((ev.clock_out_at or now) - ev.clock_in_at).total_seconds() / 3600, 2),
        job_number=ev.job.job_number if ev.job else None,
        job_name=ev.job.name if ev.job else None,
        approval_status=ev.approval_status,
    )


@router.post("/{event_id}/approve", response_model=MyShiftOut)
def approve_shift(event_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    ev = db.get(ClockEvent, event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Shift not found")
    ev.approval_status = "approved"
    ev.approved_by_id = admin.id
    ev.approved_at = utcnow()
    db.commit()
    return _shift_out(ev)


@router.post("/{event_id}/unapprove", response_model=MyShiftOut)
def unapprove_shift(event_id: int, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    """Reverts an approval -- for undoing a mistaken click."""
    ev = db.get(ClockEvent, event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Shift not found")
    ev.approval_status = "pending"
    ev.approved_by_id = None
    ev.approved_at = None
    db.commit()
    return _shift_out(ev)
