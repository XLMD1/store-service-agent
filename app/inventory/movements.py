from datetime import date, datetime

from fastapi import HTTPException
from sqlalchemy import select

from app.auth.service import now
from app.catalog.models import Customer
from app.inventory.models import InventoryAccount, InventoryDocument, Ledger, Reservation
from app.inventory.service import balance_result, reservation_result, stock_event_context


MOVEMENT_KINDS = {'inventory_outbound': 'outbound', 'reservation_create': 'reserve',
                  'reservation_cancel': 'cancel', 'reservation_pickup': 'pickup'}


def movement_preview(db, kind, params, *, locking=False, expected_versions=None):
    selected = None
    context = params
    if kind in ['reservation_cancel', 'reservation_pickup']:
        if not params['reservation_id']:
            missing = ['reservation_id'] + [key for key in ['quantity', 'occurred'] if params[key] is None]
            if not params['basis_note'].strip():
                missing.append('basis_note')
            return missing, None, {}
        selected = db.get(Reservation, params['reservation_id'])
        if not selected:
            raise HTTPException(422, 'Select an existing reservation')
        account = db.get(InventoryAccount, selected.account_id)
        context = {**params, 'warehouse_id': account.warehouse_id, 'model_id': account.model_id}
    missing, account, warehouse, model, versions = stock_event_context(
        db, context, locking=locking, expected_versions=expected_versions, basis_required=kind not in ('inventory_outbound', 'reservation_create'))
    if kind == 'reservation_create':
        missing += [key for key in ['customer_id', 'basis_kind'] if params[key] is None]
    if missing:
        return missing, None, versions
    if selected:
        query = select(Reservation).where(Reservation.id == selected.id)
        selected = db.scalar(query.with_for_update().execution_options(populate_existing=True) if locking else query)
        versions['reservation'] = selected.version
        if expected_versions is not None and versions != expected_versions:
            raise HTTPException(409, 'Reservation changed; preview again')
    quantity = params['quantity']
    before = {'on_hand': account.on_hand, 'reserved': account.reserved, 'available': account.on_hand - account.reserved}
    after = dict(before)
    customer = None
    if kind in ['inventory_outbound', 'reservation_create'] and quantity > before['available']:
        raise HTTPException(422, 'Quantity exceeds available stock')
    if kind == 'inventory_outbound':
        after['on_hand'] -= quantity
    elif kind == 'reservation_create':
        customer = db.get(Customer, params['customer_id'])
        if not customer:
            raise HTTPException(422, 'Explicitly select an existing customer')
        after['reserved'] += quantity
    else:
        remaining = selected.registered_quantity - selected.picked_quantity - selected.cancelled_quantity
        if quantity > remaining:
            raise HTTPException(422, 'Quantity exceeds the selected reservation remaining amount')
        after['reserved'] -= quantity
        if kind == 'reservation_pickup':
            after['on_hand'] -= quantity
    after['available'] = after['on_hand'] - after['reserved']
    if not 0 <= after['reserved'] <= after['on_hand']:
        raise HTTPException(422, 'Stock and reservation amounts are inconsistent')
    return [], {'before': before, 'after': after, 'quantity': quantity,
        'warehouse': {'id': warehouse.id, 'name': warehouse.name, 'code': warehouse.code},
        'model': {'id': model.id, 'name': model.name},
        'reservation': reservation_result(db, selected) if selected else None,
        'customer': {'id': customer.id, 'display_name': customer.display_name} if customer else None}, versions


def apply_movement(db, user, op, draft, params):
    missing, preview, versions = movement_preview(db, draft.kind, params, locking=True, expected_versions=op.target_versions)
    if missing or versions != op.target_versions:
        raise HTTPException(409, 'Target changed; preview again')
    account = db.scalar(select(InventoryAccount).where(
        InventoryAccount.warehouse_id == preview['warehouse']['id'], InventoryAccount.model_id == preview['model']['id']))
    before_h, before_r = account.on_hand, account.reserved
    account.on_hand, account.reserved = preview['after']['on_hand'], preview['after']['reserved']
    account.version += 1
    selected = None
    if draft.kind == 'reservation_create':
        selected = Reservation(account_id=account.id, customer_id=params['customer_id'],
            registered_quantity=params['quantity'], picked_quantity=0, cancelled_quantity=0,
            is_opening=False, basis_note=params['basis_note'], basis_kind=params['basis_kind'])
        db.add(selected)
    elif draft.kind in ['reservation_cancel', 'reservation_pickup']:
        selected = db.get(Reservation, params['reservation_id'])
        if draft.kind == 'reservation_cancel':
            selected.cancelled_quantity += params['quantity']
        else:
            selected.picked_quantity += params['quantity']
        selected.version += 1
    db.flush()
    occurred, stamp = params['occurred'], now()
    document = InventoryDocument(account_id=account.id, operation_id=op.id, actor_id=user.id,
        kind=MOVEMENT_KINDS[draft.kind], original_quantity=params['quantity'], effective_quantity=params['quantity'],
        occurred_precision=occurred['precision'], occurred_at=datetime.fromisoformat(occurred['at']) if occurred['at'] else None,
        occurred_date=date.fromisoformat(occurred['date']) if occurred['date'] else None,
        t0_relation=occurred['t0_relation'], boundary_note=occurred['boundary_note'], registered_at=stamp,
        basis_note=params['basis_note'], reservation_id=selected.id if selected else None)
    db.add(document); db.flush()
    ledger = Ledger(account_id=account.id, document_id=document.id, operation_id=op.id,
        on_hand_delta=account.on_hand - before_h, reserved_delta=account.reserved - before_r, version=account.version)
    db.add(ledger); db.flush()
    from app.catalog.models import ProductModel, Warehouse
    receipt = {'operation_id': op.id, 'draft_id': draft.id, 'draft_version': draft.version,
        'business_id': document.id, 'kind': draft.kind, 'account_id': account.id, 'quantity': params['quantity'],
        'occurred': occurred, 'registered_at': stamp.isoformat(), 'actor_id': user.id,
        'balance': balance_result(db, db.get(Warehouse, account.warehouse_id), db.get(ProductModel, account.model_id), account),
        'reservation': reservation_result(db, selected) if selected else None, 'ledger_ids': [ledger.id]}
    op.state, op.confirmed_at, op.result, draft.state = 'succeeded', stamp.isoformat(), receipt, 'succeeded'
    db.flush()
    return receipt
