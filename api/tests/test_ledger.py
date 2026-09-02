from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.services.ledger import apply_transaction
from tests.conftest import ledger_reconciles


def stock_qty(db, item_id, location_id) -> Decimal:
    from sqlalchemy import select

    from app.models import StockLevel

    q = db.scalar(select(StockLevel.qty).where(StockLevel.item_id == item_id,
                                               StockLevel.location_id == location_id))
    return Decimal(str(q)) if q is not None else Decimal("0")


class TestMovingAverage:
    def test_first_receive_sets_avg_to_unit_cost(self, db_session, seeded):
        s = seeded
        apply_transaction(db_session, type="RECEIVE", item_id=s["romex"].id, qty=Decimal("1000"),
                          user=s["admin"], vendor_id=s["vendor"].id, unit_cost=Decimal("0.85"))
        db_session.commit()
        assert s["romex"].avg_cost == Decimal("0.8500")
        assert s["romex"].last_cost == Decimal("0.8500")

    def test_moving_average_formula(self, db_session, seeded):
        """avg = (total_qty_all_locations*avg + qty*cost) / (total_qty_all_locations + qty)"""
        s = seeded
        apply_transaction(db_session, type="RECEIVE", item_id=s["romex"].id, qty=Decimal("1000"),
                          user=s["admin"], vendor_id=s["vendor"].id, unit_cost=Decimal("0.85"))
        # move some to the truck — the average must still span ALL locations
        apply_transaction(db_session, type="TRANSFER", item_id=s["romex"].id, qty=Decimal("400"),
                          user=s["admin"], from_location_id=s["shop"].id,
                          to_location_id=s["truck_loc"].id)
        apply_transaction(db_session, type="RECEIVE", item_id=s["romex"].id, qty=Decimal("250"),
                          user=s["admin"], vendor_id=s["vendor"].id, unit_cost=Decimal("0.95"))
        db_session.commit()
        # (1000 * 0.85 + 250 * 0.95) / 1250 = 0.87
        assert s["romex"].avg_cost == Decimal("0.8700")
        assert s["romex"].last_cost == Decimal("0.9500")

    def test_avg_resets_when_on_hand_zero(self, db_session, seeded):
        s = seeded
        apply_transaction(db_session, type="RECEIVE", item_id=s["box"].id, qty=Decimal("10"),
                          user=s["admin"], vendor_id=s["vendor"].id, unit_cost=Decimal("2.00"))
        # sign out exactly what's on hand -> back to zero, not negative (oversell is blocked)
        apply_transaction(db_session, type="SIGN_OUT", item_id=s["box"].id, qty=Decimal("10"),
                          user=s["tech"], from_location_id=s["shop"].id, job_id=s["job"].id)
        apply_transaction(db_session, type="RECEIVE", item_id=s["box"].id, qty=Decimal("50"),
                          user=s["admin"], vendor_id=s["vendor"].id, unit_cost=Decimal("3.00"))
        db_session.commit()
        assert s["box"].avg_cost == Decimal("3.0000")  # reset, not blended

    def test_sign_out_snapshots_avg_cost(self, db_session, seeded):
        s = seeded
        apply_transaction(db_session, type="RECEIVE", item_id=s["romex"].id, qty=Decimal("1000"),
                          user=s["admin"], vendor_id=s["vendor"].id, unit_cost=Decimal("0.85"))
        txn = apply_transaction(db_session, type="SIGN_OUT", item_id=s["romex"].id,
                                qty=Decimal("50"), user=s["tech"],
                                from_location_id=s["shop"].id, job_id=s["job"].id)
        db_session.commit()
        assert txn.unit_cost == Decimal("0.8500")
        # a later receive at a new cost must NOT rewrite history
        apply_transaction(db_session, type="RECEIVE", item_id=s["romex"].id, qty=Decimal("1000"),
                          user=s["admin"], vendor_id=s["vendor"].id, unit_cost=Decimal("1.20"))
        db_session.commit()
        assert txn.unit_cost == Decimal("0.8500")


class TestValidation:
    def test_each_item_rejects_fractional_qty(self, db_session, seeded):
        s = seeded
        with pytest.raises(HTTPException) as e:
            apply_transaction(db_session, type="RECEIVE", item_id=s["box"].id, qty=Decimal("2.5"),
                              user=s["admin"], vendor_id=s["vendor"].id, unit_cost=Decimal("2"))
        assert e.value.status_code == 400

    def test_box_item_rejects_fractional_qty(self, db_session, seeded):
        s = seeded
        with pytest.raises(HTTPException):
            apply_transaction(db_session, type="RECEIVE", item_id=s["nuts"].id, qty=Decimal("1.5"),
                              user=s["admin"], vendor_id=s["vendor"].id, unit_cost=Decimal("8"))

    def test_foot_item_allows_two_decimals(self, db_session, seeded):
        s = seeded
        txn = apply_transaction(db_session, type="RECEIVE", item_id=s["romex"].id,
                                qty=Decimal("12.25"), user=s["admin"],
                                vendor_id=s["vendor"].id, unit_cost=Decimal("0.85"))
        assert txn.qty == Decimal("12.25")

    def test_foot_item_rejects_three_decimals(self, db_session, seeded):
        s = seeded
        with pytest.raises(HTTPException):
            apply_transaction(db_session, type="RECEIVE", item_id=s["romex"].id,
                              qty=Decimal("12.255"), user=s["admin"],
                              vendor_id=s["vendor"].id, unit_cost=Decimal("0.85"))

    def test_receive_requires_vendor_and_cost(self, db_session, seeded):
        s = seeded
        with pytest.raises(HTTPException):
            apply_transaction(db_session, type="RECEIVE", item_id=s["romex"].id,
                              qty=Decimal("10"), user=s["admin"], unit_cost=Decimal("0.85"))

    def test_sign_out_requires_job(self, db_session, seeded):
        s = seeded
        with pytest.raises(HTTPException):
            apply_transaction(db_session, type="SIGN_OUT", item_id=s["romex"].id,
                              qty=Decimal("10"), user=s["tech"], from_location_id=s["shop"].id)

    def test_adjust_requires_reason_and_note(self, db_session, seeded):
        s = seeded
        with pytest.raises(HTTPException):
            apply_transaction(db_session, type="ADJUST", item_id=s["romex"].id, qty=Decimal("5"),
                              user=s["admin"], from_location_id=s["shop"].id, reason="damaged")
        with pytest.raises(HTTPException):
            apply_transaction(db_session, type="ADJUST", item_id=s["romex"].id, qty=Decimal("5"),
                              user=s["admin"], from_location_id=s["shop"].id, note="broke")


