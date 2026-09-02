"""Date-range handling: users think in America/New_York days; the DB stores naive UTC.
A YYYY-MM-DD filter therefore maps to [NY midnight, next NY midnight) converted to UTC."""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import HTTPException

from app.config import settings


def _tz() -> ZoneInfo:
    return ZoneInfo(settings.display_timezone)


def parse_day(s: str) -> datetime:
    try:
        return datetime.strptime(s, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Bad date {s!r} — use YYYY-MM-DD")


def day_start_utc(s: str) -> datetime:
    """Naive-UTC instant of NY midnight for the given date."""
    local = parse_day(s).replace(tzinfo=_tz())
    return local.astimezone(ZoneInfo("UTC")).replace(tzinfo=None)


def day_end_utc(s: str) -> datetime:
    """Naive-UTC instant of the NY midnight AFTER the given date (exclusive bound)."""
    local = (parse_day(s) + timedelta(days=1)).replace(tzinfo=_tz())
    return local.astimezone(ZoneInfo("UTC")).replace(tzinfo=None)


def today_range_utc() -> tuple[datetime, datetime]:
    now_ny = datetime.now(_tz())
    day = now_ny.strftime("%Y-%m-%d")
    return day_start_utc(day), day_end_utc(day)


def to_local(dt: datetime) -> datetime:
    """Naive-UTC instant -> aware local (display_timezone) datetime."""
    return dt.replace(tzinfo=ZoneInfo("UTC")).astimezone(_tz())
