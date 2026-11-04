import hashlib
import json
from datetime import date, datetime

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.auth.service import ensure_permission, lock_accounts, now
from app.catalog.models import Customer, ProductModel, Warehouse
from app.inventory.models import InventoryAccount, InventoryDocument, Ledger, Reservation
from app.inventory.service import balance_result, find_account, stock_event_context
from app.inventory.movements import MOVEMENT_KINDS, apply_movement, movement_preview
from app.inventory.corrections import CORRECTION_KINDS, apply_correction, correction_preview
from app.operations.models import Draft, Operation
from app.operations.schemas import InboundParameters, OpeningParameters, ReserveParameters, ReservationActionParameters, AdjustmentParameters, CorrectionParameters


PERMISSIONS = {'inventory_opening': 'inventory.opening', 'inventory_inbound': 'inventory.inbound',
    'inventory_outbound': 'inventory.outbound', 'reservation_create': 'reservation.confirm',
    'reservation_cancel': 'reservation.cancel', 'reservation_pickup': 'reservation.pickup', 'inventory_adjustment': 'inventory.correct', 'inventory_correction': 'inventory.correct'}


def normalize_parameters(kind, parameters):
    schema = {'inventory_opening': OpeningParameters, 'inventory_inbound': InboundParameters,
        'inventory_outbound': InboundParameters, 'reservation_create': ReserveParameters,
        'reservation_cancel': ReservationActionParameters, 'reservation_pickup': ReservationActionParameters,
        'inventory_adjustment': AdjustmentParameters, 'inventory_correction': CorrectionParameters}[kind]
    try:
        return schema.model_validate(parameters).model_dump(mode='json')
    except ValidationError:
        raise HTTPException(422, 'Invalid business parameters') from None