class TestNegativeStock:
    def test_oversell_blocked(self, db_session, seeded):
        """Sign-out/transfer moves aren't count corrections — if the ledger
        says there isn't enough on hand, the request is rejected outright
        rather than allowed to go negative."""
        s = seeded
        apply_transaction(db_session, type="RECEIVE", item_id=s["box"].id, qty=Decimal("10"),
                          user=s["admin"], vendor_id=s["vendor"].id, unit_cost=Decimal("2"))
        db_session.commit()
        with pytest.raises(HTTPException) as e:
            apply_transaction(db_session, type="SIGN_OUT", item_id=s["box"].id,
                              qty=Decimal("15"), user=s["tech"],
                              from_location_id=s["shop"].id, job_id=s["job"].id)
        assert e.value.status_code == 400
        assert stock_qty(db_session, s["box"].id, s["shop"].id) == Decimal("10")  # untouched
        assert ledger_reconciles(db_session)

    def test_transfer_oversell_blocked(self, db_session, seeded):
        s = seeded
        apply_transaction(db_session, type="RECEIVE", item_id=s["box"].id, qty=Decimal("5"),
                          user=s["admin"], vendor_id=s["vendor"].id, unit_cost=Decimal("2"))
        db_session.commit()
        with pytest.raises(HTTPException) as e:
            apply_transaction(db_session, type="TRANSFER", item_id=s["box"].id,
                              qty=Decimal("6"), user=s["admin"],
                              from_location_id=s["shop"].id, to_location_id=s["truck_loc"].id)
        assert e.value.status_code == 400
        assert stock_qty(db_session, s["box"].id, s["shop"].id) == Decimal("5")  # untouched

    def test_normal_sign_out_not_flagged(self, db_session, seeded):
        s = seeded
        apply_transaction(db_session, type="RECEIVE", item_id=s["box"].id, qty=Decimal("10"),
                          user=s["admin"], vendor_id=s["vendor"].id, unit_cost=Decimal("2"))
        txn = apply_transaction(db_session, type="SIGN_OUT", item_id=s["box"].id,
                                qty=Decimal("10"), user=s["tech"],
                                from_location_id=s["shop"].id, job_id=s["job"].id)
        assert txn.went_negative is False


class TestLedgerConsistency:
    def test_full_lifecycle_reconciles(self, db_session, seeded):
        s = seeded
        apply_transaction(db_session, type="RECEIVE", item_id=s["romex"].id, qty=Decimal("1000"),
                          user=s["admin"], vendor_id=s["vendor"].id, unit_cost=Decimal("0.85"))
        apply_transaction(db_session, type="TRANSFER", item_id=s["romex"].id, qty=Decimal("250"),
                          user=s["tech"], from_location_id=s["shop"].id,
                          to_location_id=s["truck_loc"].id)
        apply_transaction(db_session, type="SIGN_OUT", item_id=s["romex"].id, qty=Decimal("50"),
                          user=s["tech"], from_location_id=s["truck_loc"].id, job_id=s["job"].id)
        apply_transaction(db_session, type="RETURN", item_id=s["romex"].id, qty=Decimal("20"),
                          user=s["tech"], to_location_id=s["shop"].id, job_id=s["job"].id)
        apply_transaction(db_session, type="ADJUST", item_id=s["romex"].id, qty=Decimal("10"),
                          user=s["admin"], from_location_id=s["shop"].id,
                          reason="damaged", note="water damage")
        db_session.commit()
        assert ledger_reconciles(db_session)
        # shop: +1000 -250 +20 -10 = 760 ; truck: +250 -50 = 200
        assert stock_qty(db_session, s["romex"].id, s["shop"].id) == Decimal("760")
        assert stock_qty(db_session, s["romex"].id, s["truck_loc"].id) == Decimal("200")

    def test_transfer_has_no_cost_impact(self, db_session, seeded):
        s = seeded
        apply_transaction(db_session, type="RECEIVE", item_id=s["romex"].id, qty=Decimal("100"),
                          user=s["admin"], vendor_id=s["vendor"].id, unit_cost=Decimal("0.85"))
        before = s["romex"].avg_cost
        apply_transaction(db_session, type="TRANSFER", item_id=s["romex"].id, qty=Decimal("50"),
                          user=s["tech"], from_location_id=s["shop"].id,
                          to_location_id=s["truck_loc"].id)
        db_session.commit()
        assert s["romex"].avg_cost == before
