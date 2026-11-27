import base64
import io
import logging
import re
import secrets
from pathlib import Path
from decimal import ROUND_CEILING, Decimal

import pymupdf as fitz
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font
from sqlalchemy.orm import Session, joinedload

from app.auth import require_admin
from app.config import settings
from app.database import get_db
from app.models import (
    Estimate, EstimateChecklistItem, EstimateLine, EstimatePlanMarker, EstimatePlanPage, EstimateSection, Item,
    Job, User, utcnow,
)
from app.schemas import (
    ChecklistItemIn, ChecklistItemOut, EstimateCreate, EstimateLineOut, EstimateOut, EstimateSectionOut,
    EstimateSummaryOut, EstimateUpdate, PlanAnalyzeIn, PlanAnalyzeOut, PlanMarkerIn, PlanMarkerOut,
    PlanMarkerUpdate, PlanOut, PlanPageOut, PlanUploadIn,
)
from app.services.mailer import send_estimate_email
from app.services.plan_analysis import analyze_plan_sheet, decode_pdf_data_url, propose_plan_markers

router = APIRouter(prefix="/estimates", tags=["estimates"], dependencies=[Depends(require_admin)])
logger = logging.getLogger(__name__)


# Declared before the "/{estimate_id}" routes below so "checklist-items"
# never risks being swallowed by the int-typed path parameter.
@router.get("/checklist-items", response_model=list[ChecklistItemOut])
def list_checklist_items(db: Session = Depends(get_db)):
    return db.query(EstimateChecklistItem).order_by(EstimateChecklistItem.section, EstimateChecklistItem.label).all()


@router.post("/checklist-items", response_model=ChecklistItemOut, status_code=201)
def add_checklist_item(body: ChecklistItemIn, db: Session = Depends(get_db)):
    label = body.label.strip()
    existing = (
        db.query(EstimateChecklistItem)
        .filter(EstimateChecklistItem.section == body.section, EstimateChecklistItem.label.ilike(label))
        .first()
    )
    if existing:
        return existing
    item = EstimateChecklistItem(section=body.section, label=label)
    db.add(item)
    db.commit()
    return item


@router.delete("/checklist-items/{item_id}", status_code=204)
def delete_checklist_item(item_id: int, db: Session = Depends(get_db)):
    item = db.get(EstimateChecklistItem, item_id)
    if item:
        db.delete(item)
        db.commit()


# Declared before "/{estimate_id}" for the same reason as checklist-items above.
@router.post("/analyze-plan", response_model=PlanAnalyzeOut)
def analyze_plan(body: PlanAnalyzeIn):
    try:
        raw = decode_pdf_data_url(body.data)
    except Exception:
        raise HTTPException(status_code=400, detail="Couldn't read that file")
    if len(raw) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Plan sheet is too large (20MB limit)")
    try:
        result = analyze_plan_sheet(base64.b64encode(raw).decode())
    except RuntimeError as e:
        if "ANTHROPIC_API_KEY" in str(e):
            raise HTTPException(
                status_code=503,
                detail="AI plan reading isn't set up yet on this server -- ask your admin to add an API key.",
            )
        raise HTTPException(status_code=502, detail=str(e))
    return result

# APEX's standard phases, in the order they always appear on a real estimate
# (see "APEX Scope of Work Template 2025.docx" plus real jobs like Autumn
# Lake Bradford Dialysis and Leshnoff Townhomes, which also use Demolition
# and Miscellaneous on top of the template's five). Every new estimate gets
# all seven up front so the sheet always reads the same way, even if some
# end up empty.
STANDARD_SECTIONS = [
    "Demolition",
    "Rough-In Electrical Work",
    "Supply and Install",
    "Install Customer-Supplied Fixtures",
    "Panels and Meters",
    "Miscellaneous",
    "Permits, Inspection & Finalization",
]

# Keyword cues used to route a scope-of-work line into the right phase --
# checked in this order, first match wins. Demolition is checked first since
# a demo line can otherwise get misrouted by an incidental "panel"/"outlet"
# mention (e.g. "Demo the following: 1 Panel").
SECTION_CUES = [
    ("Demolition", ("demo", "demolition", "remove and", "remove existing")),
    ("Panels and Meters", ("panel", "meter", "disconnect", "breaker", "service upgrade", "ground rod", "riser", "transformer")),
    ("Permits, Inspection & Finalization", ("permit", "inspection")),
    ("Install Customer-Supplied Fixtures", ("customer-supplied", "customer supplied", "owner-supplied", "owner supplied")),
    ("Rough-In Electrical Work", ("rough-in", "rough in", "rough wiring")),
    ("Miscellaneous", ("relocate", "clean up", "cleanup", "miscellaneous", "misc.")),
]
DEFAULT_SECTION = "Supply and Install"

# Rough placeholder labor-per-unit, not fixture-specific pricing -- pulled
# from what actually recurs across APEX's real estimates (Leshnoff,
# Shelleydale, Autumn Lake, the Zakem target file all land in this range for
# ordinary devices). Without this, every drafted line had $0 labor and the
# total read as raw material cost only -- wildly under real project cost,
# since labor is usually the bigger half of the number.
DEFAULT_ROUGH_IN_LABOR = Decimal("35")
DEFAULT_SUPPLY_INSTALL_LABOR = Decimal("40")
# Rough-in isn't just labor -- wire, boxes, connectors, and staples to get a
# fixture ready for trim-out are real material cost too, even though it's a
# different set of parts than the device itself. $15/unit is the typical
# rough-in material cost across the same real jobs above.
DEFAULT_ROUGH_IN_MATERIAL = Decimal("15")

# A scope line phrased as "X will provide/supply Y" or "Y supplied/furnished
# by X" is telling you what's explicitly OUT of Apex's material scope --
# never run those through catalog matching, and file them under
# Customer-Supplied Fixtures regardless of what other cues the line contains.
# Doesn't apply when APEX is the one doing the providing ("Apex will supply
# all raw materials...") -- that confirms it's normal in-scope material, so
# those lines are just skipped rather than filed as an exclusion.
OTHER_SUPPLIED_PHRASES = ("will provide", "will supply", "supplied by", "provided by", "furnished by", "by others")
COMPANY_NAME_HINTS = ("apex",)
# "Separate quote for X" means X is being priced elsewhere, not part of this
# estimate -- keep normal section routing (so it still lands under Panels and
# Meters etc.) but skip catalog matching so it shows as a note, not a priced guess.
SEPARATE_QUOTE_PHRASES = ("separate quote", "separate estimate", "separate proposal")

