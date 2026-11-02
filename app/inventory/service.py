from sqlalchemy import select

from app.auth.service import now
from app.catalog.models import ProductModel, Warehouse
from app.inventory.models import InventoryAccount, Reservation


def find_account(db, warehouse_id, model_id, *, locking=False):
    query = select(InventoryAccount).where(InventoryAccount.warehouse_id == warehouse_id,
                                           InventoryAccount.model_id == model_id)
    return db.scalar(query.with_for_update() if locking else query)


def balance_result(db, warehouse, model, account):
    result = {'warehouse': {'id': warehouse.id, 'name': warehouse.name, 'code': warehouse.code, 'enabled': warehouse.enabled},
              'model': {'id': model.id, 'name': model.name, 'enabled': model.enabled},
              'status': 'opened' if account else 'uninitialized', 't0': account.t0.isoformat() if account else None,
              'on_hand': account.on_hand if account else None, 'reserved': account.reserved if account else None,
              'available': account.on_hand - account.reserved if account else None,
              'version': account.version if account else None, 'queried_at': now().isoformat(), 'reservations': []}
    if account:
        for row in db.scalars(select(Reservation).where(Reservation.account_id == account.id).order_by(Reservation.id)):
            remaining = row.registered_quantity - row.picked_quantity - row.cancelled_quantity
            result['reservations'].append({'id': row.id, 'customer_id': row.customer_id,
                'registered_quantity': row.registered_quantity, 'picked_quantity': row.picked_quantity,
                'cancelled_quantity': row.cancelled_quantity, 'remaining_quantity': remaining,
                'is_opening': row.is_opening, 'status': 'active' if remaining else 'ended', 'basis_note': row.basis_note})
    return result
