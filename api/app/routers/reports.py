import csv
import io
from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.auth import require_admin
from app.database import get_db
from app.models import ClockEvent, Expense, Item, Job, JobRevenue, LoginEvent, Location, StockLevel, Transaction, User
from app.schemas import MissingRateUser, PnlJobRow, PnlOut, _utc_iso
from app.services.dates import day_end_utc, day_start_utc, to_local

router = APIRouter(prefix="/reports", tags=["reports"], dependencies=[Depends(require_admin)])


def _csv_response(filename: str, header: list, rows: list[list]) -> StreamingResponse:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    w.writerows(rows)
    buf.seek(0)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers={
        "Content-Disposition": f'attachment; filename="{filename}"'})


def _range_filter(q, date_from: str, date_to: str):
    if date_from:
        q = q.filter(Transaction.created_at >= day_start_utc(date_from))
    if date_to:
        q = q.filter(Transaction.created_at < day_end_utc(date_to))
    return q


@router.get("/calendar")
def calendar(date_from: str, date_to: str, db: Session = Depends(get_db)):
    """Per-day log of logins (tap-in / admin login), clock-in shifts (with
    hours worked), and material signed out, all shown in the shop's local
    display timezone."""
    days: dict[str, dict[str, list]] = {}

    def bucket(day: str) -> dict[str, list]:
        return days.setdefault(day, {"logins": [], "shifts": [], "sign_outs": []})

    def fmt_time(dt) -> str:
        # portable "8:03 AM" (no platform-specific %-I / %#I strftime flag)
        return dt.strftime("%I:%M %p").lstrip("0")

    logins = (
        db.query(LoginEvent)
        .options(joinedload(LoginEvent.user))
        .filter(LoginEvent.created_at >= day_start_utc(date_from), LoginEvent.created_at < day_end_utc(date_to))
        .all()
    )
    for ev in logins:
        local = to_local(ev.created_at)
        bucket(local.strftime("%Y-%m-%d"))["logins"].append({
            "time": fmt_time(local),
            "user_name": ev.user.name if ev.user else "?",
            "role": ev.role,
        })

    shifts = (
        db.query(ClockEvent)
        .options(joinedload(ClockEvent.user), joinedload(ClockEvent.job))
        .filter(ClockEvent.clock_in_at >= day_start_utc(date_from), ClockEvent.clock_in_at < day_end_utc(date_to))
        .all()
    )
    now = datetime.utcnow()
    for e in shifts:
        local = to_local(e.clock_in_at)
        bucket(local.strftime("%Y-%m-%d"))["shifts"].append({
            "id": e.id,
            "time": fmt_time(local),
            "user_name": e.user.name if e.user else "?",
            "job_number": e.job.job_number if e.job else None,
            "job_name": e.job.name if e.job else None,
            "clock_out_time": fmt_time(to_local(e.clock_out_at)) if e.clock_out_at else None,
            "still_clocked_in": e.clock_out_at is None,
            "hours": round(((e.clock_out_at or now) - e.clock_in_at).total_seconds() / 3600, 2),
            "approval_status": e.approval_status,
        })

    signouts = (
        db.query(Transaction)
        .options(joinedload(Transaction.item), joinedload(Transaction.user), joinedload(Transaction.job))
        .filter(Transaction.type == "SIGN_OUT")
        .filter(Transaction.created_at >= day_start_utc(date_from), Transaction.created_at < day_end_utc(date_to))
        .all()
    )
    for t in signouts:
        local = to_local(t.created_at)
        bucket(local.strftime("%Y-%m-%d"))["sign_outs"].append({
            "time": fmt_time(local),
            "item_name": t.item.name if t.item else "?",
            "sku": t.item.sku if t.item else None,
            "image_data": t.item.image_data if t.item else None,
            "qty": t.qty,
            "unit": t.item.unit if t.item else "each",
            "job_name": t.job.name if t.job else None,
            "job_number": t.job.job_number if t.job else None,
            "user_name": t.user.name if t.user else "?",
        })

    for d in days.values():
        d["logins"].sort(key=lambda x: x["time"])
        d["shifts"].sort(key=lambda x: x["time"])
        d["sign_outs"].sort(key=lambda x: x["time"])

    return {"days": days}


