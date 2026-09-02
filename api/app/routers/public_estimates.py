from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import Estimate, EstimateLine, EstimateSection, utcnow
from app.schemas import PublicEstimateLine, PublicEstimateOut, PublicEstimateSection, RespondIn

router = APIRouter(prefix="/public/estimates", tags=["public"])


def _line_total(l: EstimateLine) -> Decimal:
    return (l.qty * (l.material_unit_cost + l.labor_unit_cost)).quantize(Decimal("0.01"))


def _get_by_token_or_404(db: Session, token: str) -> Estimate:
    estimate = (
        db.query(Estimate)
        .options(joinedload(Estimate.sections).joinedload(EstimateSection.lines))
        .filter(Estimate.share_token == token)
        .first()
    )
    # Never distinguish "wrong token" from "no such estimate" in the response.
    if not estimate:
        raise HTTPException(status_code=404, detail="Estimate not found")
    return estimate


def _public_out(estimate: Estimate) -> PublicEstimateOut:
    subtotal = Decimal("0.00")
    sections = []
    for section in estimate.sections:
        if not section.lines:
            continue
        lines = []
        for l in section.lines:
            subtotal += _line_total(l)
            lines.append(PublicEstimateLine(description=l.description, qty=l.qty, unit=l.unit))
        sections.append(PublicEstimateSection(name=section.name, lines=lines))

    profit_amount = (subtotal * estimate.profit_pct / Decimal("100")).quantize(Decimal("0.01"))
    discount_amount = ((subtotal + profit_amount) * estimate.discount_pct / Decimal("100")).quantize(Decimal("0.01"))
    total = (subtotal + profit_amount - discount_amount).quantize(Decimal("0.01"))

    return PublicEstimateOut(
        estimate_number=estimate.estimate_number, customer=estimate.customer, address=estimate.address,
        sections=sections, exclusions=estimate.exclusions, total=total,
        status=estimate.status, sent_at=estimate.sent_at,
    )


@router.get("/{token}", response_model=PublicEstimateOut)
def view_estimate(token: str, db: Session = Depends(get_db)):
    return _public_out(_get_by_token_or_404(db, token))


@router.post("/{token}/respond", response_model=PublicEstimateOut)
def respond_to_estimate(token: str, body: RespondIn, db: Session = Depends(get_db)):
    estimate = _get_by_token_or_404(db, token)
    if estimate.status != "sent":
        raise HTTPException(
            status_code=409,
            detail="This estimate has already been responded to." if estimate.status in ("approved", "declined")
                   else "This estimate hasn't been sent yet.",
        )
    estimate.status = body.decision
    estimate.responded_at = utcnow()
    db.commit()
    return _public_out(estimate)
