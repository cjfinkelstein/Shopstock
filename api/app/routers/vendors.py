from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import require_admin
from app.database import get_db
from app.models import Vendor
from app.schemas import VendorCreate, VendorOut, VendorUpdate

router = APIRouter(prefix="/vendors", tags=["vendors"], dependencies=[Depends(require_admin)])


@router.get("", response_model=list[VendorOut])
def list_vendors(include_inactive: bool = False, db: Session = Depends(get_db)):
    q = db.query(Vendor)
    if not include_inactive:
        q = q.filter(Vendor.active)
    return q.order_by(Vendor.name).all()


@router.post("", response_model=VendorOut, status_code=201)
def create_vendor(body: VendorCreate, db: Session = Depends(get_db)):
    vendor = Vendor(name=body.name.strip(), active=True)
    db.add(vendor)
    db.commit()
    return vendor


@router.patch("/{vendor_id}", response_model=VendorOut)
def update_vendor(vendor_id: int, body: VendorUpdate, db: Session = Depends(get_db)):
    vendor = db.get(Vendor, vendor_id)
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    if body.name is not None:
        vendor.name = body.name.strip()
    if body.active is not None:
        vendor.active = body.active
    db.commit()
    return vendor