@router.get("/reorder")
def reorder_report(format: str = "", db: Session = Depends(get_db)):
    """Items whose SHOP qty is at/below reorder point, grouped by category."""
    shop = db.scalars(select(Location).where(Location.type == "shop")).first()
    shop_qty: dict[int, Decimal] = {}
    if shop:
        for sl in db.query(StockLevel).filter(StockLevel.location_id == shop.id).all():
            shop_qty[sl.item_id] = Decimal(str(sl.qty))
    items = db.query(Item).filter(Item.active, Item.reorder_point > 0).all()
    rows = []
    for i in items:
        qty = shop_qty.get(i.id, Decimal("0"))
        if qty <= i.reorder_point:
            rows.append({
                "item_id": i.id, "sku": i.sku, "name": i.name, "category": i.category,
                "unit": i.unit, "image_data": i.image_data, "shop_qty": qty,
                "reorder_point": i.reorder_point,
                "suggested_qty": i.reorder_qty, "last_cost": i.last_cost,
            })
    rows.sort(key=lambda r: (r["category"], r["name"]))
    if format == "csv":
        return _csv_response("reorder-report.csv",
            ["Category", "SKU", "Item", "Unit", "Shop Qty", "Reorder Point", "Suggested Qty", "Last Cost"],
            [[r["category"], r["sku"], r["name"], r["unit"], r["shop_qty"],
              r["reorder_point"], r["suggested_qty"], r["last_cost"]] for r in rows])
    grouped: dict[str, list] = {}
    for r in rows:
        grouped.setdefault(r["category"], []).append(r)
    return {"categories": [{"category": c, "items": lst} for c, lst in grouped.items()]}


def _parse_ids(csv_ids: str) -> list[int]:
    return [int(x) for x in csv_ids.split(",") if x.strip().isdigit()]


def _usage(db: Session, date_from: str, date_to: str, *, job_id: int | None = None,
           job_ids: list[int] | None = None):
    """SIGN_OUT minus RETURN, grouped by (user, job, item), costed at txn snapshots."""
    q = (
        db.query(Transaction)
        .options(joinedload(Transaction.item), joinedload(Transaction.user), joinedload(Transaction.job))
        .filter(Transaction.type.in_(["SIGN_OUT", "RETURN"]))
    )
    if job_ids:
        q = q.filter(Transaction.job_id.in_(job_ids))
    elif job_id:
        q = q.filter(Transaction.job_id == job_id)
    q = _range_filter(q, date_from, date_to)
    agg: dict[tuple, dict] = {}
    for t in q.all():
        key = (t.user_id, t.job_id, t.item_id)
        row = agg.setdefault(key, {
            "user_id": t.user_id, "user_name": t.user.name if t.user else "?",
            "job_id": t.job_id, "job_number": t.job.job_number if t.job else "?",
            "job_name": t.job.name if t.job else "?",
            "item_id": t.item_id, "sku": t.item.sku, "item_name": t.item.name, "unit": t.item.unit,
            "image_data": t.item.image_data,
            "qty_out": Decimal("0"), "qty_returned": Decimal("0"), "net_cost": Decimal("0"),
        })
        cost = (t.unit_cost or Decimal("0")) * t.qty
        if t.type == "SIGN_OUT":
            row["qty_out"] += t.qty
            row["net_cost"] += cost
        else:
            row["qty_returned"] += t.qty
            row["net_cost"] -= cost
    rows = list(agg.values())
    for r in rows:
        r["net_qty"] = r["qty_out"] - r["qty_returned"]
        r["net_cost"] = r["net_cost"].quantize(Decimal("0.01"))
    return rows


