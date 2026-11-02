from uuid import UUID
from datetime import date as CalendarDate
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import Date, cast, func, or_, select

from app.auth.router import current_user, database
from app.auth.service import ensure_permission, now
from app.auth.models import User
from app.catalog.models import Customer, ProductModel, Warehouse
from app.inventory.models import InventoryAccount, InventoryDocument, Ledger, Reservation
from app.inventory.service import balance_result, find_account, reservation_result


router = APIRouter(prefix='/api/inventory')


@router.get('/overview')
def overview(warehouse_id: UUID, model_id: UUID | None = None,
             user=Depends(current_user), db=Depends(database, scope='function')):
    ensure_permission(db, user, 'inventory.read')
    warehouse = db.get(Warehouse, str(warehouse_id))
    if not warehouse:
        raise HTTPException(404, 'Warehouse not found')
    query = select(ProductModel, InventoryAccount).outerjoin(InventoryAccount,
        (InventoryAccount.model_id == ProductModel.id) & (InventoryAccount.warehouse_id == warehouse.id))
    if model_id:
        query = query.where(ProductModel.id == str(model_id))
    rows = db.execute(query.order_by(ProductModel.name, ProductModel.id)).all()
    if model_id and not rows:
        raise HTTPException(404, 'Model not found')
    items = []
    for model, account in rows:
        items.append({'model': {'id': model.id, 'name': model.name, 'enabled': model.enabled},
            'status': 'opened' if account else 'uninitialized',
            'on_hand': account.on_hand if account else None, 'reserved': account.reserved if account else None,
            'available': account.on_hand - account.reserved if account else None,
            't0': account.t0.isoformat() if account else None, 'version': account.version if account else None})
    opened = [row for row in items if row['status'] == 'opened']
    totals = {key: sum(row[key] for row in opened) if opened else None for key in ['on_hand', 'reserved', 'available']}
    return {'warehouse': {'id': warehouse.id, 'name': warehouse.name, 'enabled': warehouse.enabled},
            'queried_at': now().isoformat(), 'items': items, 'totals': {**totals,
                'opened_model_count': len(opened), 'uninitialized_model_count': len(items) - len(opened)}}


@router.get('/balance')
def balance(warehouse_id: UUID, model_id: UUID, user=Depends(current_user), db=Depends(database, scope='function')):
    ensure_permission(db, user, 'inventory.read')
    warehouse, model = db.get(Warehouse, str(warehouse_id)), db.get(ProductModel, str(model_id))
    if not warehouse or not model:
        raise HTTPException(404, 'Warehouse or model not found')
    return balance_result(db, warehouse, model, find_account(db, warehouse.id, model.id))


@router.get('/reservations')
def reservations(q: str = Query(default='', max_length=100), warehouse_id: UUID | None = None,
                 model_id: UUID | None = None, active_only: bool = True,
                 user=Depends(current_user), db=Depends(database, scope='function')):
    ensure_permission(db, user, 'inventory.read')
    query = select(Reservation).join(InventoryAccount).join(Customer)
    if warehouse_id:
        query = query.where(InventoryAccount.warehouse_id == str(warehouse_id))
    if model_id:
        query = query.where(InventoryAccount.model_id == str(model_id))
    if active_only:
        query = query.where(Reservation.registered_quantity > Reservation.picked_quantity + Reservation.cancelled_quantity)
    if q.strip():
        pattern = '%' + q.strip() + '%'
        query = query.where(or_(Customer.display_name.ilike(pattern), Customer.phone.ilike(pattern),
                                Customer.address.ilike(pattern), Reservation.id == q.strip()))
    result = []
    for row in db.scalars(query.order_by(Reservation.id)):
        account = db.get(InventoryAccount, row.account_id)
        warehouse, model = db.get(Warehouse, account.warehouse_id), db.get(ProductModel, account.model_id)
        result.append({**reservation_result(db, row), 'warehouse': {'id': warehouse.id, 'name': warehouse.name, 'code': warehouse.code},
                       'model': {'id': model.id, 'name': model.name}, 't0': account.t0.isoformat()})
    return result


@router.get('/ledger')
def ledger(warehouse_id: UUID, model_id: UUID, start: CalendarDate | None = None, end: CalendarDate | None = None,
           reservation_id: UUID | None = None,
           kind: Literal['opening', 'inbound', 'outbound', 'reserve', 'cancel', 'pickup'] | None = None,
           user=Depends(current_user), db=Depends(database, scope='function')):
    ensure_permission(db, user, 'inventory.read')
    if start and end and start > end:
        raise HTTPException(422, 'Start date must not be after end date')
    account = find_account(db, str(warehouse_id), str(model_id))
    if not account:
        return []
    query = select(Ledger, InventoryDocument, User.username).join(
        InventoryDocument, Ledger.document_id == InventoryDocument.id).join(User, InventoryDocument.actor_id == User.id).where(
        Ledger.account_id == account.id)
    day = func.coalesce(InventoryDocument.occurred_date, cast(func.timezone('Asia/Shanghai', InventoryDocument.occurred_at), Date))
    if start:
        query = query.where(day >= start)
    if end:
        query = query.where(day <= end)
    if reservation_id:
        query = query.where(InventoryDocument.reservation_id == str(reservation_id))
    if kind:
        query = query.where(InventoryDocument.kind == kind)
    result = []
    for row, document, actor in db.execute(query.order_by(Ledger.version.desc())):
        result.append({'id': row.id, 'business_id': document.id, 'operation_id': document.operation_id,
            'kind': document.kind, 'quantity': document.effective_quantity, 'on_hand_delta': row.on_hand_delta,
            'reserved_delta': row.reserved_delta, 'version': row.version, 'reservation_id': document.reservation_id,
            'occurred': {'precision': document.occurred_precision,
                         'date': document.occurred_date.isoformat() if document.occurred_date else None,
                         'at': document.occurred_at.isoformat() if document.occurred_at else None},
            'registered_at': document.registered_at.isoformat(), 'actor_id': document.actor_id,
            'actor_name': actor, 'basis_note': document.basis_note})
    return result