STOPWORDS = {
    "a", "an", "the", "and", "or", "for", "with", "to", "of", "in", "on", "at", "by", "from",
    "install", "installing", "installed", "add", "adding", "new", "all", "each", "per",
    "run", "wire", "wiring", "up", "into", "provide", "furnish", "existing", "as", "needed",
}


def _next_estimate_number(db: Session) -> str:
    count = db.query(Estimate).count()
    return f"EST-{1001 + count}"


def _singularize(word: str) -> str:
    """Scope text is almost always plural ("Outlets", "Switches") while
    catalog item names are singular ("20A Duplex Receptacle") -- without
    this, matching silently misses on an exact-word-set intersection."""
    if word.endswith("ies") and len(word) > 4:
        return word[:-3] + "y"  # batteries -> battery
    if word.endswith(("ches", "shes", "xes", "ses")) and len(word) > 4:
        return word[:-2]  # switches -> switch, boxes -> box
    if word.endswith("s") and not word.endswith("ss") and len(word) > 3:
        return word[:-1]  # outlets -> outlet, lights -> light, detectors -> detector
    return word


def _significant_words(text: str) -> list[str]:
    # Electrical specs are often number-led ("12/2", "3/4\"", "20A") -- those
    # matter more for matching than plain words, so don't require a letter
    # first, just drop bare numbers (a lone "150" or "20" isn't descriptive).
    tokens = re.findall(r"[a-zA-Z0-9][a-zA-Z0-9/\-]{1,}", text.lower())
    return [_singularize(w) for w in tokens if w not in STOPWORDS and not w.isdigit()]


def _section_for_line(line: str) -> str:
    low = line.lower()
    for name, cues in SECTION_CUES:
        if any(c in low for c in cues):
            return name
    return DEFAULT_SECTION


def _extract_qty(line: str) -> tuple[Decimal, str | None]:
    """Returns (qty, note) -- note is set when a range like "30-35" had to be
    resolved to a single number, so the caller can flag the assumption."""
    range_match = re.search(r"\b(\d+)\s*-\s*(\d+)\b", line)
    if range_match:
        lo, hi = Decimal(range_match.group(1)), Decimal(range_match.group(2))
        if hi > lo:
            qty = ((lo + hi) / 2).quantize(Decimal("1"), rounding=ROUND_CEILING)
            return qty, f'"{line.strip()}" — assumed {qty} (midpoint of the {int(lo)}-{int(hi)} range you gave); adjust once finalized.'
    # A number that's part of a spec, not a count, is never the quantity:
    # "3-way"/"4-gang" (glued to a hyphen), "200 amp"/"20A" (an amperage rating).
    qty_match = re.search(r"\b(\d+(?:\.\d+)?)\b(?!-)(?!\s*[Aa](?:mp)?\b)", line)
    qty = Decimal(qty_match.group(1)) if qty_match else Decimal("1")
    return qty, None


def _draft_sections_from_scope(db: Session, scope_of_work: str) -> tuple[dict[str, list[dict]], list[str]]:
    """Best-effort starting point, not a real estimator: for each line of the
    scope of work, guess which phase it belongs to and score active items by
    word overlap with their name/category/description. Returns the drafted
    sections plus a plain-English list of assumptions made along the way, so
    nothing is silently guessed without a paper trail. The admin is expected
    to review/adjust -- and fill in labor, which this can't guess -- before
    sending anything out."""
    # Wall/cover plates are always bundled into installing the device they
    # cover -- they're never their own labor task, so they shouldn't ever
    # become their own draft line (previously they'd ride along as a
    # same-scored second match and get charged full device labor, e.g. a
    # wall plate "costing" $40 of labor same as the receptacle it covers).
    items = [i for i in db.query(Item).filter(Item.active).all() if "plate" not in i.name.lower()]
    item_words = {
        i.id: set(_significant_words(f"{i.name} {i.category} {i.description or ''}"))
        for i in items
    }
    by_id = {i.id: i for i in items}

    drafts: dict[str, list[dict]] = {name: [] for name in STANDARD_SECTIONS}
    notes: list[str] = []
    seen: set[int] = set()
    for raw_line in re.split(r"[\n\r]+|(?<=[.;])\s+", scope_of_work):
        line = raw_line.strip()
        if not line:
            continue
        line_words = set(_significant_words(line))
        if not line_words:
            continue
        scored = sorted(
            ((len(line_words & words), iid) for iid, words in item_words.items() if words),
            reverse=True,
        )
        qty, range_note = _extract_qty(line)
        if range_note:
            notes.append(range_note)
        low = line.lower()
        if any(p in low for p in OTHER_SUPPLIED_PHRASES):
            if any(h in low for h in COMPANY_NAME_HINTS):
                # "Apex will provide all raw materials..." confirms this IS
                # Apex's scope -- a summary statement, not a new line item
                # (the specific fixtures are already itemized elsewhere).
                continue
            # "I Heart will provide the heaters..." -- this is telling you
            # what's explicitly NOT Apex's material to buy, so it always
            # goes to Customer-Supplied Fixtures as a note, never matched
            # against the purchasing catalog.
            drafts["Install Customer-Supplied Fixtures"].append({
                "item_id": None, "description": line, "qty": qty,
                "unit": "each", "material_unit_cost": Decimal("0"), "labor_unit_cost": Decimal("0"),
            })
            notes.append(f'"{line}" — filed as customer/other-supplied; confirm before finalizing.')
            continue

        section = _section_for_line(line)
        is_separate_quote = any(p in low for p in SEPARATE_QUOTE_PHRASES)
        skip_matching = section in ("Permits, Inspection & Finalization", "Demolition") or is_separate_quote
        if skip_matching:
            # Permits/inspections are a service charge, demo work is labor
            # tearing things OUT (not material being bought), and a
            # "separate quote" line is being priced elsewhere entirely --
            # none of those should get matched against the purchasing
            # catalog. Drop in a blank line to price instead of risking a
            # nonsense catalog match on a stray word.
            drafts[section].append({
                "item_id": None, "description": line, "qty": qty,
                "unit": "each", "material_unit_cost": Decimal("0"), "labor_unit_cost": Decimal("0"),
            })
            if is_separate_quote:
                notes.append(f'"{line}" — priced separately; NOT included in this estimate\'s total.')
            continue
        # One match per scope line, not several -- a second, weaker-scored
        # match riding along used to add unrelated accessories as their own
        # fully-labor-priced line (see the wall-plate note above).
        for score, iid in scored[:1]:
            if score == 0 or iid in seen:
                continue
            seen.add(iid)
            item = by_id[iid]
            drafts[section].append({
                "item_id": item.id,
                "description": item.name,
                "qty": qty,
                "unit": item.unit,
                "material_unit_cost": item.avg_cost or item.last_cost or Decimal("0"),
                "labor_unit_cost": DEFAULT_SUPPLY_INSTALL_LABOR,
            })
            if section == DEFAULT_SECTION:
                # APEX's real jobs consistently price every fixture twice:
                # once here for the device itself, and once in Rough-In for
                # the wire/box material and labor to prep for it beforehand.
                drafts["Rough-In Electrical Work"].append({
                    "item_id": None, "description": f"Rough-in wiring for: {item.name}", "qty": qty,
                    "unit": item.unit, "material_unit_cost": DEFAULT_ROUGH_IN_MATERIAL,
                    "labor_unit_cost": DEFAULT_ROUGH_IN_LABOR,
                })
    if notes or any(drafts.values()):
        # Only worth a note if something was actually auto-drafted -- a
        # blank estimate started for manual item-picking shouldn't get a
        # disclaimer about auto-draft assumptions it never made.
        notes.append(
            f"Material/labor on Rough-In and Supply-and-Install lines are flat placeholders "
            f"(${DEFAULT_ROUGH_IN_MATERIAL}/${DEFAULT_ROUGH_IN_LABOR} per unit rough-in, ${DEFAULT_SUPPLY_INSTALL_LABOR} "
            "labor supply-install) based on typical costs in past jobs, NOT priced per fixture -- adjust anything "
            "more complex (panels, equipment connections, custom work) before sending this out."
        )
    return drafts, notes


