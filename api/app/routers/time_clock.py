from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.auth import get_current_user, require_admin
from app.database import get_db
from app.models import ClockEvent, Job, LocationPing, User, utcnow
from app.schemas import ClockInIn, ClockOutIn, ClockStatusOut, LocationPingIn, MyShiftOut, WorkerLiveOut

router = APIRouter(prefix="/time", tags=["time"])


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
    db.commit()
    return ClockStatusOut(clocked_in=False)


@router.post("/ping", status_code=204)
def ping(body: LocationPingIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ev = _open_event(db, user.id)
    if not ev:
        raise HTTPException(status_code=400, detail="Not clocked in")
    db.add(LocationPing(clock_event_id=ev.id, user_id=user.id, lat=body.lat, lng=body.lng))
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


@router.post("/{event_id}/approve", response_model=MyShiftOut)
def approve_shift(event_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    ev = db.get(ClockEvent, event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Shift not found")
    ev.approval_status = "approved"
    ev.approved_by_id = admin.id
    ev.approved_at = utcnow()
    db.commit()
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