@router.get("/usage-by-tech")
def usage_by_tech(date_from: str = "", date_to: str = "", format: str = "",
                  db: Session = Depends(get_db)):
    rows = _usage(db, date_from, date_to)
    rows.sort(key=lambda r: (r["user_name"], r["item_name"]))
    if format == "csv":
        return _csv_response("usage-by-tech.csv",
            ["Tech", "Job", "SKU", "Item", "Unit", "Signed Out", "Returned", "Net Qty", "Net Cost"],
            [[r["user_name"], r["job_number"], r["sku"], r["item_name"], r["unit"],
              r["qty_out"], r["qty_returned"], r["net_qty"], r["net_cost"]] for r in rows])
    techs: dict[int, dict] = {}
    for r in rows:
        t = techs.setdefault(r["user_id"], {"user_id": r["user_id"], "user_name": r["user_name"],
                                            "total_cost": Decimal("0"), "lines": []})
        t["lines"].append(r)
        t["total_cost"] += r["net_cost"]
    return {"techs": sorted(techs.values(), key=lambda t: t["user_name"])}


@router.get("/usage-by-job")
def usage_by_job(date_from: str = "", date_to: str = "", job_id: int | None = None,
                 job_ids: str = "", format: str = "", db: Session = Depends(get_db)):
    rows = _usage(db, date_from, date_to, job_id=job_id, job_ids=_parse_ids(job_ids))
    rows.sort(key=lambda r: (r["job_number"], r["item_name"]))
    if format == "csv":
        return _csv_response("usage-by-job.csv",
            ["Job #", "Job", "SKU", "Item", "Unit", "Signed Out", "Returned", "Net Qty", "Net Cost"],
            [[r["job_number"], r["job_name"], r["sku"], r["item_name"], r["unit"],
              r["qty_out"], r["qty_returned"], r["net_qty"], r["net_cost"]] for r in rows])
    if format == "qbo":
        # Collapse the per-tech breakdown -- QuickBooks job costing only cares
        # about (job, item) totals, not who signed it out.
        by_job_item: dict[tuple, dict] = {}
        for r in rows:
            key = (r["job_id"], r["item_id"])
            line = by_job_item.setdefault(key, {
                "job_number": r["job_number"], "job_name": r["job_name"],
                "sku": r["sku"], "item_name": r["item_name"], "unit": r["unit"],
                "net_qty": Decimal("0"), "net_cost": Decimal("0"),
            })
            line["net_qty"] += r["net_qty"]
            line["net_cost"] += r["net_cost"]
        today = date.today().isoformat()
        qbo_rows = []
        for line in sorted(by_job_item.values(), key=lambda l: (l["job_number"], l["item_name"])):
            if line["net_qty"] == 0 and line["net_cost"] == 0:
                continue
            rate = (line["net_cost"] / line["net_qty"]).quantize(Decimal("0.0001")) if line["net_qty"] else Decimal("0")
            qbo_rows.append([
                today, line["job_name"], line["job_number"], line["item_name"],
                f"{line['sku']} — {line['net_qty']} {line['unit']}",
                line["net_qty"], rate, line["net_cost"].quantize(Decimal("0.01")), "Yes",
            ])
        return _csv_response("quickbooks-job-materials.csv",
            ["Date", "Customer", "Job #", "Product/Service", "Description", "Qty", "Rate", "Amount", "Billable"],
            qbo_rows)
    jobs: dict = {}
    for r in rows:
        j = jobs.setdefault(r["job_id"], {"job_id": r["job_id"], "job_number": r["job_number"],
                                          "job_name": r["job_name"], "total_cost": Decimal("0"),
                                          "lines": []})
        j["lines"].append(r)
        j["total_cost"] += r["net_cost"]
    return {"jobs": sorted(jobs.values(), key=lambda j: str(j["job_number"]))}