def _line_totals(l: EstimateLine) -> tuple[Decimal, Decimal, Decimal]:
    material = (l.qty * l.material_unit_cost).quantize(Decimal("0.01"))
    labor = (l.qty * l.labor_unit_cost).quantize(Decimal("0.01"))
    return material, labor, material + labor


def _serialize(estimate: Estimate) -> EstimateOut:
    material_total = Decimal("0.00")
    labor_total = Decimal("0.00")
    section_outs = []
    for section in estimate.sections:
        line_outs = []
        section_total = Decimal("0.00")
        for l in section.lines:
            m, lb, tot = _line_totals(l)
            material_total += m
            labor_total += lb
            section_total += tot
            line_outs.append(EstimateLineOut(
                id=l.id, item_id=l.item_id, sku=l.item.sku if l.item else None,
                image_data=l.item.image_data if l.item else None, description=l.description,
                qty=l.qty, unit=l.unit, material_unit_cost=l.material_unit_cost,
                labor_unit_cost=l.labor_unit_cost, material_total=m, labor_total=lb, line_total=tot,
            ))
        section_outs.append(EstimateSectionOut(id=section.id, name=section.name, lines=line_outs, section_total=section_total))

    subtotal = material_total + labor_total
    profit_amount = (subtotal * estimate.profit_pct / Decimal("100")).quantize(Decimal("0.01"))
    discount_amount = ((subtotal + profit_amount) * estimate.discount_pct / Decimal("100")).quantize(Decimal("0.01"))
    total = (subtotal + profit_amount - discount_amount).quantize(Decimal("0.01"))

    return EstimateOut(
        id=estimate.id, estimate_number=estimate.estimate_number,
        job_id=estimate.job_id, job_number=estimate.job.job_number if estimate.job else None,
        customer=estimate.customer,
        address=estimate.address, customer_email=estimate.customer_email,
        scope_of_work=estimate.scope_of_work, exclusions=estimate.exclusions,
        status=estimate.status, profit_pct=estimate.profit_pct, discount_pct=estimate.discount_pct,
        material_total=material_total, labor_total=labor_total, subtotal=subtotal,
        profit_amount=profit_amount, discount_amount=discount_amount, total=total,
        created_by_name=estimate.creator.name if estimate.creator else None,
        created_at=estimate.created_at, updated_at=estimate.updated_at, sections=section_outs,
        share_token=estimate.share_token, sent_at=estimate.sent_at, responded_at=estimate.responded_at,
    )


def _get_or_404(db: Session, estimate_id: int) -> Estimate:
    est = (
        db.query(Estimate)
        .options(
            joinedload(Estimate.sections).joinedload(EstimateSection.lines).joinedload(EstimateLine.item),
            joinedload(Estimate.creator),
            joinedload(Estimate.job),
        )
        .filter(Estimate.id == estimate_id, Estimate.active.is_(True))
        .first()
    )
    if not est:
        raise HTTPException(status_code=404, detail="Estimate not found")
    return est


def _get_active_estimate_light(db: Session, estimate_id: int) -> Estimate:
    """Same existence/active check as _get_or_404, without its eager-loaded
    sections->lines->items join. Plan-marker CRUD fires on every single
    click while marking up a plan and never touches sections at all -- on
    an estimate with hundreds of lines (or hundreds of markers across
    several apply cycles), that join multiplies into a large result set
    every call and was adding real per-click latency/lag on a dense
    commercial plan. This just confirms the estimate exists and is active."""
    est = db.query(Estimate).filter(Estimate.id == estimate_id, Estimate.active.is_(True)).first()
    if not est:
        raise HTTPException(status_code=404, detail="Estimate not found")
    return est


