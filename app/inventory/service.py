from datetime import date, datetime
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import select

from app.auth.service import now
from app.catalog.models import Customer, ProductModel, Warehouse
from app.inventory.models import InventoryAccount, Reservation


def find_account(db, warehouse_id, model_id, *, locking=False):
    query = select(InventoryAccount).where(InventoryAccount.warehouse_id == warehouse_id,
                                           InventoryAccount.model_id == model_id)
    return db.scalar(query.with_for_update().execution_options(populate_existing=True) if locking else query)


def reservation_result(db, row):
    customer = db.get(Customer, row.customer_id)
    remaining = row.registered_quantity - row.picked_quantity - row.cancelled_quantity
    return {'id': row.id, 'account_id': row.account_id, 'customer_id': row.customer_id,
            'customer': {'id': customer.id, 'display_name': customer.display_name, 'phone': customer.phone, 'address': customer.address},
            'registered_quantity': row.registered_quantity, 'picked_quantity': row.picked_quantity,
            'cancelled_quantity': row.cancelled_quantity, 'remaining_quantity': remaining,
            'is_opening': row.is_opening, 'status': 'active' if remaining else 'ended',
            'basis_note': row.basis_note, 'basis_kind': row.basis_kind, 'version': row.version}


def balance_result(db, warehouse, model, account):
    result = {'warehouse': {'id': warehouse.id, 'name': warehouse.name, 'code': warehouse.code, 'enabled': warehouse.enabled},
              'model': {'id': model.id, 'name': model.name, 'enabled': model.enabled},
              'status': 'opened' if account else 'uninitialized', 't0': account.t0.isoformat() if account else None,
              'on_hand': account.on_hand if account else None, 'reserved': account.reserved if account else None,
              'available': account.on_hand - account.reserved if account else None,
              'version': account.version if account else None, 'queried_at': now().isoformat(), 'reservations': []}
    if account:
        for row in db.scalars(select(Reservation).where(Reservation.account_id == account.id).order_by(Reservation.id)):
            result['reservations'].append(reservation_result(db, row))
    return result


def stock_event_context(db, params, *, locking=False, expected_versions=None):
    missing = [key for key in ['warehouse_id', 'model_id', 'quantity', 'occurred'] if params[key] is None]
    if not params['basis_note'].strip():
        missing.append('basis_note')
    if params['occurred']:
        field = 'date' if params['occurred']['precision'] == 'date' else 'at'
        if not params['occurred'][field]:
            missing.append('occurred.' + field)
    if missing:
        return missing, None, None, None, {}
    account = find_account(db, params['warehouse_id'], params['model_id'], locking=locking)
    if not account:
        raise HTTPException(422, 'Open this warehouse/model before recording stock events')
    warehouse_query = select(Warehouse).where(Warehouse.id == account.warehouse_id)
    model_query = select(ProductModel).where(ProductModel.id == account.model_id)
    warehouse = db.scalar(warehouse_query.with_for_update().execution_options(populate_existing=True) if locking else warehouse_query)
    model = db.scalar(model_query.with_for_update().execution_options(populate_existing=True) if locking else model_query)
    versions = {'warehouse': warehouse.version, 'model': model.version, 'account': account.version}
    if expected_versions is not None and any(expected_versions.get(key) != value for key, value in versions.items()):
        raise HTTPException(409, 'Target changed; refresh the draft and confirm again')
    if not warehouse.enabled or not model.enabled:
        raise HTTPException(422, 'Choose an enabled warehouse and model')
    occurred = params['occurred']
    if occurred['precision'] == 'datetime':
        if datetime.fromisoformat(occurred['at']) <= account.t0:
            raise HTTPException(422, 'Events at or before T0 are already included in opening stock')
    else:
        day = date.fromisoformat(occurred['date'])
        opening_day = account.t0.astimezone(ZoneInfo('Asia/Shanghai')).date()
        if day < opening_day or (day == opening_day and occurred['t0_relation'] == 'at_or_before'):
            raise HTTPException(422, 'Events at or before T0 are already included in opening stock')
        if day == opening_day:
            if occurred['t0_relation'] != 'after':
                missing.append('occurred.t0_relation')
            elif not occurred['boundary_note'].strip():
                missing.append('occurred.boundary_note')
    return missing, account, warehouse, model, versions
