from datetime import date, datetime

from fastapi import HTTPException
from sqlalchemy import select

from app.auth.service import now
from app.catalog.models import ProductModel, Warehouse
from app.inventory.models import InventoryAccount, InventoryDocument, Ledger, Reservation
from app.inventory.service import balance_result, reservation_result, stock_event_context

CORRECTION_KINDS = {'inventory_adjustment', 'inventory_correction'}


def correction_preview(db, kind, params, *, locking=False, expected_versions=None):
    source = None
    if kind == 'inventory_correction':
        missing = [key for key in ['document_id', 'new_quantity'] if params[key] is None]
        if not params['basis_note'].strip():
            missing.append('basis_note')
        if missing:
            return missing, None, {}
        source = db.get(InventoryDocument, params['document_id'])
        if not source or source.kind not in ['inbound', 'outbound', 'pickup']:
            raise HTTPException(422, 'Choose an original inbound, outbound or pickup document')
        account = db.get(InventoryAccount, source.account_id)
        context = {'warehouse_id': account.warehouse_id, 'model_id': account.model_id, 'quantity': 1,
            'basis_note': params['basis_note'], 'occurred': {'precision': source.occurred_precision,
            'at': source.occurred_at.isoformat() if source.occurred_at else None,
            'date': source.occurred_date.isoformat() if source.occurred_date else None,
            't0_relation': source.t0_relation, 'boundary_note': source.boundary_note or ''}}
    else:
        context = {**params, 'quantity': 1}
    missing, account, warehouse, model, versions = stock_event_context(
        db, context, locking=locking, expected_versions=expected_versions)
    if kind == 'inventory_adjustment' and params['on_hand'] is None:
        missing.append('on_hand')
    if missing:
        return missing, None, versions
    selected = None
    if source and source.reservation_id:
        query = select(Reservation).where(Reservation.id == source.reservation_id)
        selected = db.scalar(query.with_for_update().execution_options(populate_existing=True) if locking else query)
        if not selected or selected.account_id != account.id:
            raise HTTPException(422, 'Original reservation relationship is invalid')
        versions['reservation'] = selected.version
    if source:
        query = select(InventoryDocument).where(InventoryDocument.id == source.id)
        source = db.scalar(query.with_for_update().execution_options(populate_existing=True) if locking else query)
        versions['document'] = source.version
    if expected_versions is not None and versions != expected_versions:
        raise HTTPException(409, 'Original document or reservation changed; preview again')
    before = {'on_hand': account.on_hand, 'reserved': account.reserved, 'available': account.on_hand-account.reserved}
    after = dict(before)
    target = params['new_quantity'] if source else params['on_hand']
    delta = target-source.effective_quantity if source else target-account.on_hand
    if source:
        after['on_hand'] += delta if source.kind == 'inbound' else -delta
        if source.kind == 'pickup':
            if not selected or not 0 <= selected.picked_quantity+delta <= selected.registered_quantity-selected.cancelled_quantity:
                raise HTTPException(422, 'Correction exceeds original reservation or cancelled quantity')
            after['reserved'] -= delta
    else:
        after['on_hand'] = target
    after['available'] = after['on_hand']-after['reserved']
    if not 0 <= after['reserved'] <= after['on_hand'] <= 2147483647:
        raise HTTPException(422, 'Corrected physical stock must cover reservations and supported quantity range')
    original = {'id': source.id, 'kind': source.kind, 'original_quantity': source.original_quantity,
                'effective_quantity': source.effective_quantity, 'version': source.version} if source else None
    return [], {'before': before, 'after': after, 'quantity': target, 'delta': delta,
        'warehouse': {'id': warehouse.id, 'name': warehouse.name}, 'model': {'id': model.id, 'name': model.name},
        'original_document': original, 'reservation': reservation_result(db, selected) if selected else None}, versions


def apply_correction(db, user, op, draft, params):
    missing, preview, versions = correction_preview(db, draft.kind, params, locking=True, expected_versions=op.target_versions)
    if missing or versions != op.target_versions:
        raise HTTPException(409, 'Target changed; preview again')
    account = db.scalar(select(InventoryAccount).where(InventoryAccount.warehouse_id == preview['warehouse']['id'],
                                                     InventoryAccount.model_id == preview['model']['id']))
    old_h, old_r = account.on_hand, account.reserved
    account.on_hand, account.reserved = preview['after']['on_hand'], preview['after']['reserved']
    account.version += 1
    source = db.get(InventoryDocument, params['document_id']) if draft.kind == 'inventory_correction' else None
    selected = db.get(Reservation, source.reservation_id) if source and source.reservation_id else None
    old_quantity = source.effective_quantity if source else old_h
    if source:
        source.effective_quantity = params['new_quantity']
        source.version += 1
        if source.kind == 'pickup':
            selected.picked_quantity += preview['delta']
            selected.version += 1
    stamp = now()
    occurred = params['occurred'] if not source else {'precision': 'datetime', 'at': stamp.isoformat(), 'date': None,
                                                    't0_relation': None, 'boundary_note': ''}
    document = InventoryDocument(account_id=account.id, operation_id=op.id, actor_id=user.id,
        kind='correction' if source else 'adjustment', original_document_id=source.id if source else None,
        reservation_id=selected.id if selected else None, old_quantity=old_quantity, new_quantity=preview['quantity'],
        original_quantity=preview['delta'], effective_quantity=preview['delta'],
        occurred_precision=occurred['precision'], occurred_at=datetime.fromisoformat(occurred['at']) if occurred['at'] else None,
        occurred_date=date.fromisoformat(occurred['date']) if occurred['date'] else None,
        t0_relation=occurred['t0_relation'], boundary_note=occurred['boundary_note'], registered_at=stamp,
        basis_note=params['basis_note'])
    db.add(document); db.flush()
    ledger = Ledger(account_id=account.id, document_id=document.id, operation_id=op.id,
        on_hand_delta=account.on_hand-old_h, reserved_delta=account.reserved-old_r, version=account.version)
    db.add(ledger); db.flush()
    receipt = {'operation_id': op.id, 'draft_id': draft.id, 'draft_version': draft.version,
        'business_id': document.id, 'kind': draft.kind, 'account_id': account.id, 'quantity': preview['quantity'],
        'delta': preview['delta'], 'original_document_id': source.id if source else None,
        'old_quantity': old_quantity, 'new_quantity': preview['quantity'], 'occurred': occurred,
        'registered_at': stamp.isoformat(), 'actor_id': user.id,
        'balance': balance_result(db, db.get(Warehouse, account.warehouse_id), db.get(ProductModel, account.model_id), account),
        'reservation': reservation_result(db, selected) if selected else None, 'ledger_ids': [ledger.id]}
    op.state, op.confirmed_at, op.result, draft.state = 'succeeded', stamp.isoformat(), receipt, 'succeeded'
    db.flush()
    return receipt