@router.get("", response_model=list[EstimateSummaryOut])
def list_estimates(job_id: int | None = None, db: Session = Depends(get_db)):
    q = db.query(Estimate).options(joinedload(Estimate.sections).joinedload(EstimateSection.lines)).filter(Estimate.active.is_(True))
    if job_id is not None:
        q = q.filter(Estimate.job_id == job_id)
    rows = q.order_by(Estimate.created_at.desc()).all()
    out = []
    for e in rows:
        subtotal = Decimal("0.00")
        for section in e.sections:
            for l in section.lines:
                _, _, tot = _line_totals(l)
                subtotal += tot
        profit_amount = (subtotal * e.profit_pct / Decimal("100")).quantize(Decimal("0.01"))
        discount_amount = ((subtotal + profit_amount) * e.discount_pct / Decimal("100")).quantize(Decimal("0.01"))
        total = (subtotal + profit_amount - discount_amount).quantize(Decimal("0.01"))
        out.append(EstimateSummaryOut(
            id=e.id, estimate_number=e.estimate_number, job_id=e.job_id, customer=e.customer, status=e.status,
            total=total, created_at=e.created_at, updated_at=e.updated_at,
        ))
    return out


@router.get("/{estimate_id}", response_model=EstimateOut)
def get_estimate(estimate_id: int, db: Session = Depends(get_db)):
    return _serialize(_get_or_404(db, estimate_id))


def _notes_to_text(notes: list[str]) -> str:
    if not notes:
        return ""
    return "Notes / assumptions from the auto-draft:\n" + "\n".join(f"- {n}" for n in notes)


@router.post("", response_model=EstimateOut, status_code=201)
def create_estimate(body: EstimateCreate, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    job = db.get(Job, body.job_id) if body.job_id else None
    if body.job_id and not job:
        raise HTTPException(status_code=404, detail="Job not found")
    estimate = Estimate(
        estimate_number=_next_estimate_number(db), job_id=body.job_id,
        customer=body.customer or ((job.customer or job.name) if job else None),
        address=body.address or (job.address if job else None),
        scope_of_work=body.scope_of_work, profit_pct=body.profit_pct, discount_pct=body.discount_pct,
        created_by=user.id,
    )
    db.add(estimate)
    db.flush()

    drafts, notes = _draft_sections_from_scope(db, body.scope_of_work)
    estimate.exclusions = _notes_to_text(notes)
    for order, name in enumerate(STANDARD_SECTIONS):
        section = EstimateSection(estimate_id=estimate.id, name=name, sort_order=order)
        db.add(section)
        db.flush()
        for line_order, draft in enumerate(drafts.get(name, [])):
            db.add(EstimateLine(section_id=section.id, sort_order=line_order, **draft))
    db.commit()
    return _serialize(_get_or_404(db, estimate.id))


@router.patch("/{estimate_id}", response_model=EstimateOut)
def update_estimate(estimate_id: int, body: EstimateUpdate, db: Session = Depends(get_db)):
    estimate = _get_or_404(db, estimate_id)
    if body.job_id is not None:
        if not db.get(Job, body.job_id):
            raise HTTPException(status_code=404, detail="Job not found")
    data = body.model_dump(exclude_unset=True, exclude={"sections", "clear_job"})
    for field, value in data.items():
        setattr(estimate, field, value)
    if body.clear_job:
        estimate.job_id = None
    if body.sections is not None:
        for section in list(estimate.sections):
            db.delete(section)
        db.flush()
        for order, section_in in enumerate(body.sections):
            section = EstimateSection(estimate_id=estimate.id, name=section_in.name, sort_order=order)
            db.add(section)
            db.flush()
            for line_order, line_in in enumerate(section_in.lines):
                db.add(EstimateLine(
                    section_id=section.id, sort_order=line_order, item_id=line_in.item_id,
                    description=line_in.description, qty=line_in.qty, unit=line_in.unit,
                    material_unit_cost=line_in.material_unit_cost, labor_unit_cost=line_in.labor_unit_cost,
                ))
        # The old sections/lines were removed and the new ones added via
        # raw db.delete()/db.add(), not through estimate.sections itself --
        # so the Estimate object this function loaded at the top (still in
        # this session's identity map) keeps showing its OLD sections in
        # memory. Without this, the re-fetch below wouldn't actually be
        # fresh: SQLAlchemy doesn't refresh an already-loaded relationship
        # on a later query in the same session unless told to (same class
        # of bug as apply_plan's -- see its own comment on this).
        db.expire_all()
    db.commit()
    return _serialize(_get_or_404(db, estimate.id))


@router.post("/{estimate_id}/send", response_model=EstimateOut)
def send_estimate(estimate_id: int, db: Session = Depends(get_db)):
    """Emails the customer a link to the online estimate page. Sendable from
    draft or sent (re-sending reuses the same link); blocked once a customer
    has approved/declined so a re-send can't silently overwrite a decision
    they already made -- reset status via the manual dropdown first if a
    revised estimate genuinely needs to go out again."""
    estimate = _get_or_404(db, estimate_id)
    if not estimate.customer_email:
        raise HTTPException(status_code=400, detail="Add a customer email before sending.")
    if not any(section.lines for section in estimate.sections):
        raise HTTPException(status_code=400, detail="This estimate has no line items yet.")
    if estimate.status in ("approved", "declined"):
        raise HTTPException(
            status_code=400,
            detail=f"This estimate has already been {estimate.status} by the customer -- "
                   "reset its status first if you need to send a revised version.",
        )

    if not estimate.share_token:
        estimate.share_token = secrets.token_urlsafe(32)
        db.commit()

    out = _serialize(estimate)
    view_url = f"{settings.public_base_url}/estimate/{estimate.share_token}"
    try:
        send_estimate_email(db, estimate.customer_email, estimate, view_url, str(out.total))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=f"Couldn't send the email: {e}")

    estimate.status = "sent"
    estimate.sent_at = utcnow()
    db.commit()
    return _serialize(_get_or_404(db, estimate.id))


