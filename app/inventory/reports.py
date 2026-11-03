from collections import defaultdict
from datetime import date, datetime
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import and_, case, func, select, true

from app.auth.router import current_user, database
from app.auth.service import ensure_permission, now
from app.catalog.models import ProductModel, Warehouse
from app.inventory.models import InventoryAccount, InventoryDocument, Ledger, Reservation


router = APIRouter()


def validate_targets(db, warehouse_id, model_id):
    if warehouse_id and not db.get(Warehouse, str(warehouse_id)):
        raise HTTPException(404, 'Warehouse not found')
    if model_id and not db.get(ProductModel, str(model_id)):
        raise HTTPException(404, 'Model not found')


def object_query(warehouse_id, model_id):
    query = select(Warehouse, ProductModel, InventoryAccount).select_from(Warehouse).join(ProductModel, true()).outerjoin(
        InventoryAccount, and_(InventoryAccount.warehouse_id == Warehouse.id,
                               InventoryAccount.model_id == ProductModel.id))
    if warehouse_id:
        query = query.where(Warehouse.id == str(warehouse_id))
    if model_id:
        query = query.where(ProductModel.id == str(model_id))
    return query


def objects(warehouse, model):
    return {'warehouse': {'id': warehouse.id, 'name': warehouse.name},
            'model': {'id': model.id, 'name': model.name}}


def document_rows(db, warehouse_id, model_id, kinds):
    # One statement gives original amounts, corrections and coverage the same snapshot.
    query = object_query(warehouse_id, model_id).add_columns(InventoryDocument).outerjoin(
        InventoryDocument, and_(InventoryDocument.account_id == InventoryAccount.id,
                               InventoryDocument.kind.in_(kinds + ['correction'])))
    return db.execute(query.order_by(Warehouse.name, Warehouse.id, ProductModel.name,
        ProductModel.id, InventoryDocument.registered_at, InventoryDocument.id)).all()


def document_results(rows, kinds):
    corrections = defaultdict(list)
    for warehouse, model, account, row in rows:
        if row and row.kind == 'correction':
            corrections[row.original_document_id].append({'id': row.id,
                'old_quantity': row.old_quantity, 'new_quantity': row.new_quantity,
                'registered_at': row.registered_at.isoformat(), 'basis_note': row.basis_note})
    result = []
    for warehouse, model, account, row in rows:
        if row and row.kind in kinds:
            result.append({'id': row.id, **objects(warehouse, model), 'kind': row.kind,
                'original_quantity': row.original_quantity, 'effective_quantity': row.effective_quantity,
                'version': row.version, 'reservation_id': row.reservation_id,
                'occurred': {'precision': row.occurred_precision,
                    'date': row.occurred_date.isoformat() if row.occurred_date else None,
                    'at': row.occurred_at.isoformat() if row.occurred_at else None},
                'registered_at': row.registered_at.isoformat(), 'basis_note': row.basis_note,
                'corrections': corrections[row.id]})
    return result


@router.get('/documents')
def documents(warehouse_id: UUID | None = None, model_id: UUID | None = None,
              user=Depends(current_user), db=Depends(database, scope='function')):
    ensure_permission(db, user, 'inventory.read')
    validate_targets(db, warehouse_id, model_id)
    kinds = ['inbound', 'outbound', 'pickup']
    return document_results(document_rows(db, warehouse_id, model_id, kinds), kinds)


