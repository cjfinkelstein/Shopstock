from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import require_admin
from app.database import get_db
from app.models import SmtpSettings
from app.schemas import SmtpSettingsIn, SmtpSettingsOut

router = APIRouter(prefix="/settings", tags=["settings"], dependencies=[Depends(require_admin)])


def _out(row: SmtpSettings | None) -> SmtpSettingsOut:
    if not row:
        return SmtpSettingsOut(
            host="", port=587, use_tls=True, username="", from_address="", from_name="",
            has_password=False, configured=False,
        )
    return SmtpSettingsOut(
        host=row.host or "", port=row.port, use_tls=row.use_tls, username=row.username or "",
        from_address=row.from_address or "", from_name=row.from_name or "",
        has_password=bool(row.password), configured=bool(row.host and row.from_address),
    )


@router.get("/smtp", response_model=SmtpSettingsOut)
def get_smtp(db: Session = Depends(get_db)):
    return _out(db.get(SmtpSettings, 1))


@router.put("/smtp", response_model=SmtpSettingsOut)
def update_smtp(body: SmtpSettingsIn, db: Session = Depends(get_db)):
    row = db.get(SmtpSettings, 1)
    if not row:
        row = SmtpSettings(id=1)
        db.add(row)
    row.host = body.host.strip()
    row.port = body.port
    row.use_tls = body.use_tls
    row.username = body.username.strip()
    row.from_address = body.from_address.strip()
    row.from_name = body.from_name.strip()
    if body.password:  # blank = keep whatever's already stored
        row.password = body.password
    db.commit()
    db.refresh(row)
    return _out(row)