@router.delete("/{estimate_id}", status_code=204)
def delete_estimate(estimate_id: int, db: Session = Depends(get_db)):
    """Soft-delete, matching every other deletable row in this app -- sets
    active=False (filtered out of list/get/public-share lookups) instead of
    removing the row, so an accidental click doesn't lose real work with no
    way back. Also instant regardless of how many plan markers/lines the
    estimate has, unlike the hard-delete this replaced."""
    estimate = _get_or_404(db, estimate_id)
    estimate.active = False
    db.commit()


@router.post("/{estimate_id}/redraft", response_model=EstimateOut)
def redraft_estimate(estimate_id: int, db: Session = Depends(get_db)):
    """Re-run the scope-of-work matcher and replace the current sections --
    useful after editing the scope text, or to discard manual tweaks and
    start over. Material costs get re-drawn from the catalog; labor always
    resets to 0 since there's nothing to infer it from. Exclusions/notes are
    also regenerated fresh, so anything typed there manually is replaced."""
    estimate = _get_or_404(db, estimate_id)
    for section in list(estimate.sections):
        db.delete(section)
    db.flush()

    drafts, notes = _draft_sections_from_scope(db, estimate.scope_of_work)
    estimate.exclusions = _notes_to_text(notes)
    for order, name in enumerate(STANDARD_SECTIONS):
        section = EstimateSection(estimate_id=estimate.id, name=name, sort_order=order)
        db.add(section)
        db.flush()
        for line_order, draft in enumerate(drafts.get(name, [])):
            db.add(EstimateLine(section_id=section.id, sort_order=line_order, **draft))
    db.commit()
    return _serialize(_get_or_404(db, estimate.id))


# ---------- Plan markup: upload a plan, mark it up with symbol pins, price ----------

PLAN_SYMBOL_LABOR_DEFAULT = {
    "duplex": Decimal("45"), "gfci": Decimal("50"), "light": Decimal("45"), "fan": Decimal("50"),
    "exfan": Decimal("55"), "switch": Decimal("40"), "smoke": Decimal("40"), "co_smoke": Decimal("45"),
    "panel": Decimal("300"),
}
PLAN_SYMBOL_SECTION = {
    "duplex": "Supply and Install", "gfci": "Supply and Install", "light": "Supply and Install",
    "fan": "Supply and Install", "exfan": "Supply and Install", "switch": "Supply and Install",
    "smoke": "Supply and Install", "co_smoke": "Supply and Install", "panel": "Panels and Meters",
}

# Section names that only exist on a commercial estimate (mirrors
# EstimateWizard.tsx's COMMERCIAL_STEPS) -- used the same way the frontend's
# estimateToWizardState does, to tell a commercial estimate from a
# residential one by what sections it actually has.
COMMERCIAL_SECTION_NAMES = {
    "Commercial Rough-In", "Commercial Outlet Installation", "Commercial Switch Installation",
    "Commercial Lighting Installation", "Commercial Data Installation", "Commercial Disconnects",
    "Commercial Panels and Meters", "Commercial Circuit Breakers", "Commercial Permits, Inspection & Finalization",
}

# Every residential symbol type routes into one consolidated section here --
# matches the wizard's own design decision ("Only Rough-In gets checked
# off -- Supply and Install already has a copy button") instead of guessing
# at a specific install step. "panel" still gets its own section, same
# special-casing as the residential map above.
COMMERCIAL_PLAN_SYMBOL_SECTION = {
    "duplex": "Commercial Rough-In", "gfci": "Commercial Rough-In", "light": "Commercial Rough-In",
    "fan": "Commercial Rough-In", "exfan": "Commercial Rough-In", "switch": "Commercial Rough-In",
    "smoke": "Commercial Rough-In", "co_smoke": "Commercial Rough-In", "panel": "Commercial Panels and Meters",
}


def _serialize_plan_marker(m: EstimatePlanMarker) -> PlanMarkerOut:
    return PlanMarkerOut(
        id=m.id, plan_page_id=m.plan_page_id, item_id=m.item_id,
        item_name=m.item.name if m.item else None, item_sku=m.item.sku if m.item else None,
        item_material_cost=(m.item.avg_cost or m.item.last_cost) if m.item else None,
        item_unit=m.item.unit if m.item else None,
        symbol_type=m.symbol_type, label=m.label, qty=m.qty, x=m.x, y=m.y,
    )


def _get_plan_pages(db: Session, estimate_id: int) -> list[EstimatePlanPage]:
    return (
        db.query(EstimatePlanPage)
        .options(joinedload(EstimatePlanPage.markers).joinedload(EstimatePlanMarker.item))
        .filter(EstimatePlanPage.estimate_id == estimate_id)
        .order_by(EstimatePlanPage.page_number)
        .all()
    )


def _serialize_plan(pages: list[EstimatePlanPage], confidence_note: str | None = None) -> PlanOut:
    return PlanOut(
        pages=[
            PlanPageOut(
                id=p.id, page_number=p.page_number, image_data=p.image_data,
                markers=[_serialize_plan_marker(m) for m in p.markers],
            )
            for p in pages
        ],
        confidence_note=confidence_note,
    )


@router.post("/{estimate_id}/plan/upload", response_model=PlanOut)
def upload_plan(estimate_id: int, body: PlanUploadIn, db: Session = Depends(get_db)):
    """Renders every page of an uploaded plan PDF to an image and stores the
    PDF itself for the "Apply code-minimum symbols" button below to re-read
    on demand. Replaces any plan already on this estimate. Does NOT place
    any symbols by itself -- that's a separate, explicit step so the admin
    sees the blank plan first and chooses when to run the AI reading."""
    estimate = _get_active_estimate_light(db, estimate_id)
    for page in list(_get_plan_pages(db, estimate_id)):
        db.delete(page)
    db.flush()

    pdf_bytes = decode_pdf_data_url(body.data)
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception:
        raise HTTPException(status_code=400, detail="Could not read that PDF")

    for i, pdf_page in enumerate(doc, start=1):
        zoom = min(2200 / pdf_page.rect.width, 3)
        pix = pdf_page.get_pixmap(matrix=fitz.Matrix(zoom, zoom))
        image_data = "data:image/png;base64," + base64.b64encode(pix.tobytes("png")).decode()
        db.add(EstimatePlanPage(estimate_id=estimate.id, page_number=i, image_data=image_data))

    estimate.plan_pdf_data = body.data
    db.commit()
    return _serialize_plan(_get_plan_pages(db, estimate_id))