@router.get('/statistics')
def statistics(start: date, end: date, warehouse_id: UUID | None = None, model_id: UUID | None = None,
               group_by: Literal['date', 'warehouse', 'model'] = 'date',
               user=Depends(current_user), db=Depends(database, scope='function')):
    ensure_permission(db, user, 'inventory.read')
    if start > end:
        raise HTTPException(422, 'Start date must not be after end date')
    validate_targets(db, warehouse_id, model_id)
    stamp = now()
    today = stamp.astimezone(ZoneInfo('Asia/Shanghai')).date()
    rows = document_rows(db, warehouse_id, model_id, ['inbound'])
    coverage = {}
    for warehouse, model, account, row in rows:
        status = 'uninitialized'
        if account:
            opening_day = account.t0.astimezone(ZoneInfo('Asia/Shanghai')).date()
            status = 'before_t0' if end < opening_day else 'future' if start > today else (
                'partial' if start <= opening_day or end > today else 'covered')
        coverage[(warehouse.id, model.id)] = {**objects(warehouse, model),
            'status': 'opened' if account else 'uninitialized',
            't0': account.t0.isoformat() if account else None, 'coverage_status': status}
    selected = []
    groups = {}
    for row in document_results(rows, ['inbound']):
        occurred = row['occurred']
        day = date.fromisoformat(occurred['date']) if occurred['date'] else datetime.fromisoformat(
            occurred['at']).astimezone(ZoneInfo('Asia/Shanghai')).date()
        if not start <= day <= end:
            continue
        selected.append(row)
        key = day.isoformat() if group_by == 'date' else row[group_by]['id']
        label = key if group_by == 'date' else row[group_by]['name']
        if key not in groups:
            groups[key] = {'key': key, 'label': label, 'quantity': 0}
        groups[key]['quantity'] += row['effective_quantity']
    return {'start': start.isoformat(), 'end': end.isoformat(), 'group_by': group_by,
        'total_quantity': sum(row['effective_quantity'] for row in selected),
        'groups': [groups[key] for key in sorted(groups)], 'documents': selected,
        'coverage': list(coverage.values()), 'queried_at': stamp.isoformat()}


@router.get('/reconciliation')
def reconciliation(warehouse_id: UUID | None = None, model_id: UUID | None = None,
                   user=Depends(current_user), db=Depends(database, scope='function')):
    ensure_permission(db, user, 'inventory.correct')
    validate_targets(db, warehouse_id, model_id)
    ledger = select(Ledger.account_id, func.sum(Ledger.on_hand_delta).label('on_hand'),
        func.sum(Ledger.reserved_delta).label('reserved')).group_by(Ledger.account_id).subquery()
    reservations = select(Reservation.account_id, func.sum(Reservation.registered_quantity -
        Reservation.picked_quantity - Reservation.cancelled_quantity).label('remaining')).group_by(
            Reservation.account_id).subquery()
    documents = select(InventoryDocument.account_id,
        func.sum(case((InventoryDocument.kind.in_(['opening', 'inbound', 'adjustment']), InventoryDocument.effective_quantity),
            (InventoryDocument.kind.in_(['outbound', 'pickup']), -InventoryDocument.effective_quantity), else_=0)).label('on_hand'),
        func.sum(case((InventoryDocument.kind == 'reserve', InventoryDocument.effective_quantity),
            (InventoryDocument.kind.in_(['cancel', 'pickup']), -InventoryDocument.effective_quantity), else_=0)).label('reserved_delta')
        ).group_by(InventoryDocument.account_id).subquery()
    # Aggregate separately to avoid multiplying ledger rows by reservation rows.
    query = object_query(warehouse_id, model_id).add_columns(
        func.coalesce(ledger.c.on_hand, 0), func.coalesce(ledger.c.reserved, 0),
        func.coalesce(reservations.c.remaining, 0), func.coalesce(documents.c.on_hand, 0),
        func.coalesce(documents.c.reserved_delta, 0)).outerjoin(documents,
        documents.c.account_id == InventoryAccount.id).outerjoin(ledger,
        ledger.c.account_id == InventoryAccount.id).outerjoin(reservations,
        reservations.c.account_id == InventoryAccount.id)
    items = []
    for warehouse, model, account, ledger_h, ledger_r, remaining, document_h, document_r_delta in db.execute(query.order_by(
            Warehouse.name, Warehouse.id, ProductModel.name, ProductModel.id)):
        items.append({**objects(warehouse, model), 'status': 'opened' if account else 'uninitialized',
            'account_id': account.id if account else None,
            'on_hand': account.on_hand if account else None, 'reserved': account.reserved if account else None,
            'ledger_on_hand': ledger_h if account else None, 'ledger_reserved': ledger_r if account else None,
            'reservation_remaining': remaining if account else None,
            'documents_on_hand': document_h if account else None,
            'documents_reserved': account.opening_reserved + document_r_delta if account else None,
            'consistent': (account.on_hand == ledger_h == document_h and
                account.reserved == ledger_r == remaining == account.opening_reserved + document_r_delta) if account else None})
    opened = [row for row in items if row['status'] == 'opened']
    return {'items': items, 'consistent': all(row['consistent'] for row in opened) if opened else None,
            'queried_at': now().isoformat()}
