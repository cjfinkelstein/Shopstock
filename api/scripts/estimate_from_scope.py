"""Create a draft estimate from a scope-of-work text file, via the same
auto-draft logic the admin Estimates UI uses (section routing, catalog
matching, placeholder rough-in/supply-install pricing). A CLI alternative
to the EstimateWizard's checklist flow, for when the scope already exists
as a written document (e.g. a client's own scope-of-work text) rather than
being built item-by-item in the wizard.

Defaults to a dry run that prints what would be drafted -- which section
each line lands in, whether it matched something in the item catalog, and
the line-level pricing -- without creating anything. Pass --apply to
actually create the estimate once the preview looks right.

Usage (from api/, inside the container):
    python scripts/estimate_from_scope.py <scope.txt> --customer "Name" [options]

Options:
    --customer NAME        Customer name on the estimate (required unless --job-id given)
    --address ADDR         Customer address (optional)
    --job-id N              Link to an existing job (pulls customer/address from it
                             if --customer/--address aren't also given)
    --profit-pct N          Profit % applied on top of material+labor (default 0)
    --discount-pct N        Repeat-customer discount % (default 0)
    --apply                 Actually create the estimate (default is a dry run)
"""
import argparse
import sys

sys.path.insert(0, ".")

from app.database import SessionLocal
from app.models import Estimate, EstimateLine, EstimateSection, Job, User
from app.routers.estimates import STANDARD_SECTIONS, _draft_sections_from_scope, _next_estimate_number, _notes_to_text


def main(scope_path: str, customer: str | None, address: str | None, job_id: int | None,
          profit_pct: str, discount_pct: str, apply: bool) -> None:
    with open(scope_path) as f:
        scope = f.read().strip()
    if not scope:
        print("Scope file is empty.")
        return

    db = SessionLocal()
    try:
        job = db.get(Job, job_id) if job_id else None
        if job_id and not job:
            print(f"No job with id {job_id} found.")
            return

        drafts, notes = _draft_sections_from_scope(db, scope)

        total_lines = 0
        grand_total = 0.0
        print("=== PREVIEW ===\n")
        for name in STANDARD_SECTIONS:
            lines = drafts.get(name, [])
            if not lines:
                continue
            sec_total = sum(
                float(l["qty"]) * (float(l["material_unit_cost"]) + float(l["labor_unit_cost"]))
                for l in lines
            )
            grand_total += sec_total
            total_lines += len(lines)
            print(f"--- {name} ({len(lines)} lines, ~${sec_total:,.2f}) ---")
            for l in lines:
                tag = "[catalog match]" if l["item_id"] else "[no catalog match -- note/placeholder]"
                print(f"  qty={l['qty']:>4}  {l['description'][:65]:<65}  "
                      f"mat=${l['material_unit_cost']}  lab=${l['labor_unit_cost']}  {tag}")
            print()

        print(f"TOTAL: {total_lines} line(s) drafted, ~${grand_total:,.2f}\n")
        print("--- NOTES/ASSUMPTIONS ---")
        print(_notes_to_text(notes))

        if not apply:
            print("\nDRY RUN ONLY -- nothing created. Re-run with --apply to actually create it.")
            return

        admin = db.query(User).filter(User.role == "admin").first()
        estimate = Estimate(
            estimate_number=_next_estimate_number(db), job_id=job_id,
            customer=customer or ((job.customer or job.name) if job else None),
            address=address or (job.address if job else None),
            scope_of_work=scope, profit_pct=profit_pct, discount_pct=discount_pct,
            created_by=admin.id if admin else None,
        )
        db.add(estimate)
        db.flush()
        estimate.exclusions = _notes_to_text(notes)
        for order, name in enumerate(STANDARD_SECTIONS):
            section = EstimateSection(estimate_id=estimate.id, name=name, sort_order=order)
            db.add(section)
            db.flush()
            for line_order, draft in enumerate(drafts.get(name, [])):
                db.add(EstimateLine(section_id=section.id, sort_order=line_order, **draft))
        db.commit()
        print(f"\nCREATED: {estimate.estimate_number} (id={estimate.id})")
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("scope_file", help="path to a text file containing the scope of work")
    parser.add_argument("--customer", default=None)
    parser.add_argument("--address", default=None)
    parser.add_argument("--job-id", type=int, default=None)
    parser.add_argument("--profit-pct", default="0")
    parser.add_argument("--discount-pct", default="0")
    parser.add_argument("--apply", action="store_true", help="actually create (default is a dry run)")
    args = parser.parse_args()
    if not args.customer and not args.job_id:
        parser.error("pass --customer or --job-id so the estimate has someone to bill")
    main(args.scope_file, args.customer, args.address, args.job_id, args.profit_pct, args.discount_pct, args.apply)
