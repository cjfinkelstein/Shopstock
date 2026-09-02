import csv
import io

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session, defer, joinedload

from app.auth import get_current_user, require_admin
from app.database import get_db
from app.models import Expense, Job, User
from app.schemas import ExpenseCreate, ExpenseMetaOut, ExpenseOut, ExpenseUpdate

router = APIRouter(prefix="/expenses", tags=["expenses"], dependencies=[Depends(require_admin)])


def _out(e: Expense) -> ExpenseOut:
    return ExpenseOut(
        id=e.id, expense_date=e.expense_date, amount=e.amount, category=e.category,
        job_id=e.job_id, job_number=e.job.job_number if e.job else None, notes=e.notes,
        receipt_filename=e.receipt_filename, receipt_mime_type=e.receipt_mime_type, receipt_data=e.receipt_data,
        created_by_name=e.creator.name if e.creator else None,
        created_at=e.created_at, updated_at=e.updated_at,
    )


def _meta_out(e: Expense, has_receipt: bool) -> ExpenseMetaOut:
    return ExpenseMetaOut(
        id=e.id, expense_date=e.expense_date, amount=e.amount, category=e.category,
        job_id=e.job_id, job_number=e.job.job_number if e.job else None, notes=e.notes,
        has_receipt=has_receipt, created_by_name=e.creator.name if e.creator else None,
        created_at=e.created_at, updated_at=e.updated_at,
    )


@router.get("")
def list_expenses(date_from: str = "", date_to: str = "", job_id: str = "", category: str = "",
                  format: str = "", db: Session = Depends(get_db)):
    # `receipt_data` holds the full base64 photo and can be huge -- defer it here
    # (mirrors list_job_files) so listing expenses can't balloon API memory.
    q = (
        db.query(Expense, func.length(Expense.receipt_data))
        .options(joinedload(Expense.job), joinedload(Expense.creator), defer(Expense.receipt_data))
    )
    if date_from:
        q = q.filter(Expense.expense_date >= date_from)
    if date_to:
        q = q.filter(Expense.expense_date <= date_to)
    if job_id == "none":
        q = q.filter(Expense.job_id.is_(None))
    elif job_id:
        q = q.filter(Expense.job_id == int(job_id))
    if category:
        q = q.filter(Expense.category == category)
    rows = q.order_by(Expense.expense_date.desc(), Expense.id.desc()).all()
    items = [_meta_out(e, (size or 0) > 0) for e, size in rows]

    if format == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["Date", "Category", "Job", "Amount", "Notes"])
        total = 0
        for e in items:
            w.writerow([e.expense_date, e.category, e.job_number or "Overhead", e.amount, e.notes or ""])
            total += e.amount
        w.writerow([])
        w.writerow(["", "", "", "TOTAL", total])
        buf.seek(0)
        return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers={
            "Content-Disposition": 'attachment; filename="expenses.csv"'})
    return items


@router.get("/{expense_id}", response_model=ExpenseOut)
def get_expense(expense_id: int, db: Session = Depends(get_db)):
    e = db.get(Expense, expense_id)
    if not e:
        raise HTTPException(status_code=404, detail="Expense not found")
    return _out(e)


@router.post("", response_model=ExpenseOut, status_code=201)
def create_expense(body: ExpenseCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if body.job_id is not None and not db.get(Job, body.job_id):
        raise HTTPException(status_code=404, detail="Job not found")
    e = Expense(
        expense_date=body.expense_date, amount=body.amount, category=body.category, job_id=body.job_id,
        notes=body.notes, receipt_filename=body.receipt_filename, receipt_mime_type=body.receipt_mime_type,
        receipt_data=body.receipt_data, created_by=user.id,
    )
    db.add(e)
    db.commit()
    db.refresh(e)
    return _out(e)


@router.patch("/{expense_id}", response_model=ExpenseOut)
def update_expense(expense_id: int, body: ExpenseUpdate, db: Session = Depends(get_db)):
    e = db.get(Expense, expense_id)
    if not e:
        raise HTTPException(status_code=404, detail="Expense not found")
    if body.clear_job:
        e.job_id = None
    elif body.job_id is not None:
        if not db.get(Job, body.job_id):
            raise HTTPException(status_code=404, detail="Job not found")
        e.job_id = body.job_id
    if body.clear_receipt:
        e.receipt_filename = None
        e.receipt_mime_type = None
        e.receipt_data = None
    elif body.receipt_data is not None:
        e.receipt_filename = body.receipt_filename
        e.receipt_mime_type = body.receipt_mime_type
        e.receipt_data = body.receipt_data
    if body.expense_date is not None:
        e.expense_date = body.expense_date
    if body.amount is not None:
        e.amount = body.amount
    if body.category is not None:
        e.category = body.category
    if body.notes is not None:
        e.notes = body.notes
    db.commit()
    return _out(e)


@router.delete("/{expense_id}", status_code=204)
def delete_expense(expense_id: int, db: Session = Depends(get_db)):
    e = db.get(Expense, expense_id)
    if e:
        db.delete(e)
        db.commit()