@router.get("/receiving")
def receiving(date_from: str = "", date_to: str = "", vendor_id: int | None = None,
              format: str = "", db: Session = Depends(get_db)):
    q = (
        db.query(Transaction)
        .options(joinedload(Transaction.item), joinedload(Transaction.user),
                 joinedload(Transaction.vendor))
        .filter(Transaction.type == "RECEIVE")
    )
    if vendor_id is not None:
        q = q.filter(Transaction.vendor_id == vendor_id)
    q = _range_filter(q, date_from, date_to)
    txns = q.order_by(Transaction.created_at.desc(), Transaction.id.desc()).all()
    rows = []
    for t in txns:
        ext_cost = ((t.unit_cost or Decimal("0")) * t.qty).quantize(Decimal("0.01"))
        rows.append({
            "id": t.id, "created_at": t.created_at.isoformat() + "+00:00",
            "sku": t.item.sku, "item_name": t.item.name, "unit": t.item.unit,
            "image_data": t.item.image_data,
            "qty": t.qty, "unit_cost": t.unit_cost, "ext_cost": ext_cost,
            "tax_amount": t.tax_amount,
            "vendor_name": t.vendor.name if t.vendor else "?",
            "ref": t.ref, "note": t.note, "user_name": t.user.name if t.user else "?",
        })
    if format == "csv":
        return _csv_response("receiving.csv",
            ["When (UTC)", "SKU", "Item", "Qty", "Unit Cost", "Ext Cost", "Tax", "Vendor", "Ref", "Note", "By"],
            [[r["created_at"], r["sku"], r["item_name"], r["qty"], r["unit_cost"], r["ext_cost"],
              r["tax_amount"], r["vendor_name"], r["ref"], r["note"], r["user_name"]] for r in rows])
    total_cost = sum((r["ext_cost"] for r in rows), Decimal("0"))
    total_tax = sum((r["tax_amount"] or Decimal("0") for r in rows), Decimal("0"))
    return {"receiving": rows, "total_cost": total_cost, "total_tax": total_tax}


@router.get("/adjustments")
def adjustments(date_from: str = "", date_to: str = "", format: str = "",
                db: Session = Depends(get_db)):
    q = (
        db.query(Transaction)
        .options(joinedload(Transaction.item), joinedload(Transaction.user),
                 joinedload(Transaction.from_location), joinedload(Transaction.to_location))
        .filter(Transaction.type == "ADJUST")
    )
    q = _range_filter(q, date_from, date_to)
    txns = q.order_by(Transaction.created_at.desc(), Transaction.id.desc()).all()
    rows = []
    for t in txns:
        direction = "decrease" if t.from_location_id else "increase"
        loc = t.from_location or t.to_location
        rows.append({
            "id": t.id, "created_at": t.created_at.isoformat() + "+00:00",
            "sku": t.item.sku, "item_name": t.item.name, "qty": t.qty,
            "image_data": t.item.image_data,
            "direction": direction, "location": loc.name if loc else "?",
            "reason": t.reason, "note": t.note, "user_name": t.user.name if t.user else "?",
            "cost_impact": ((t.unit_cost or Decimal("0")) * t.qty *
                            (Decimal("-1") if direction == "decrease" else Decimal("1"))
                            ).quantize(Decimal("0.01")),
        })
    if format == "csv":
        return _csv_response("adjustments.csv",
            ["When (UTC)", "SKU", "Item", "Qty", "Direction", "Location", "Reason", "Note", "By", "Cost Impact"],
            [[r["created_at"], r["sku"], r["item_name"], r["qty"], r["direction"],
              r["location"], r["reason"], r["note"], r["user_name"], r["cost_impact"]] for r in rows])
    return {"adjustments": rows}


