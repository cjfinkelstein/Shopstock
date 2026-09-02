from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import hash_secret, require_admin
from app.database import get_db
from app.models import User
from app.schemas import TechTapOut, UserCreate, UserOut, UserUpdate

router = APIRouter(prefix="/users", tags=["users"])


def _out(user: User) -> UserOut:
    o = UserOut.model_validate(user)
    o.has_pin = user.pin_hash is not None
    return o  # o.pin comes straight from the model (admin-only endpoints)


@router.get("/techs", response_model=list[TechTapOut])
def list_techs(db: Session = Depends(get_db)):
    """Unauthenticated — powers the tap-in screen. Names + PIN flag only."""
    techs = db.query(User).filter(User.role == "tech", User.active).order_by(User.name).all()
    return [TechTapOut(id=t.id, name=t.name, has_pin=t.pin_hash is not None) for t in techs]


@router.get("", response_model=list[UserOut], dependencies=[Depends(require_admin)])
def list_users(include_inactive: bool = False, db: Session = Depends(get_db)):
    q = db.query(User)
    if not include_inactive:
        q = q.filter(User.active)
    return [_out(u) for u in q.order_by(User.role, User.name).all()]


@router.post("", response_model=UserOut, status_code=201, dependencies=[Depends(require_admin)])
def create_user(body: UserCreate, db: Session = Depends(get_db)):
    if body.role == "admin" and (not body.email or not body.password):
        raise HTTPException(status_code=400, detail="Admin users need email and password")
    user = User(
        name=body.name.strip(),
        role=body.role,
        email=body.email.lower().strip() if body.email else None,
        password_hash=hash_secret(body.password) if body.password else None,
        pin_hash=hash_secret(body.pin) if body.pin else None,
        pin=body.pin if body.pin else None,
        active=True,
    )
    db.add(user)
    db.commit()
    return _out(user)


@router.patch("/{user_id}", response_model=UserOut, dependencies=[Depends(require_admin)])
def update_user(user_id: int, body: UserUpdate, db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if body.name is not None:
        user.name = body.name.strip()
    if body.email is not None:
        user.email = body.email.lower().strip() or None
    if body.password:
        user.password_hash = hash_secret(body.password)
    if body.clear_pin:
        user.pin_hash = None
        user.pin = None
    elif body.pin:
        user.pin_hash = hash_secret(body.pin)
        user.pin = body.pin
    if body.active is not None:
        user.active = body.active  # soft-delete
    if body.hourly_rate is not None:
        user.hourly_rate = body.hourly_rate
    db.commit()
    return _out(user)
