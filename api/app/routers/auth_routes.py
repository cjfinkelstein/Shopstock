from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import (
    check_not_locked_out,
    clear_failed_attempts,
    create_token,
    get_current_user,
    hash_secret,
    record_failed_attempt,
    verify_secret,
)
from app.database import get_db
from app.models import LoginEvent, User
from app.schemas import AdminLogin, ChangePinIn, TapIn, TokenOut, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


def _user_out(user: User) -> UserOut:
    out = UserOut.model_validate(user)
    out.has_pin = user.pin_hash is not None
    return out


@router.post("/tap", response_model=TokenOut)
def tap_in(body: TapIn, db: Session = Depends(get_db)):
    lock_key = f"tap:{body.user_id}"
    check_not_locked_out(lock_key)
    user = db.get(User, body.user_id)
    if not user or not user.active or user.role != "tech":
        record_failed_attempt(lock_key)
        raise HTTPException(status_code=401, detail="Unknown tech")
    if user.pin_hash:
        if not body.pin:
            record_failed_attempt(lock_key)
            raise HTTPException(status_code=401, detail="PIN required")
        if not verify_secret(body.pin, user.pin_hash):
            record_failed_attempt(lock_key)
            raise HTTPException(status_code=401, detail="Wrong PIN")
    clear_failed_attempts(lock_key)
    db.add(LoginEvent(user_id=user.id, role=user.role))
    db.commit()
    return TokenOut(access_token=create_token(user), user=_user_out(user))


@router.post("/login", response_model=TokenOut)
def admin_login(body: AdminLogin, db: Session = Depends(get_db)):
    email = body.email.lower().strip()
    lock_key = f"login:{email}"
    check_not_locked_out(lock_key)
    user = db.query(User).filter(User.email == email, User.active).first()
    if not user or user.role != "admin" or not verify_secret(body.password, user.password_hash):
        record_failed_attempt(lock_key)
        raise HTTPException(status_code=401, detail="Invalid email or password")
    clear_failed_attempts(lock_key)
    db.add(LoginEvent(user_id=user.id, role=user.role))
    db.commit()
    return TokenOut(access_token=create_token(user), user=_user_out(user))


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return _user_out(user)


@router.post("/change-pin", response_model=UserOut)
def change_pin(body: ChangePinIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.role != "tech":
        raise HTTPException(status_code=400, detail="Only techs use a PIN")
    if user.pin_hash and not verify_secret(body.current_pin or "", user.pin_hash):
        raise HTTPException(status_code=401, detail="Current PIN is wrong")
    user.pin_hash = hash_secret(body.new_pin)
    user.pin = body.new_pin
    db.commit()
    return _user_out(user)


@router.post("/logout")
def logout(user: User = Depends(get_current_user)):
    # Stateless JWT: the client discards the token. Endpoint exists so the
    # frontend has one call for the whole logout flow.
    return {"ok": True}
