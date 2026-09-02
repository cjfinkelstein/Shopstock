from datetime import datetime, timezone
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_serializer


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class TimestampedOut(ApiModel):
    created_at: datetime
    updated_at: datetime

    @field_serializer("created_at", "updated_at", check_fields=False)
    def _ser_dt(self, v: datetime, _info):
        # DB stores naive UTC; serialize as explicit UTC ISO-8601.
        if v.tzinfo is None:
            v = v.replace(tzinfo=timezone.utc)
        return v.isoformat()


# ---------- Auth ----------

class TapIn(BaseModel):
    user_id: int
    pin: str | None = None


class AdminLogin(BaseModel):
    email: str
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserOut"


# ---------- Users ----------

class UserBase(BaseModel):
    name: str
    role: str = Field(pattern="^(tech|admin)$")
    email: str | None = None


class UserCreate(UserBase):
    password: str | None = None
    pin: str | None = Field(default=None, pattern=r"^\d{4}$")


class UserUpdate(BaseModel):
    name: str | None = None
    email: str | None = None
    password: str | None = None
    pin: str | None = Field(default=None, pattern=r"^\d{4}$")
    clear_pin: bool = False
    active: bool | None = None


class UserOut(TimestampedOut):
    id: int
    name: str
    role: str
    email: str | None
    active: bool
    has_pin: bool = False
    pin: str | None = None  # plaintext — populated for admin views only


class ChangePinIn(BaseModel):
    new_pin: str = Field(pattern=r"^\d{4}$")
    current_pin: str | None = None


class TechTapOut(ApiModel):
    """Unauthenticated tap-screen payload — names only."""
    id: int
    name: str
    has_pin: bool = False


# ---------- Time clock ----------

class ClockInIn(BaseModel):
    job_id: int
    lat: float | None = None
    lng: float | None = None


class ClockOutIn(BaseModel):
    lat: float | None = None
    lng: float | None = None


class LocationPingIn(BaseModel):
    lat: float
    lng: float


def _utc_iso(v: datetime | None) -> str | None:
    # DB stores naive UTC; serialize as explicit UTC ISO-8601 so the
    # browser doesn't misread it as local time.
    if v is None:
        return None
    if v.tzinfo is None:
        v = v.replace(tzinfo=timezone.utc)
    return v.isoformat()


class ClockStatusOut(BaseModel):
    clocked_in: bool
    clock_event_id: int | None = None
    clock_in_at: datetime | None = None
    job_id: int | None = None
    job_number: str | None = None
    job_name: str | None = None
    gps_consent_given: bool = False

    @field_serializer("clock_in_at")
    def _ser_clock_in_at(self, v: datetime | None, _info):
        return _utc_iso(v)


class WorkerLiveOut(BaseModel):
    user_id: int
    user_name: str
    job_number: str | None = None
    job_name: str | None = None
    clock_in_at: datetime
    lat: float | None = None
    lng: float | None = None
    last_ping_at: datetime | None = None

    @field_serializer("clock_in_at", "last_ping_at")
    def _ser_dt(self, v: datetime | None, _info):
        return _utc_iso(v)


class MyShiftOut(BaseModel):
    id: int
    clock_in_at: datetime
    clock_out_at: datetime | None = None
    still_clocked_in: bool
    hours: float
    job_number: str | None = None
    job_name: str | None = None

    @field_serializer("clock_in_at", "clock_out_at")
    def _ser_dt(self, v: datetime | None, _info):
        return _utc_iso(v)


# ---------- Trucks / Locations / Vendors ----------

class TruckCreate(BaseModel):
    name: str
    assigned_user_id: int | None = None


class TruckUpdate(BaseModel):
    name: str | None = None
    assigned_user_id: int | None = None
    clear_assignment: bool = False
    active: bool | None = None


class LocationOut(ApiModel):
    id: int
    type: str
    truck_id: int | None
    name: str
    active: bool


class TruckOut(TimestampedOut):
    id: int
    name: str
    assigned_user_id: int | None
    active: bool
    location: LocationOut | None = None
    assigned_user_name: str | None = None


class VendorCreate(BaseModel):
    name: str


class VendorUpdate(BaseModel):
    name: str | None = None
    active: bool | None = None


class VendorOut(TimestampedOut):
    id: int
    name: str
    active: bool


# ---------- Items ----------

class ItemBase(BaseModel):
    sku: str
    barcode: str | None = None
    name: str
    description: str | None = None
    image_data: str | None = None
    category: str
    unit: str = Field(pattern="^(each|box|foot)$")
    reorder_point: Decimal = Decimal("0")
    reorder_qty: Decimal = Decimal("0")
    notes: str | None = None


class ItemCreate(ItemBase):
    pass


class ItemUpdate(BaseModel):
    sku: str | None = None
    barcode: str | None = None
    name: str | None = None
    description: str | None = None
    image_data: str | None = None
    category: str | None = None
    unit: str | None = Field(default=None, pattern="^(each|box|foot)$")
    reorder_point: Decimal | None = None
    reorder_qty: Decimal | None = None
    notes: str | None = None
    active: bool | None = None