@router.get("/{estimate_id}/plan", response_model=PlanOut)
def get_plan(estimate_id: int, db: Session = Depends(get_db)):
    _get_active_estimate_light(db, estimate_id)
    return _serialize_plan(_get_plan_pages(db, estimate_id))


@router.post("/{estimate_id}/plan/auto-layout", response_model=PlanOut)
def auto_layout_plan(estimate_id: int, db: Session = Depends(get_db)):
    """Asks the AI for a code-minimum electrical layout per page (see
    plan_analysis's propose_plan_markers -- a suggestion, never a real
    reading, since an architectural plan has no electrical symbols to
    actually count) and replaces every current marker on this plan with
    the result, so it's safe to click again for a clean re-read."""
    estimate = _get_active_estimate_light(db, estimate_id)
    if not estimate.plan_pdf_data:
        raise HTTPException(status_code=400, detail="Upload a plan first.")
    pages = _get_plan_pages(db, estimate_id)
    if not pages:
        raise HTTPException(status_code=400, detail="Upload a plan first.")

    try:
        result = propose_plan_markers(base64.b64encode(decode_pdf_data_url(estimate.plan_pdf_data)).decode())
    except Exception as e:
        logger.exception("propose_plan_markers failed for estimate %s", estimate_id)
        raise HTTPException(status_code=502, detail=f"The code-layout reading failed: {e}")

    for page in pages:
        for marker in list(page.markers):
            db.delete(marker)
    db.flush()

    pages_by_number = {p.page_number: p for p in pages}
    for marker_in in result.get("markers", []):
        page = pages_by_number.get(int(marker_in.get("page") or 0))
        symbol_type = marker_in.get("type")
        if not page or symbol_type not in PLAN_SYMBOL_LABOR_DEFAULT:
            continue
        try:
            x = max(Decimal("0"), min(Decimal("100"), Decimal(str(marker_in.get("x", 50)))))
            y = max(Decimal("0"), min(Decimal("100"), Decimal(str(marker_in.get("y", 50)))))
            qty = max(Decimal("1"), Decimal(str(marker_in.get("qty", 1))))
        except Exception:
            continue
        db.add(EstimatePlanMarker(
            plan_page_id=page.id, symbol_type=symbol_type,
            label=str(marker_in.get("label") or symbol_type)[:300], qty=qty, x=x, y=y,
        ))
    db.commit()
    return _serialize_plan(_get_plan_pages(db, estimate_id), result.get("confidence_note"))


@router.post("/{estimate_id}/plan/markers", response_model=PlanMarkerOut, status_code=201)
def add_plan_marker(estimate_id: int, body: PlanMarkerIn, db: Session = Depends(get_db)):
    _get_active_estimate_light(db, estimate_id)
    page = db.get(EstimatePlanPage, body.plan_page_id)
    if not page or page.estimate_id != estimate_id:
        raise HTTPException(status_code=404, detail="Plan page not found")
    if body.item_id and not db.get(Item, body.item_id):
        raise HTTPException(status_code=404, detail="Item not found")
    marker = EstimatePlanMarker(
        plan_page_id=page.id, item_id=body.item_id, symbol_type=body.symbol_type,
        label=body.label, qty=body.qty, x=body.x, y=body.y,
    )
    db.add(marker)
    db.commit()
    db.refresh(marker)
    return _serialize_plan_marker(marker)


@router.patch("/{estimate_id}/plan/markers/{marker_id}", response_model=PlanMarkerOut)
def update_plan_marker(estimate_id: int, marker_id: int, body: PlanMarkerUpdate, db: Session = Depends(get_db)):
    _get_active_estimate_light(db, estimate_id)
    marker = db.get(EstimatePlanMarker, marker_id)
    if not marker or marker.page.estimate_id != estimate_id:
        raise HTTPException(status_code=404, detail="Marker not found")
    if body.item_id is not None:
        if not db.get(Item, body.item_id):
            raise HTTPException(status_code=404, detail="Item not found")
        marker.item_id = body.item_id
    if body.clear_item:
        marker.item_id = None
    data = body.model_dump(exclude_unset=True, exclude={"item_id", "clear_item"})
    for field, value in data.items():
        setattr(marker, field, value)
    db.commit()
    db.refresh(marker)
    return _serialize_plan_marker(marker)


@router.delete("/{estimate_id}/plan/markers/{marker_id}", status_code=204)
def delete_plan_marker(estimate_id: int, marker_id: int, db: Session = Depends(get_db)):
    _get_active_estimate_light(db, estimate_id)
    marker = db.get(EstimatePlanMarker, marker_id)
    if marker and marker.page.estimate_id == estimate_id:
        db.delete(marker)
        db.commit()


@router.delete("/{estimate_id}/plan/markers", status_code=204)
def delete_all_plan_markers(estimate_id: int, db: Session = Depends(get_db)):
    """Clears every marker across every page of this plan in one call --
    the "Clear all symbols" button, as opposed to deleting one pin."""
    _get_active_estimate_light(db, estimate_id)
    for page in _get_plan_pages(db, estimate_id):
        for marker in list(page.markers):
            db.delete(marker)
    db.commit()


def _qty_str(qty: Decimal) -> str:
    s = str(qty)
    return s.rstrip("0").rstrip(".") if "." in s else s


def _scope_of_work_from_sections(estimate: Estimate) -> str:
    """Rebuilds the full Scope of Work text from every section's current
    lines (not just the ones a plan apply just touched), same grouped
    "N. Section Name" / "qty description, qty description." format the
    wizard's own buildScopeOfWork() writes -- so re-applying a plan to an
    already-created estimate keeps the scope of work in sync with
    whatever's actually priced on it, not just the price itself."""
    by_name = {s.name: s for s in estimate.sections}
    blocks = []
    for idx, name in enumerate(STANDARD_SECTIONS, start=1):
        section = by_name.get(name)
        if not section or not section.lines:
            continue
        items = ", ".join(f"{_qty_str(l.qty)} {l.description}" for l in section.lines)
        blocks.append(f"{idx}. {name}\n{items}.")
    return "\n\n".join(blocks)