@router.get("/timesheet")
def timesheet(date_from: str = "", date_to: str = "", format: str = "", payroll_item: str = "Regular Pay",
              db: Session = Depends(get_db)):
    q = db.query(ClockEvent).options(joinedload(ClockEvent.user), joinedload(ClockEvent.job))
    if date_from:
        q = q.filter(ClockEvent.clock_in_at >= day_start_utc(date_from))
    if date_to:
        q = q.filter(ClockEvent.clock_in_at < day_end_utc(date_to))
    events = q.order_by(ClockEvent.clock_in_at).all()

    now = datetime.utcnow()
    rows = []
    for e in events:
        end = e.clock_out_at or now
        hours = round((end - e.clock_in_at).total_seconds() / 3600, 2)
        rows.append({
            "id": e.id,
            "user_id": e.user_id,
            "user_name": e.user.name if e.user else "?",
            "job_number": e.job.job_number if e.job else None,
            "job_name": e.job.name if e.job else None,
            "clock_in_at": e.clock_in_at,
            "clock_out_at": e.clock_out_at,
            "still_clocked_in": e.clock_out_at is None,
            "hours": hours,
            "approval_status": e.approval_status,
        })

    if format == "csv":
        return _csv_response("timesheet.csv",
            ["Tech", "Job", "Clock In", "Clock Out", "Hours", "Status"],
            [[r["user_name"], r["job_number"] or "",
              to_local(r["clock_in_at"]).strftime("%Y-%m-%d %H:%M"),
              to_local(r["clock_out_at"]).strftime("%Y-%m-%d %H:%M") if r["clock_out_at"] else "still clocked in",
              r["hours"], r["approval_status"]] for r in rows])

    if format == "qbo":
        # QuickBooks Online's "Import employee time" CSV shape -- Name must
        # match the employee's QBO Display Name exactly, Payroll item must
        # match an existing QBO payroll item, Duration is H:MM (not decimal).
        # Only approved, finished shifts go to payroll -- a still-running or
        # never-approved shift isn't final yet.
        qbo_rows = []
        for r in rows:
            if r["still_clocked_in"] or r["approval_status"] != "approved":
                continue
            total_minutes = round(r["hours"] * 60)
            duration = f"{total_minutes // 60}:{total_minutes % 60:02d}"
            qbo_rows.append([
                r["user_name"],
                to_local(r["clock_in_at"]).strftime("%m/%d/%Y"),
                r["job_number"] or "",
                "",  # Service Item -- fill in during import if your QBO setup uses one
                payroll_item,
                duration,
                "",  # Class
                "",  # Billable
                r["job_name"] or "",  # Notes
            ])
        return _csv_response("quickbooks-time-import.csv",
            ["Name", "Transaction Date", "Customer", "Service Item", "Payroll item", "Duration", "Class",
             "Billable", "Notes"],
            qbo_rows)

    techs: dict[int, dict] = {}
    for r in rows:
        t = techs.setdefault(r["user_id"], {
            "user_id": r["user_id"], "user_name": r["user_name"], "total_hours": 0.0, "shifts": [],
        })
        t["shifts"].append({
            "id": r["id"],
            "job_number": r["job_number"],
            "job_name": r["job_name"],
            "clock_in_at": _utc_iso(r["clock_in_at"]),
            "clock_out_at": _utc_iso(r["clock_out_at"]),
            "still_clocked_in": r["still_clocked_in"],
            "hours": r["hours"],
            "approval_status": r["approval_status"],
        })
        t["total_hours"] += r["hours"]
    for t in techs.values():
        t["total_hours"] = round(t["total_hours"], 2)
        t["shifts"].sort(key=lambda s: s["clock_in_at"], reverse=True)
    return {"techs": sorted(techs.values(), key=lambda t: t["user_name"])}


