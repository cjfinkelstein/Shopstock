from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_admin
from app.database import get_db
from app.models import Location, Truck, User
from app.schemas import LocationOut, TruckCreate, TruckOut, TruckUpdate

router = APIRouter(tags=["trucks"])


def _out(truck: Truck) -> TruckOut:
    o = TruckOut.model_validate(truck)
    o.location = LocationOut.model_validate(truck.location) if truck.location else None
    o.assigned_user_name = truck.assigned_user.name if truck.assigned_user else None
    return o


@router.get("/trucks", response_model=list[TruckOut])
def list_trucks(include_inactive: bool = False, db: Session = Depends(get_db),
                user: User = Depends(get_current_user)):
    q = db.query(Truck)
    if not include_inactive:
        q = q.filter(Truck.active)
    return [_out(t) for t in q.order_by(Truck.name).all()]


@router.post("/trucks", response_model=TruckOut, status_code=201, dependencies=[Depends(require_admin)])
def create_truck(body: TruckCreate, db: Session = Depends(get_db)):
    truck = Truck(name=body.name.strip(), assigned_user_id=body.assigned_user_id, active=True)
    db.add(truck)
    db.flush()
    # every truck gets its own stock location automatically
    db.add(Location(type="truck", truck_id=truck.id, name=truck.name, active=True))
    db.commit()
    return _out(truck)


@router.patch("/trucks/{truck_id}", response_model=TruckOut, dependencies=[Depends(require_admin)])
def update_truck(truck_id: int, body: TruckUpdate, db: Session = Depends(get_db)):
    truck = db.get(Truck, truck_id)
    if not truck:
        raise HTTPException(status_code=404, detail="Truck not found")
    if body.name is not None:
        truck.name = body.name.strip()
        if truck.location:
            truck.location.name = truck.name
    if body.clear_assignment:
        truck.assigned_user_id = None
    elif body.assigned_user_id is not None:
        truck.assigned_user_id = body.assigned_user_id
    if body.active is not None:
        truck.active = body.active
        if truck.location:
            truck.location.active = body.active
    db.commit()
    return _out(truck)


@router.get("/locations", response_model=list[LocationOut])
def list_locations(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    locs = db.query(Location).filter(Location.active).order_by(Location.type.desc(), Location.name).all()
    return [LocationOut.model_validate(l) for l in locs]