@router.post("/{estimate_id}/plan/apply", response_model=EstimateOut)
def apply_plan(estimate_id: int, db: Session = Depends(get_db)):
    """Turns every current plan marker into a real estimate line -- a
    matched marker (item_id set) prices from that item's catalog cost; an
    unmatched one goes in at $0 material so it's visibly a placeholder
    needing a real cost. Markers that land on the same section with the
    same description (e.g. five separate "Toggle Switch" pins) are summed
    into ONE line instead of one line per pin -- otherwise a dense plan
    shows the same item repeated over and over instead of a single real
    quantity, which is exactly the kind of duplicate "it says Toggle twice"
    the wizard's own checklist path already guards against (see
    buildSections in EstimateWizard.tsx). Safe to call repeatedly after
    editing the plan: every line from this path is from_plan=True, so a
    re-apply first removes all of those (lines added by hand have no
    plan_marker_id and are left alone) before recreating them, rather than
    piling up duplicates. Also rewrites the estimate's Scope of Work from
    its current lines, so clicking "Plan" on an already-created estimate
    and adding something keeps both price and scope of work in sync, not
    just price. Picks between the residential and commercial section maps
    by what sections this estimate actually has (same test the frontend's
    estimateToWizardState uses) -- without this, a commercial estimate's
    markers all targeted "Supply and Install"/"Panels and Meters", which
    don't exist on a commercial estimate, so every marker was silently
    skipped and Apply always failed with "No plan markers to apply yet"
    even on a plan full of pins."""
    estimate = _get_or_404(db, estimate_id)
    sections_by_name = {s.name: s for s in estimate.sections}
    is_commercial = any(name in COMMERCIAL_SECTION_NAMES for name in sections_by_name)
    symbol_section = COMMERCIAL_PLAN_SYMBOL_SECTION if is_commercial else PLAN_SYMBOL_SECTION
    default_section = "Commercial Rough-In" if is_commercial else "Supply and Install"
    pages = _get_plan_pages(db, estimate_id)

    for section in estimate.sections:
        for line in list(section.lines):
            if line.from_plan:
                db.delete(line)
    db.flush()

    next_order = {name: len(section.lines) for name, section in sections_by_name.items()}
    # Keyed by (section_name, item_id, description.lower()) -- a matched
    # marker only merges with another marker matched to the SAME catalog
    # item (never two different items that happen to share a name); an
    # unmatched marker merges purely on its label text within the section.
    grouped: dict[tuple[str, int | None, str], dict] = {}
    for page in pages:
        for marker in page.markers:
            section_name = symbol_section.get(marker.symbol_type, default_section)
            if section_name not in sections_by_name:
                continue
            item = marker.item
            description = item.name if item else marker.label
            gkey = (section_name, item.id if item else None, description.strip().lower())
            if gkey in grouped:
                grouped[gkey]["qty"] += marker.qty
                grouped[gkey]["marker_ids"].append(marker.id)
            else:
                grouped[gkey] = {
                    "section_name": section_name,
                    "item_id": item.id if item else None,
                    "description": description,
                    "unit": item.unit if item else "each",
                    "qty": marker.qty,
                    "material_unit_cost": (item.avg_cost or item.last_cost or Decimal("0")) if item else Decimal("0"),
                    "labor_unit_cost": PLAN_SYMBOL_LABOR_DEFAULT.get(marker.symbol_type, Decimal("40")),
                    "marker_ids": [marker.id],
                }

    added = 0
    for g in grouped.values():
        section = sections_by_name[g["section_name"]]
        db.add(EstimateLine(
            section_id=section.id, sort_order=next_order[g["section_name"]],
            item_id=g["item_id"],
            from_plan=True, plan_marker_id=g["marker_ids"][0],
            description=g["description"], qty=g["qty"], unit=g["unit"],
            material_unit_cost=g["material_unit_cost"], labor_unit_cost=g["labor_unit_cost"],
        ))
        next_order[g["section_name"]] += 1
        added += 1
    if added == 0:
        db.rollback()
        raise HTTPException(status_code=400, detail="No plan markers to apply yet.")
    db.flush()
    # The lines just added went straight in via db.add(), not through
    # estimate.sections[i].lines.append(...) -- so the section objects
    # loaded at the top of this function by _get_or_404 still show their
    # OLD (pre-apply) lines collection in memory: SQLAlchemy doesn't
    # refresh an already-loaded relationship on a later query in the same
    # session unless told to. Without this, _scope_of_work_from_sections
    # below silently wrote a scope of work missing every line this very
    # call just added, and the response handed back to the frontend showed
    # the same stale, incomplete line list.
    db.expire_all()
    estimate.scope_of_work = _scope_of_work_from_sections(_get_or_404(db, estimate.id))
    db.commit()
    return _serialize(_get_or_404(db, estimate.id))


# Matches "APEX Estimating Spreadsheet 2026" exactly: same intro line
# wording, in the same order. Sections not in this map (Demolition,
# Miscellaneous -- used on some real jobs but not part of the 2026 template)
# just get no intro line.
SECTION_INTRO = {
    "Rough-In Electrical Work": "Provide rough-in wiring for the following fixtures:",
    "Supply and Install": "Supply and install the following:",
    "Install Customer-Supplied Fixtures": "Install the following customer-supplied fixtures:",
}

FONT = "Calibri"
_ACCOUNTING_FMT = '_("$"* #,##0.00_);_("$"* \\(#,##0.00\\);_("$"* "-"??_);_(@_)'


