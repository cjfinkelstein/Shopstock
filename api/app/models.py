from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, String, Text, UniqueConstraint, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, Num


def utcnow() -> datetime:
    """Naive UTC timestamp — stored identically on SQLite and Postgres."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    role: Mapped[str] = mapped_column(String(10), nullable=False)  # tech | admin
    pin_hash: Mapped[str | None] = mapped_column(String(200))
    pin: Mapped[str | None] = mapped_column(String(4))  # plaintext mirror so admin can always view it
    email: Mapped[str | None] = mapped_column(String(200), unique=True)
    password_hash: Mapped[str | None] = mapped_column(String(200))
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    gps_consent_at: Mapped[datetime | None] = mapped_column(DateTime)
    hourly_rate: Mapped[Decimal | None] = mapped_column(Num(10, 2))  # admin-settable; None = not set yet

    truck: Mapped["Truck | None"] = relationship(back_populates="assigned_user", uselist=False)


class LoginEvent(Base):
    """One row per successful tap-in / admin login. Immutable event log."""

    __tablename__ = "login_events"
    __table_args__ = (Index("ix_login_events_created", "created_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    role: Mapped[str] = mapped_column(String(10), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    user: Mapped["User"] = relationship()


class Truck(TimestampMixin, Base):
    __tablename__ = "trucks"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    assigned_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    assigned_user: Mapped[User | None] = relationship(back_populates="truck")
    location: Mapped["Location | None"] = relationship(back_populates="truck", uselist=False)


class Location(TimestampMixin, Base):
    __tablename__ = "locations"

    id: Mapped[int] = mapped_column(primary_key=True)
    type: Mapped[str] = mapped_column(String(10), nullable=False)  # shop | truck
    truck_id: Mapped[int | None] = mapped_column(ForeignKey("trucks.id"), unique=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    truck: Mapped[Truck | None] = relationship(back_populates="location")


class ClockEvent(TimestampMixin, Base):
    """One row per work shift: clock-in through clock-out."""

    __tablename__ = "clock_events"
    __table_args__ = (Index("ix_clock_events_user", "user_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    job_id: Mapped[int | None] = mapped_column(ForeignKey("jobs.id"))
    clock_in_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    clock_in_lat: Mapped[float | None] = mapped_column(Float)
    clock_in_lng: Mapped[float | None] = mapped_column(Float)
    clock_out_at: Mapped[datetime | None] = mapped_column(DateTime)
    clock_out_lat: Mapped[float | None] = mapped_column(Float)
    clock_out_lng: Mapped[float | None] = mapped_column(Float)
    approval_status: Mapped[str] = mapped_column(String(10), default="pending", nullable=False)  # pending | approved
    approved_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime)

    user: Mapped["User"] = relationship(foreign_keys=[user_id])
    approved_by: Mapped["User | None"] = relationship(foreign_keys=[approved_by_id])
    job: Mapped["Job | None"] = relationship()
    pings: Mapped[list["LocationPing"]] = relationship(
        back_populates="clock_event", order_by="LocationPing.recorded_at"
    )


class LocationPing(Base):
    """One row per periodic GPS ping recorded while a tech is clocked in."""

    __tablename__ = "location_pings"
    __table_args__ = (Index("ix_location_pings_clock_event", "clock_event_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    clock_event_id: Mapped[int] = mapped_column(ForeignKey("clock_events.id"), nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    clock_event: Mapped[ClockEvent] = relationship(back_populates="pings")


class Vendor(TimestampMixin, Base):
    __tablename__ = "vendors"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class Item(TimestampMixin, Base):
    __tablename__ = "items"

    id: Mapped[int] = mapped_column(primary_key=True)
    sku: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    barcode: Mapped[str] = mapped_column(String(100), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    image_data: Mapped[str | None] = mapped_column(Text)  # small data: URL thumbnail
    category: Mapped[str] = mapped_column(String(100), index=True, nullable=False)
    unit: Mapped[str] = mapped_column(String(10), nullable=False)  # each | box | foot
    avg_cost: Mapped[Decimal] = mapped_column(Num(10, 4), default=Decimal("0"), nullable=False)
    last_cost: Mapped[Decimal] = mapped_column(Num(10, 4), default=Decimal("0"), nullable=False)
    reorder_point: Mapped[Decimal] = mapped_column(Num(12, 2), default=Decimal("0"), nullable=False)
    reorder_qty: Mapped[Decimal] = mapped_column(Num(12, 2), default=Decimal("0"), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)


class StockLevel(TimestampMixin, Base):
    __tablename__ = "stock_levels"
    __table_args__ = (UniqueConstraint("item_id", "location_id", name="uq_stock_item_location"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id"), nullable=False, index=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id"), nullable=False, index=True)
    qty: Mapped[Decimal] = mapped_column(Num(12, 2), default=Decimal("0"), nullable=False)

    item: Mapped[Item] = relationship()
    location: Mapped[Location] = relationship()


class Job(TimestampMixin, Base):
    __tablename__ = "jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    job_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    customer: Mapped[str | None] = mapped_column(String(200))
    address: Mapped[str | None] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(10), default="active", nullable=False)  # active | closed


class JobFile(TimestampMixin, Base):
    """A document or photo attached to a job -- stored as a base64 data URL,
    same convention as Item.image_data, so no separate file-storage service
    is needed for a shop this size."""

    __tablename__ = "job_files"

    id: Mapped[int] = mapped_column(primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("jobs.id"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)  # photo | document
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    data: Mapped[str] = mapped_column(Text, nullable=False)  # data: URL
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))

    job: Mapped[Job] = relationship()
    uploader: Mapped["User | None"] = relationship()


class Expense(TimestampMixin, Base):
    """General ledger of money out -- fuel, tools, permits, subs, office,
    insurance, travel, misc. job_id is nullable: an expense either belongs to
    one job (subtracted from that job's profit) or is general/overhead
    business spend (counted only in the business-wide P&L, never allocated
    to a single job). Deliberately excludes a "materials" category since job
    material cost is already derived from the inventory ledger (Transaction)
    -- a materials expense here would risk double-counting."""

    __tablename__ = "expenses"
    __table_args__ = (
        Index("ix_expenses_job", "job_id"),
        Index("ix_expenses_date", "expense_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    expense_date: Mapped[date] = mapped_column(Date, nullable=False)  # business date, not created_at
    amount: Mapped[Decimal] = mapped_column(Num(12, 2), nullable=False)
    category: Mapped[str] = mapped_column(String(20), nullable=False)
    job_id: Mapped[int | None] = mapped_column(ForeignKey("jobs.id"))
    notes: Mapped[str | None] = mapped_column(Text)
    receipt_filename: Mapped[str | None] = mapped_column(String(255))
    receipt_mime_type: Mapped[str | None] = mapped_column(String(100))
    receipt_data: Mapped[str | None] = mapped_column(Text)  # data: URL, same convention as JobFile.data
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))

    job: Mapped["Job | None"] = relationship()
    creator: Mapped["User | None"] = relationship()


class JobRevenue(TimestampMixin, Base):
    """One dated payment/invoice amount against a job -- sum(amount) for a
    job is that job's total revenue. No separate 'contract price' field on
    Job; revenue is always this aggregate, computed on request, matching the
    app's existing convention (Item.on_hand, JobMaterialsOut.total_cost,
    MyShiftOut.hours are all computed the same way, never stored
    denormalized)."""

    __tablename__ = "job_revenues"
    __table_args__ = (Index("ix_job_revenues_job", "job_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("jobs.id"), nullable=False)
    received_date: Mapped[date] = mapped_column(Date, nullable=False)
    amount: Mapped[Decimal] = mapped_column(Num(12, 2), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), default="other", nullable=False)  # deposit|progress|final|other
    ref: Mapped[str | None] = mapped_column(String(100))
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))

    job: Mapped["Job"] = relationship()
    creator: Mapped["User | None"] = relationship()


class Estimate(TimestampMixin, Base):
    """Mirrors APEX's real paper/Excel estimate format: fixed phase sections
    (Rough-In, Supply & Install, Customer-Supplied Fixtures, Panels & Meters,
    Permits), each line priced with separate material and labor costs, then
    Profit % and a repeat-customer Discount % on top."""

    __tablename__ = "estimates"

    id: Mapped[int] = mapped_column(primary_key=True)
    estimate_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    job_id: Mapped[int | None] = mapped_column(ForeignKey("jobs.id"), index=True)
    customer: Mapped[str | None] = mapped_column(String(200))
    address: Mapped[str | None] = mapped_column(String(300))
    scope_of_work: Mapped[str] = mapped_column(Text, nullable=False)
    exclusions: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(10), default="draft", nullable=False)  # draft | sent | approved | declined
    profit_pct: Mapped[Decimal] = mapped_column(Num(6, 2), default=Decimal("0"), nullable=False)
    discount_pct: Mapped[Decimal] = mapped_column(Num(6, 2), default=Decimal("0"), nullable=False)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))

    sections: Mapped[list["EstimateSection"]] = relationship(
        back_populates="estimate", cascade="all, delete-orphan", order_by="EstimateSection.sort_order")
    creator: Mapped["User | None"] = relationship()
    job: Mapped["Job | None"] = relationship()


class EstimateSection(TimestampMixin, Base):
    """A phase of the job (see APEX's standard 5 above) -- order is fixed by
    sort_order so the sheet always reads Rough-In -> ... -> Permits."""

    __tablename__ = "estimate_sections"

    id: Mapped[int] = mapped_column(primary_key=True)
    estimate_id: Mapped[int] = mapped_column(ForeignKey("estimates.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    sort_order: Mapped[int] = mapped_column(default=0, nullable=False)

    estimate: Mapped[Estimate] = relationship(back_populates="sections")
    lines: Mapped[list["EstimateLine"]] = relationship(
        back_populates="section", cascade="all, delete-orphan", order_by="EstimateLine.sort_order")


class EstimateLine(TimestampMixin, Base):
    __tablename__ = "estimate_lines"

    id: Mapped[int] = mapped_column(primary_key=True)
    section_id: Mapped[int] = mapped_column(ForeignKey("estimate_sections.id"), nullable=False, index=True)
    item_id: Mapped[int | None] = mapped_column(ForeignKey("items.id"))  # null = custom/free-text line
    description: Mapped[str] = mapped_column(String(300), nullable=False)
    qty: Mapped[Decimal] = mapped_column(Num(12, 2), default=Decimal("1"), nullable=False)
    unit: Mapped[str] = mapped_column(String(10), default="each", nullable=False)
    material_unit_cost: Mapped[Decimal] = mapped_column(Num(12, 4), default=Decimal("0"), nullable=False)
    labor_unit_cost: Mapped[Decimal] = mapped_column(Num(12, 4), default=Decimal("0"), nullable=False)
    sort_order: Mapped[int] = mapped_column(default=0, nullable=False)

    section: Mapped[EstimateSection] = relationship(back_populates="lines")
    item: Mapped["Item | None"] = relationship()


class EstimateChecklistItem(TimestampMixin, Base):
    """A custom item someone typed into the estimate wizard's "Not on the
    list?" box -- saved so it shows up as a normal checkbox option for that
    section on every future estimate, instead of needing to be retyped."""

    __tablename__ = "estimate_checklist_items"
    __table_args__ = (UniqueConstraint("section", "label", name="uq_checklist_section_label"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    section: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    label: Mapped[str] = mapped_column(String(200), nullable=False)


class Transaction(TimestampMixin, Base):
    """The ledger — source of truth for every stock change."""

    __tablename__ = "transactions"
    __table_args__ = (
        Index("ix_txn_item_created", "item_id", "created_at"),
        Index("ix_txn_job", "job_id"),
        Index("ix_txn_user", "user_id"),
        Index("ix_txn_type_created", "type", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    type: Mapped[str] = mapped_column(String(10), nullable=False)  # RECEIVE | SIGN_OUT | RETURN | TRANSFER | ADJUST
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id"), nullable=False)
    qty: Mapped[Decimal] = mapped_column(Num(12, 2), nullable=False)  # always positive
    from_location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"))
    to_location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"))
    job_id: Mapped[int | None] = mapped_column(ForeignKey("jobs.id"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    vendor_id: Mapped[int | None] = mapped_column(ForeignKey("vendors.id"))
    unit_cost: Mapped[Decimal | None] = mapped_column(Num(10, 4))  # snapshot at txn time
    tax_amount: Mapped[Decimal | None] = mapped_column(Num(10, 2))  # RECEIVE only; not part of item cost basis
    ref: Mapped[str | None] = mapped_column(String(100))
    note: Mapped[str | None] = mapped_column(Text)
    reason: Mapped[str | None] = mapped_column(String(30))  # ADJUST only
    went_negative: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    item: Mapped[Item] = relationship()
    from_location: Mapped[Location | None] = relationship(foreign_keys=[from_location_id])
    to_location: Mapped[Location | None] = relationship(foreign_keys=[to_location_id])
    job: Mapped[Job | None] = relationship()
    user: Mapped[User] = relationship()
    vendor: Mapped[Vendor | None] = relationship()