@router.get("/pnl")
def pnl(date_from: str = "", date_to: str = "", format: str = "", db: Session = Depends(get_db)):
    """Business-wide profit & loss over an optional date range, grouped by
    job: revenue minus materials (from the inventory ledger, same formula as
    _usage()), labor (approved clocked hours x rate), and expenses. Expenses
    with no job_id are overhead -- counted in the grand total but reported
    separately, never allocated to one job."""
    usage_rows = _usage(db, date_from, date_to)
    material_by_job: dict[int, Decimal] = {}
    for r in usage_rows:
        if r["job_id"] is None:
            continue
        material_by_job[r["job_id"]] = material_by_job.get(r["job_id"], Decimal("0")) + r["net_cost"]

    events_q = (
        db.query(ClockEvent)
        .options(joinedload(ClockEvent.user))
        .filter(ClockEvent.approval_status == "approved", ClockEvent.job_id.isnot(None))
    )
    if date_from:
        events_q = events_q.filter(ClockEvent.clock_in_at >= day_start_utc(date_from))
    if date_to:
        events_q = events_q.filter(ClockEvent.clock_in_at < day_end_utc(date_to))
    now = datetime.utcnow()
    labor_by_job: dict[int, Decimal] = {}
    missing_hours_by_user: dict[int, MissingRateUser] = {}
    for e in events_q.all():
        hours = round(((e.clock_out_at or now) - e.clock_in_at).total_seconds() / 3600, 2)
        if e.user.hourly_rate is None:
            m = missing_hours_by_user.setdefault(
                e.user_id, MissingRateUser(user_id=e.user_id, user_name=e.user.name, hours=0.0))
            m.hours = round(m.hours + hours, 2)
        else:
            cost = (Decimal(str(hours)) * e.user.hourly_rate).quantize(Decimal("0.01"))
            labor_by_job[e.job_id] = labor_by_job.get(e.job_id, Decimal("0")) + cost

    # Expense.expense_date / JobRevenue.received_date are real Date columns --
    # comparing them against the raw query-string values crashes on Postgres
    # ("operator does not exist: date >= character varying"), even though
    # SQLite silently tolerates it. Parse to actual date objects first.
    date_from_d = date.fromisoformat(date_from) if date_from else None
    date_to_d = date.fromisoformat(date_to) if date_to else None

    expense_q = db.query(Expense)
    if date_from_d:
        expense_q = expense_q.filter(Expense.expense_date >= date_from_d)
    if date_to_d:
        expense_q = expense_q.filter(Expense.expense_date <= date_to_d)
    expense_by_job: dict[int, Decimal] = {}
    overhead_expenses = Decimal("0")
    for e in expense_q.all():
        if e.job_id is None:
            overhead_expenses += e.amount
        else:
            expense_by_job[e.job_id] = expense_by_job.get(e.job_id, Decimal("0")) + e.amount

    revenue_q = db.query(JobRevenue)
    if date_from_d:
        revenue_q = revenue_q.filter(JobRevenue.received_date >= date_from_d)
    if date_to_d:
        revenue_q = revenue_q.filter(JobRevenue.received_date <= date_to_d)
    revenue_by_job: dict[int, Decimal] = {}
    for r in revenue_q.all():
        revenue_by_job[r.job_id] = revenue_by_job.get(r.job_id, Decimal("0")) + r.amount

    job_ids = set(material_by_job) | set(labor_by_job) | set(expense_by_job) | set(revenue_by_job)
    jobs_by_id = {j.id: j for j in db.query(Job).filter(Job.id.in_(job_ids)).all()} if job_ids else {}

    by_job: list[PnlJobRow] = []
    total_revenue = Decimal("0")
    total_material = Decimal("0")
    total_labor = Decimal("0")
    total_expense = Decimal("0")
    for jid in job_ids:
        job = jobs_by_id.get(jid)
        if not job:
            continue
        revenue = revenue_by_job.get(jid, Decimal("0"))
        material = material_by_job.get(jid, Decimal("0"))
        labor = labor_by_job.get(jid, Decimal("0"))
        expense = expense_by_job.get(jid, Decimal("0"))
        by_job.append(PnlJobRow(
            job_id=jid, job_number=job.job_number, job_name=job.name,
            revenue=revenue, material_cost=material, labor_cost=labor, expense_cost=expense,
            profit=revenue - (material + labor + expense),
        ))
        total_revenue += revenue
        total_material += material
        total_labor += labor
        total_expense += expense
    by_job.sort(key=lambda r: r.job_number)

    total_expense_all = total_expense + overhead_expenses
    total_profit = total_revenue - (total_material + total_labor + total_expense_all)

    out = PnlOut(
        revenue=total_revenue, material_cost=total_material, labor_cost=total_labor,
        expense_cost=total_expense_all, overhead_expenses=overhead_expenses, profit=total_profit,
        by_job=by_job, missing_rate_users=list(missing_hours_by_user.values()),
    )
    if format == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["Job #", "Job", "Revenue", "Material Cost", "Labor Cost", "Expense Cost", "Profit"])
        for r in by_job:
            w.writerow([r.job_number, r.job_name, r.revenue, r.material_cost, r.labor_cost,
                        r.expense_cost, r.profit])
        w.writerow([])
        w.writerow(["", "Overhead expenses", "", "", "", overhead_expenses, ""])
        w.writerow(["", "TOTAL", total_revenue, total_material, total_labor, total_expense_all, total_profit])
        buf.seek(0)
        return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers={
            "Content-Disposition": 'attachment; filename="profit-and-loss.csv"'})
    return out