def _build_xlsx(estimate: Estimate) -> Workbook:
    """Lays the estimate out exactly like "APEX Estimating Spreadsheet
    2026" -- same fonts, column widths, and accounting number format, so an
    exported estimate looks like a normal APEX estimate file, not a
    foreign format. Every dollar total is computed here in Python and
    written as a plain number (not a formula) -- a formula cell has no
    cached value until something actually recalculates it, which plenty of
    real viewers (SharePoint/OneDrive quick previews, mobile Office,
    email attachment previews) never do, showing blank instead. Hand-
    editing a quantity/cost cell directly in the downloaded file no longer
    recalculates the totals -- re-export from the app instead."""
    bold = Font(name=FONT, bold=True)
    normal = Font(name=FONT)
    title_font = Font(name=FONT, size=20)
    header_font = Font(name=FONT, bold=True)

    wb = Workbook()
    ws = wb.active
    ws.title = "Estimate"
    for col, width in zip("ABCDEFGH", [11.9, 90, 10.3, 15.1, 21.9, 12.6, 19.0, 15.0]):
        ws.column_dimensions[col].width = width
    ws.row_dimensions[2].height = 72
    ws.freeze_panes = "A5"

    logo_path = Path(__file__).resolve().parent.parent.parent / "static" / "logo.png"
    try:
        from openpyxl.drawing.image import Image as XLImage
        logo = XLImage(str(logo_path))
        logo.height = 64
        logo.width = 103
        ws.add_image(logo, "A2")
    except Exception:
        pass  # logo is a nice-to-have -- never let a missing/unreadable file break the export

    ws.cell(row=3, column=2, value=f"Job Name: {estimate.customer or estimate.estimate_number}").font = title_font
    ws.row_dimensions[3].height = 25.8
    if estimate.address:
        ws.cell(row=3, column=2).value = f"Job Name: {estimate.customer or estimate.estimate_number}  ({estimate.address})"

    headers = ["", "", "Quantity", "Cost of Material", "Total Cost of Material", "Labor Cost", "Total Cost of Labor", "Total cost"]
    for col, h in enumerate(headers, start=1):
        ws.cell(row=4, column=col, value=h).font = header_font

    # Every derived dollar cell is a computed NUMBER, not a formula --
    # openpyxl never writes a cached value alongside a formula string, so a
    # formula cell (e.g. "=C8*D8") shows blank in anything that doesn't run
    # a full calculation engine on open: a SharePoint/OneDrive quick
    # preview, a mobile Office viewer, an email attachment preview, etc.
    # fullCalcOnLoad used to paper over this in real desktop Excel, but
    # real exports kept showing up blank in these other viewers (EST-1013),
    # so every total here is computed in Python and written as a plain
    # value instead -- always correct no matter how the file is opened, at
    # the cost of no longer auto-recalculating if someone hand-edits a
    # quantity or cost cell directly inside the downloaded file (re-export
    # from the app instead).
    cent = Decimal("0.01")
    row = 6
    section_index = 0
    section_totals: list[Decimal] = []
    for section in estimate.sections:
        if not section.lines:
            continue
        section_index += 1
        section_header_row = row
        header_cell = ws.cell(row=row, column=2, value=f"{section_index}. {section.name}")
        header_cell.font = bold
        header_cell.alignment = Alignment(horizontal="left", vertical="center", indent=1)
        row += 1
        intro = SECTION_INTRO.get(section.name)
        if intro:
            ws.cell(row=row, column=2, value=intro).font = normal
            row += 1
        section_total = Decimal("0")
        for line in section.lines:
            material_total = (line.qty * line.material_unit_cost).quantize(cent)
            labor_total = (line.qty * line.labor_unit_cost).quantize(cent)
            line_total = material_total + labor_total
            section_total += line_total
            ws.cell(row=row, column=2, value=line.description).font = normal
            ws.cell(row=row, column=3, value=float(line.qty))
            ws.cell(row=row, column=4, value=float(line.material_unit_cost)).number_format = _ACCOUNTING_FMT
            ws.cell(row=row, column=5, value=float(material_total)).number_format = _ACCOUNTING_FMT
            ws.cell(row=row, column=6, value=float(line.labor_unit_cost)).number_format = _ACCOUNTING_FMT
            ws.cell(row=row, column=7, value=float(labor_total)).number_format = _ACCOUNTING_FMT
            ws.cell(row=row, column=8, value=float(line_total)).number_format = _ACCOUNTING_FMT
            row += 1
        section_totals.append(section_total)
        subtotal_cell = ws.cell(row=section_header_row, column=1, value=float(section_total))
        subtotal_cell.number_format = _ACCOUNTING_FMT
        subtotal_cell.font = bold
        row += 1  # blank row before the next section

    row += 1
    subtotal = sum(section_totals, Decimal("0"))
    ws.cell(row=row, column=2, value="Total cost of material and labor").font = bold
    ws.cell(row=row, column=8, value=float(subtotal)).number_format = _ACCOUNTING_FMT
    ws.cell(row=row, column=8).font = bold
    row += 2

    profit_amount = (subtotal * estimate.profit_pct / 100).quantize(cent)
    ws.cell(row=row, column=2, value="Profit").font = normal
    ws.cell(row=row, column=6, value=float(estimate.profit_pct) / 100).number_format = "0.0%"
    ws.cell(row=row, column=8, value=float(profit_amount)).number_format = _ACCOUNTING_FMT
    row += 1

    discount_amount = -((subtotal + profit_amount) * estimate.discount_pct / 100).quantize(cent)
    ws.cell(row=row, column=2, value="Repeat customer discount").font = normal
    ws.cell(row=row, column=6, value=float(estimate.discount_pct) / 100).number_format = "0.0%"
    ws.cell(row=row, column=8, value=float(discount_amount)).number_format = _ACCOUNTING_FMT
    row += 1

    ws.cell(row=row, column=2, value="TOTAL COST OF PROJECT").font = bold
    grand_total = subtotal + profit_amount + discount_amount
    grand_cell = ws.cell(row=row, column=8, value=float(grand_total))
    grand_cell.number_format = _ACCOUNTING_FMT
    grand_cell.font = bold
    row += 3

    if estimate.exclusions and estimate.exclusions.strip():
        ws.cell(row=row, column=2, value="Exclusions / Notes:").font = bold
        row += 1
        for text_line in estimate.exclusions.splitlines():
            if text_line.strip():
                ws.cell(row=row, column=2, value=text_line.strip()).font = normal
                row += 1

    return wb


@router.get("/{estimate_id}/export")
def export_estimate(estimate_id: int, db: Session = Depends(get_db)):
    estimate = _get_or_404(db, estimate_id)
    wb = _build_xlsx(estimate)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    filename = f"{estimate.estimate_number}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
