"""Role-aware serialization. Cost fields are stripped for techs SERVER-SIDE:
tech responses are built from schemas that simply do not contain cost fields."""

from app.models import Item, Transaction, User
from app.schemas import ItemAdminOut, ItemTechOut, TxnAdminOut, TxnTechOut


def serialize_item(item: Item, user: User):
    schema = ItemAdminOut if user.role == "admin" else ItemTechOut
    return schema.model_validate(item)


def serialize_txn(txn: Transaction, user: User):
    base = dict(
        id=txn.id,
        type=txn.type,
        item_id=txn.item_id,
        item_sku=txn.item.sku if txn.item else None,
        item_name=txn.item.name if txn.item else None,
        item_unit=txn.item.unit if txn.item else None,
        item_image=txn.item.image_data if txn.item else None,
        qty=txn.qty,
        from_location_id=txn.from_location_id,
        from_location_name=txn.from_location.name if txn.from_location else None,
        to_location_id=txn.to_location_id,
        to_location_name=txn.to_location.name if txn.to_location else None,
        job_id=txn.job_id,
        job_number=txn.job.job_number if txn.job else None,
        job_name=txn.job.name if txn.job else None,
        user_id=txn.user_id,
        user_name=txn.user.name if txn.user else None,
        ref=txn.ref,
        note=txn.note,
        reason=txn.reason,
        went_negative=txn.went_negative,
        created_at=txn.created_at,
        updated_at=txn.updated_at,
    )
    if user.role == "admin":
        return TxnAdminOut(
            **base,
            unit_cost=txn.unit_cost,
            tax_amount=txn.tax_amount,
            vendor_id=txn.vendor_id,
            vendor_name=txn.vendor.name if txn.vendor else None,
        )
    return TxnTechOut(**base)
