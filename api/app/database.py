from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import Numeric, Float, create_engine, TypeDecorator
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings


class Num(TypeDecorator):
    """Numeric column that is exact NUMERIC on Postgres and works on SQLite
    (stored as REAL, surfaced to Python as quantized Decimal)."""

    impl = Numeric
    cache_ok = True

    def __init__(self, precision: int = 12, scale: int = 2):
        super().__init__(precision, scale)
        self.precision_ = precision
        self.scale_ = scale
        self._exp = Decimal(1).scaleb(-scale)

    def load_dialect_impl(self, dialect):
        if dialect.name == "sqlite":
            return dialect.type_descriptor(Float(asdecimal=False))
        return dialect.type_descriptor(Numeric(self.precision_, self.scale_, asdecimal=True))

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        d = Decimal(str(value)).quantize(self._exp, rounding=ROUND_HALF_UP)
        if dialect.name == "sqlite":
            return float(d)
        return d

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return Decimal(str(value)).quantize(self._exp, rounding=ROUND_HALF_UP)


class Base(DeclarativeBase):
    pass


def _make_engine(url: str):
    kwargs = {}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
    return create_engine(url, pool_pre_ping=True, **kwargs)


engine = _make_engine(settings.database_url)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
