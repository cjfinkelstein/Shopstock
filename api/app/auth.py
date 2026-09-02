import time
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import User

# Login/PIN brute-force lockout -- in-memory, keyed by whatever the caller
# considers the identity being guessed against (a user id for PIN tap-in, an
# email for admin login). One process, small team: no shared store needed.
# Wiped on restart, which is fine -- the threat this stops is a single sitting
# of automated guessing, not a persistent audit trail.
_MAX_ATTEMPTS = 5
_WINDOW_SECONDS = 15 * 60
_failed_attempts: dict[str, list[float]] = {}


def check_not_locked_out(key: str) -> None:
    now = time.monotonic()
    attempts = [t for t in _failed_attempts.get(key, []) if now - t < _WINDOW_SECONDS]
    _failed_attempts[key] = attempts
    if len(attempts) >= _MAX_ATTEMPTS:
        wait_min = int((_WINDOW_SECONDS - (now - attempts[0])) / 60) + 1
        raise HTTPException(status_code=429, detail=f"Too many attempts -- try again in {wait_min} minute(s).")


def record_failed_attempt(key: str) -> None:
    _failed_attempts.setdefault(key, []).append(time.monotonic())


def clear_failed_attempts(key: str) -> None:
    _failed_attempts.pop(key, None)


def hash_secret(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_secret(plain: str, hashed: str | None) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except ValueError:
        return False


def create_token(user: User) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.id),
        "role": user.role,
        "iat": now,
        "exp": now + timedelta(hours=settings.session_hours),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = auth.removeprefix("Bearer ").strip()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = db.get(User, int(payload["sub"]))
    if not user or not user.active:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return user


def is_admin(user: User) -> bool:
    return user.role == "admin"