class ItemTechOut(TimestampedOut):
    """Tech-facing item — cost fields stripped server-side."""
    id: int
    sku: str
    barcode: str
    name: str
    description: str | None
    image_data: str | None = None
    category: str
    unit: str
    active: bool
    notes: str | None


class ItemAdminOut(ItemTechOut):
    avg_cost: Decimal
    last_cost: Decimal
    reorder_point: Decimal
    reorder_qty: Decimal
    vendors: list[str] = []
    on_hand: Decimal = Decimal("0")
    received: Decimal = Decimal("0")
    used: Decimal = Decimal("0")
    total_spent: Decimal = Decimal("0")
    dates_bought: list[str] = []


class ItemStockRow(ApiModel):
    location_id: int
    location_name: str
    location_type: str
    qty: Decimal


class ItemStockOut(BaseModel):
    item_id: int
    total: Decimal
    locations: list[ItemStockRow]


# ---------- Jobs ----------

class JobCreate(BaseModel):
    job_number: str
    name: str
    customer: str | None = None
    address: str | None = None


class JobUpdate(BaseModel):
    job_number: str | None = None
    name: str | None = None
    customer: str | None = None
    address: str | None = None
    status: str | None = Field(default=None, pattern="^(active|closed)$")


class JobOut(TimestampedOut):
    id: int
    job_number: str
    name: str
    customer: str | None
    address: str | None
    status: str


class JobMaterialLine(BaseModel):
    item_id: int
    sku: str
    name: str
    unit: str
    image_data: str | None = None
    source: str  # "Stock", a truck name, or "Mixed" -- where this line came from
    vendor: str | None = None  # who this item was originally purchased from
    qty_signed_out: Decimal
    qty_returned: Decimal
    net_qty: Decimal
    avg_snapshot_cost: Decimal
    net_cost: Decimal


class JobActivityLine(BaseModel):
    """One raw SIGN_OUT/RETURN event -- the individual-transaction detail
    underneath the per-item rollup in `lines`."""
    id: int
    created_at: datetime
    type: str  # SIGN_OUT | RETURN
    sku: str
    item_name: str
    unit: str
    image_data: str | None = None
    qty: Decimal
    source: str
    vendor: str | None = None
    user_name: str

    @field_serializer("created_at")
    def _ser_dt(self, v: datetime, _info):
        if v.tzinfo is None:
            v = v.replace(tzinfo=timezone.utc)
        return v.isoformat()


class JobMaterialsOut(BaseModel):
    job: JobOut
    lines: list[JobMaterialLine]
    activity: list[JobActivityLine] = []
    total_cost: Decimal


class JobFileOut(TimestampedOut):
    id: int
    job_id: int
    kind: str  # photo | document
    filename: str
    mime_type: str
    data: str
    uploaded_by_name: str | None = None


class JobFileMetaOut(TimestampedOut):
    """Same as JobFileOut but without the (potentially huge) base64 `data` field --
    used for list views so fetching a job's file list can't balloon memory on a job
    with many/large files. Fetch a single file's data via GET /jobs/files/{id}."""
    id: int
    job_id: int
    kind: str  # photo | document
    filename: str
    mime_type: str
    size_bytes: int
    uploaded_by_name: str | None = None


class JobFileIn(BaseModel):
    kind: str = Field(pattern="^(photo|document)$")
    filename: str
    mime_type: str
    data: str  # data: URL


# ---------- Estimates ----------

class EstimateLineIn(BaseModel):
    item_id: int | None = None
    description: str
    qty: Decimal = Decimal("1")
    unit: str = "each"
    material_unit_cost: Decimal = Decimal("0")
    labor_unit_cost: Decimal = Decimal("0")


class EstimateSectionIn(BaseModel):
    name: str
    lines: list[EstimateLineIn] = []


class EstimateCreate(BaseModel):
    job_id: int | None = None
    customer: str | None = None
    address: str | None = None
    scope_of_work: str = ""
    profit_pct: Decimal = Decimal("0")
    discount_pct: Decimal = Decimal("0")


class EstimateUpdate(BaseModel):
    job_id: int | None = None
    clear_job: bool = False
    customer: str | None = None
    address: str | None = None
    scope_of_work: str | None = None
    exclusions: str | None = None
    status: str | None = Field(default=None, pattern="^(draft|sent|approved|declined)$")
    profit_pct: Decimal | None = None
    discount_pct: Decimal | None = None
    sections: list[EstimateSectionIn] | None = None  # replaces the full section+line set when provided


class EstimateLineOut(BaseModel):
    id: int
    item_id: int | None
    sku: str | None = None
    image_data: str | None = None
    description: str
    qty: Decimal
    unit: str
    material_unit_cost: Decimal
    labor_unit_cost: Decimal
    material_total: Decimal
    labor_total: Decimal
    line_total: Decimal


