from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from app.auth import require_admin
from app.config import settings
from app.database import get_db
from app.models import Item
from app.schemas import LabelPrintIn
from app.services.labels import render_label_sheet

router = APIRouter(prefix="/labels", tags=["labels"], dependencies=[Depends(require_admin)])


@router.post("/print", response_class=HTMLResponse)
def print_labels(body: LabelPrintIn, db: Session = Depends(get_db)):
    if not body.item_ids:
        raise HTTPException(status_code=400, detail="No items selected")
    items = db.query(Item).filter(Item.id.in_(body.item_ids)).all()
    if not items:
        raise HTTPException(status_code=404, detail="No matching items")
    by_id = {i.id: i for i in items}
    ordered = [by_id[i] for i in body.item_ids if i in by_id]
    return HTMLResponse(render_label_sheet(ordered, body.copies_per_item, settings.app_name))