def bound_digest(kind, parameters, versions):
    value = json.dumps([kind, parameters, versions], ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(value.encode()).hexdigest()


def check_actor(db, user, actor_id, kind='inventory_opening'):
    ensure_permission(db, user, PERMISSIONS[kind])
    if user.id != actor_id:
        raise HTTPException(403, 'Operation belongs to another actor')


def opening_preview(db, params, *, locking=False):
    missing = [key for key in ['warehouse_id', 'model_id', 't0', 'on_hand'] if params[key] is None]
    if not params['basis_note'].strip():
        missing.append('basis_note')
    if missing:
        return missing, None, {}
    warehouse_query = select(Warehouse).where(Warehouse.id == params['warehouse_id'])
    model_query = select(ProductModel).where(ProductModel.id == params['model_id'])
    warehouse = db.scalar(warehouse_query.with_for_update() if locking else warehouse_query)
    model = db.scalar(model_query.with_for_update() if locking else model_query)
    if not warehouse or not model or not warehouse.enabled or not model.enabled:
        raise HTTPException(422, 'Choose an enabled warehouse and model')
    if find_account(db, warehouse.id, model.id):
        raise HTTPException(409, 'This warehouse/model is already opened')
    for row in params['opening_reservations']:
        if not row['basis_note'].strip() or not db.get(Customer, row['customer_id']):
            raise HTTPException(422, 'Select a known customer and reservation basis')
    reserved = sum(row['remaining_quantity'] for row in params['opening_reservations'])
    if reserved > params['on_hand']:
        raise HTTPException(422, 'Opening reservations exceed physical stock')
    return [], {'on_hand': params['on_hand'], 'reserved': reserved, 'available': params['on_hand'] - reserved}, {
        'warehouse': warehouse.version, 'model': model.version, 'account': None}


def draft_result(db, row):
    operation = db.scalar(select(Operation).where(Operation.draft_id == row.id,
        Operation.draft_version == row.version, Operation.state.in_(['pending', 'succeeded'])).order_by(Operation.state.desc(), Operation.id))
    return {'id': row.id, 'version': row.version, 'kind': row.kind, 'parameters': row.parameters,
            'target_versions': row.target_versions, 'missing_fields': row.missing_fields,
            'preview': row.preview, 'state': row.state, 'operation_id': operation.id if operation else None}


def prepare_draft(db, user, parameters, row=None, *, kind='inventory_opening'):
    kind = row.kind if row else kind
    ensure_permission(db, user, PERMISSIONS[kind])
    params = normalize_parameters(kind, parameters)
    if kind in CORRECTION_KINDS:
        missing, preview, versions = correction_preview(db, kind, params)
    elif kind in MOVEMENT_KINDS:
        missing, preview, versions = movement_preview(db, kind, params)
    else:
        preview_function = opening_preview if kind == 'inventory_opening' else inbound_preview
        missing, preview, versions = preview_function(db, params)
    if row is None:
        row = Draft(created_by=user.id, kind=kind, version=1)
        db.add(row)
    else:
        row.version += 1
        for previous in db.scalars(select(Operation).where(Operation.draft_id == row.id, Operation.state == 'pending')):
            previous.state = 'superseded'
    row.parameters, row.missing_fields, row.preview, row.target_versions = params, missing, preview, versions
    row.state = 'missing' if missing else 'ready'
    db.flush()
    if not missing:
        db.add(Operation(draft_id=row.id, draft_version=row.version, actor_id=user.id,
                         parameters_digest=bound_digest(row.kind, params, versions), target_versions=versions, state='pending'))
        db.flush()
    return draft_result(db, row)


def confirm_operation(db, user, operation_id, payload):
    op = db.scalar(select(Operation).where(Operation.id == str(operation_id)).with_for_update())
    if not op:
        raise HTTPException(404, 'Operation not found')
    draft = db.scalar(select(Draft).where(Draft.id == op.draft_id).with_for_update())
    lock_accounts(db)
    check_actor(db, user, op.actor_id, draft.kind)
    params = normalize_parameters(draft.kind, payload.parameters)
    if str(payload.draft_id) != op.draft_id or payload.draft_version != op.draft_version or (
            bound_digest(draft.kind, params, op.target_versions) != op.parameters_digest):
        raise HTTPException(409, 'Confirmation does not match the bound operation')
    if op.state == 'succeeded':
        return op.result
    if op.state != 'pending' or draft.state != 'ready' or draft.version != op.draft_version:
        raise HTTPException(409, 'Draft changed or already submitted')
    if draft.kind in CORRECTION_KINDS:
        return apply_correction(db, user, op, draft, params)
    if draft.kind == 'inventory_inbound':
        return apply_inbound(db, user, op, draft, params)
    if draft.kind in MOVEMENT_KINDS:
        return apply_movement(db, user, op, draft, params)
    missing, preview, versions = opening_preview(db, params, locking=True)
    if missing or versions != op.target_versions:
        raise HTTPException(409, 'Target changed; refresh the draft and confirm again')
    stamp = now()
    account = InventoryAccount(warehouse_id=params['warehouse_id'], model_id=params['model_id'],
        t0=datetime.fromisoformat(params['t0']), opening_on_hand=preview['on_hand'], opening_reserved=preview['reserved'],
        on_hand=preview['on_hand'], reserved=preview['reserved'], opening_operation_id=op.id)
    db.add(account)
    try:
        db.flush()
    except IntegrityError:
        raise HTTPException(409, 'This warehouse/model is already opened') from None
    for row in params['opening_reservations']:
        db.add(Reservation(account_id=account.id, customer_id=row['customer_id'], registered_quantity=row['remaining_quantity'],
                           basis_note=row['basis_note']))
    document = InventoryDocument(account_id=account.id, operation_id=op.id, actor_id=user.id, kind='opening',
        original_quantity=account.on_hand, effective_quantity=account.on_hand, occurred_at=account.t0,
        registered_at=stamp, basis_note=params['basis_note'])
    db.add(document); db.flush()
    ledger = Ledger(account_id=account.id, document_id=document.id, operation_id=op.id,
                    on_hand_delta=account.on_hand, reserved_delta=account.reserved, version=1)
    db.add(ledger); db.flush()
    warehouse, model = db.get(Warehouse, account.warehouse_id), db.get(ProductModel, account.model_id)
    receipt = {'operation_id': op.id, 'draft_id': draft.id, 'draft_version': draft.version,
        'business_id': document.id, 'kind': draft.kind, 'account_id': account.id,
        'quantity': account.on_hand, 'opening_reserved': account.reserved, 't0': account.t0.isoformat(),
        'occurred': {'precision': 'datetime', 'at': account.t0.isoformat()}, 'registered_at': stamp.isoformat(),
        'actor_id': user.id, 'balance': balance_result(db, warehouse, model, account), 'ledger_ids': [ledger.id]}
    op.state, op.confirmed_at, op.result, draft.state = 'succeeded', stamp.isoformat(), receipt, 'succeeded'
    db.flush()
    return receipt


def inbound_preview(db, params, *, locking=False, expected_versions=None):
    missing, account, warehouse, model, versions = stock_event_context(
        db, params, locking=locking, expected_versions=expected_versions, basis_required=False)
    if missing:
        return missing, None, versions
    if account.on_hand + params['quantity'] > 2147483647:
        raise HTTPException(422, 'Stock quantity exceeds supported integer range')
    before = {'on_hand': account.on_hand, 'reserved': account.reserved, 'available': account.on_hand - account.reserved}
    after = {**before, 'on_hand': before['on_hand'] + params['quantity'], 'available': before['available'] + params['quantity']}
    return [], {'before': before, 'after': after, 'quantity': params['quantity']}, versions


def apply_inbound(db, user, op, draft, params):
    missing, preview, versions = inbound_preview(db, params, locking=True, expected_versions=op.target_versions)
    if missing or versions != op.target_versions:
        raise HTTPException(409, 'Target changed; refresh the draft and confirm again')
    account = find_account(db, params['warehouse_id'], params['model_id'])
    account.on_hand = preview['after']['on_hand']
    account.version += 1
    stamp = now()
    occurred = params['occurred']
    document = InventoryDocument(account_id=account.id, operation_id=op.id, actor_id=user.id, kind='inbound',
        original_quantity=params['quantity'], effective_quantity=params['quantity'],
        occurred_precision=occurred['precision'],
        occurred_at=datetime.fromisoformat(occurred['at']) if occurred['at'] else None,
        occurred_date=date.fromisoformat(occurred['date']) if occurred['date'] else None,
        t0_relation=occurred['t0_relation'], boundary_note=occurred['boundary_note'],
        registered_at=stamp, basis_note=params['basis_note'])
    db.add(document); db.flush()
    ledger = Ledger(account_id=account.id, document_id=document.id, operation_id=op.id,
                    on_hand_delta=params['quantity'], reserved_delta=0, version=account.version)
    db.add(ledger); db.flush()
    receipt = {'operation_id': op.id, 'draft_id': draft.id, 'draft_version': draft.version,
        'business_id': document.id, 'kind': draft.kind, 'account_id': account.id, 'quantity': params['quantity'],
        'occurred': occurred, 'registered_at': stamp.isoformat(), 'actor_id': user.id,
        'balance': balance_result(db, db.get(Warehouse, account.warehouse_id), db.get(ProductModel, account.model_id), account),
        'ledger_ids': [ledger.id]}
    op.state, op.confirmed_at, op.result, draft.state = 'succeeded', stamp.isoformat(), receipt, 'succeeded'
    db.flush()
    return receipt