class EstimateSectionOut(BaseModel):
    id: int
    name: str
    lines: list[EstimateLineOut] = []
    section_total: Decimal


class EstimateOut(TimestampedOut):
    id: int
    estimate_number: str
    job_id: int | None = None
    job_number: str | None = None
    customer: str | None
    address: str | None
    scope_of_work: str
    exclusions: str | None
    status: str
    profit_pct: Decimal
    discount_pct: Decimal
    material_total: Decimal
    labor_total: Decimal
    subtotal: Decimal
    profit_amount: Decimal
    discount_amount: Decimal
    total: Decimal
    created_by_name: str | None = None
    sections: list[EstimateSectionOut] = []


class EstimateSummaryOut(TimestampedOut):
    """List-view row -- no line items."""
    id: int
    estimate_number: str
    job_id: int | None = None
    customer: str | None
    status: str
    total: Decimal


class ChecklistItemIn(BaseModel):
    section: str
    label: str


class ChecklistItemOut(BaseModel):
    id: int
    section: str
    label: str


class PlanAnalyzeIn(BaseModel):
    filename: str
    data: str  # data: URL, base64 PDF


class PlanAnalyzeItem(BaseModel):
    section: str
    label: str
    qty: float


class PlanAnalyzeOut(BaseModel):
    sheet_type: str
    confidence_note: str
    items: list[PlanAnalyzeItem]


# ---------- Transactions ----------

class ReceiveIn(BaseModel):
    item_id: int
    qty: Decimal
    vendor_id: int
    unit_cost: Decimal
    to_location_id: int | None = None  # defaults to shop
    ref: str | None = None
    note: str | None = None


class ReceiveBatchIn(BaseModel):
    vendor_id: int
    to_location_id: int | None = None
    ref: str | None = None
    lines: list["ReceiveBatchLine"]


class ReceiveBatchLine(BaseModel):
    item_id: int
    qty: Decimal
    unit_cost: Decimal
    note: str | None = None


class SignOutIn(BaseModel):
    item_id: int
    qty: Decimal
    from_location_id: int
    job_id: int
    note: str | None = None


class SignOutBatchIn(BaseModel):
    job_id: int
    from_location_id: int | None = None  # default source for lines that don't specify one
    note: str | None = None
    lines: list["BatchLine"]


class BatchLine(BaseModel):
    item_id: int
    qty: Decimal
    from_location_id: int | None = None


class ReturnIn(BaseModel):
    item_id: int
    qty: Decimal
    job_id: int
    to_location_id: int
    note: str | None = None


class TransferIn(BaseModel):
    item_id: int
    qty: Decimal
    from_location_id: int
    to_location_id: int
    note: str | None = None


class TransferBatchIn(BaseModel):
    from_location_id: int
    to_location_id: int
    note: str | None = None
    lines: list["TransferBatchLine"]


class TransferBatchLine(BaseModel):
    item_id: int
    qty: Decimal


class AdjustIn(BaseModel):
    item_id: int
    qty: Decimal
    location_id: int
    direction: str = Field(pattern="^(increase|decrease)$")
    reason: str = Field(pattern="^(count_correction|damaged|lost|other)$")
    note: str


class TxnTechOut(TimestampedOut):
    """Tech-facing transaction — unit_cost stripped server-side."""
    id: int
    type: str
    item_id: int
    item_sku: str | None = None
    item_name: str | None = None
    item_unit: str | None = None
    item_image: str | None = None
    qty: Decimal
    from_location_id: int | None
    from_location_name: str | None = None
    to_location_id: int | None
    to_location_name: str | None = None
    job_id: int | None
    job_number: str | None = None
    job_name: str | None = None
    user_id: int
    user_name: str | None = None
    ref: str | None
    note: str | None
    reason: str | None
    went_negative: bool


class TxnAdminOut(TxnTechOut):
    unit_cost: Decimal | None
    tax_amount: Decimal | None = None
    vendor_id: int | None
    vendor_name: str | None = None


class TxnPage(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[TxnTechOut] | list[TxnAdminOut]


# ---------- Stock / valuation ----------

class StockRow(ApiModel):
    item_id: int
    sku: str
    name: str
    category: str
    unit: str
    image_data: str | None = None
    location_id: int
    location_name: str
    qty: Decimal


class ValuationRow(BaseModel):
    location_id: int
    location_name: str
    value: Decimal


class ValuationOut(BaseModel):
    by_location: list[ValuationRow]
    total: Decimal


# ---------- Labels ----------

class LabelPrintIn(BaseModel):
    item_ids: list[int]
    copies_per_item: int = Field(default=1, ge=1, le=30)


TokenOut.model_rebuild()
ReceiveBatchIn.model_rebuild()
SignOutBatchIn.model_rebuild()
TransferBatchIn.model_rebuild()
