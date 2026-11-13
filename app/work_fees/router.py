from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select

from app.auth.models import User, UserRole
from app.auth.router import check_write, current_user, database
from app.auth.service import ensure_permission, identity, lock_accounts
from app.work_fees.models import FeeEvent, WorkerFee, WorkOrder
from app.work_fees.schemas import (Approve, Backfill, FeeDecision, FeeState, JobCreate, ReportUpdate, WorkerAdd,
                                   WorkReport)
from app.work_fees.service import (append_event, apply_decision, event_summary, fee_state, fee_summary, find_workers,
                                   previous_result, report_fee, start_work, work_summary)


router = APIRouter(prefix='/api/work-fees')
PAGE_SIZE = 50
FEE_ROWS = (select(WorkerFee, WorkOrder, User.username).select_from(WorkerFee)
            .join(WorkOrder, WorkerFee.work_id == WorkOrder.id).join(User, WorkerFee.worker_id == User.id))


def manager(user=Depends(current_user), db=Depends(database, scope='function')):
    lock_accounts(db)
    ensure_permission(db, user, 'work_fee.manage')
    return user


def worker(user=Depends(current_user), db=Depends(database, scope='function')):
    lock_accounts(db)
    ensure_permission(db, user, 'work_fee.report')
    return user


def read_scope(db, user):
    db.refresh(user)
    permissions = identity(db, user)['permissions']
    if user.enabled:
        if 'work_fee.manage' in permissions:
            return None
        if 'work_fee.report' in permissions:
            return user.id
    raise HTTPException(403, 'Work fee access is required')


def find_fee(db, fee_id, *, worker_id=None, write=False):
    query = FEE_ROWS.where(WorkerFee.id == str(fee_id))
    if worker_id:
        query = query.where(WorkerFee.worker_id == worker_id)
    row = db.execute(query.with_for_update(of=WorkerFee) if write else query).first()
    if row is None:
        raise HTTPException(404, 'Work fee not found')
    return row


@router.get('/workers')
def workers(user=Depends(current_user), db=Depends(database, scope='function')):
    ensure_permission(db, user, 'work_fee.manage')
    rows = db.execute(select(User.id, User.username).join(UserRole)
                      .where(User.enabled.is_(True), UserRole.role == 'technician').order_by(User.username))
    return {'items': [{'id': worker_id, 'name': name} for worker_id, name in rows]}


@router.get('')
def list_fees(worker_id: UUID | None = None, from_on: date | None = None, to_on: date | None = None,
              state: FeeState | None = None, offset: int = Query(0, ge=0), user=Depends(current_user),
              db=Depends(database, scope='function')):
    lock_accounts(db)
    scope = read_scope(db, user)
    selected = str(worker_id) if worker_id else scope
    if scope and scope != selected:
        raise HTTPException(403, 'Only your own fees are visible')
    if from_on and to_on and from_on > to_on:
        raise HTTPException(422, 'Work date range is reversed')
    conditions = []
    if selected:
        conditions.append(WorkerFee.worker_id == selected)
    if from_on:
        conditions.append(WorkerFee.worked_on >= from_on)
    if to_on:
        conditions.append(WorkerFee.worked_on <= to_on)
    if state:
        conditions.append(WorkerFee.state == state)
    rows = list(db.execute(FEE_ROWS.where(*conditions).order_by(WorkerFee.worked_on.desc().nulls_last(),
                                                                WorkerFee.id)
                           .offset(offset).limit(PAGE_SIZE + 1)))
    totals = dict.fromkeys(('payable', 'deducted', 'paid'), 0)
    for status, cents in db.execute(select(WorkerFee.state, func.sum(WorkerFee.confirmed_cents))
                                    .where(WorkerFee.state.in_(totals), *conditions).group_by(WorkerFee.state)):
        totals[status] = cents
    return {'items': [fee_summary(*row) for row in rows[:PAGE_SIZE]], 'totals': totals,
            'next_offset': offset + PAGE_SIZE if len(rows) > PAGE_SIZE else None}


@router.post('/jobs', status_code=201, dependencies=[Depends(check_write)])
def create_job(payload: JobCreate, user=Depends(manager), db=Depends(database, scope='function')):
    ids = [str(worker_id) for worker_id in payload.worker_ids]
    work, created = start_work(db, user, payload)
    if created:
        find_workers(db, ids)
        db.add_all(WorkerFee(work_id=work.id, worker_id=worker_id, state='assigned') for worker_id in ids)
        db.flush()
    rows = db.execute(FEE_ROWS.where(WorkerFee.work_id == work.id).order_by(WorkerFee.worker_id))
    return {'work': work_summary(work), 'fees': [fee_summary(*row) for row in rows]}


@router.post('/jobs/{work_id}/workers', dependencies=[Depends(check_write)])
def add_worker(work_id: UUID, payload: WorkerAdd, user=Depends(manager), db=Depends(database, scope='function')):
    work = db.get(WorkOrder, str(work_id))
    if work is None:
        raise HTTPException(404, 'Work order not found')
    worker_id = str(payload.worker_id)
    existing = db.execute(FEE_ROWS.where(WorkerFee.work_id == work.id, WorkerFee.worker_id == worker_id)).first()
    if existing:
        return fee_summary(*existing)
    if work.backfill_from:
        raise HTTPException(409, 'Historical work must use a verified backfill')
    name = find_workers(db, [worker_id])[worker_id]
    fee = WorkerFee(work_id=work.id, worker_id=worker_id, state='assigned')
    db.add(fee)
    db.flush()
    return fee_summary(fee, work, name)


@router.post('/reports', status_code=201, dependencies=[Depends(check_write)])
def create_report(payload: WorkReport, user=Depends(worker), db=Depends(database, scope='function')):
    work, created = start_work(db, user, payload)
    if not created:
        fee = db.scalar(select(WorkerFee).where(WorkerFee.work_id == work.id, WorkerFee.worker_id == user.id))
        return fee_summary(fee, work, user.username)
    fee = WorkerFee(work_id=work.id, worker_id=user.id)
    report_fee(fee, payload.report)
    db.add(fee)
    db.flush()
    return fee_summary(fee, work, user.username)


@router.post('/backfill', status_code=201, dependencies=[Depends(check_write)])
def backfill(payload: Backfill, user=Depends(manager), db=Depends(database, scope='function')):
    if payload.report.worked_on < payload.cutoff_on:
        raise HTTPException(422, 'Work is before the verified backfill boundary')
    work, created = start_work(db, user, payload, cutoff=payload.cutoff_on)
    worker_id = str(payload.worker_id)
    if not created:
        row = db.execute(FEE_ROWS.where(WorkerFee.work_id == work.id, WorkerFee.worker_id == worker_id)).one()
        return fee_summary(*row)
    name = find_workers(db, [worker_id])[worker_id]
    fee = WorkerFee(work_id=work.id, worker_id=worker_id, version=1)
    report_fee(fee, payload.report)
    before = fee_state(fee)
    apply_decision(fee, Approve(action='approve', amount_cents=payload.amount_cents, reason=payload.reason))
    if payload.settlement:
        apply_decision(fee, payload.settlement)
    db.add(fee)
    db.flush()
    decision = {'action': 'backfill', 'reason': payload.reason, 'cutoff_on': payload.cutoff_on.isoformat(),
                'settlement': fee.settlement}
    return append_event(db, user, fee, before, decision, fee_summary(fee, work, name))


@router.get('/{fee_id}')
def read_fee(fee_id: UUID, user=Depends(current_user), db=Depends(database, scope='function')):
    fee, work, name = find_fee(db, fee_id, worker_id=read_scope(db, user))
    events = db.scalars(select(FeeEvent).where(FeeEvent.fee_id == fee.id)
                        .order_by(FeeEvent.occurred_at, FeeEvent.id))
    return {**fee_summary(fee, work, name), 'events': [event_summary(event) for event in events]}


@router.put('/{fee_id}/report', dependencies=[Depends(check_write)])
def update_report(fee_id: UUID, payload: ReportUpdate, user=Depends(worker),
                  db=Depends(database, scope='function')):
    fee, work, name = find_fee(db, fee_id, worker_id=user.id, write=True)
    original = previous_result(db, user, fee, payload)
    if original is not None:
        return original
    if fee.state not in {'assigned', 'review'}:
        raise HTTPException(409, 'The owner has already reviewed this fee')
    before = fee_state(fee)
    report_fee(fee, payload.report)
    fee.version += 1
    return append_event(db, user, fee, before, {'action': 'report'}, fee_summary(fee, work, name), payload)


@router.post('/{fee_id}/decisions', dependencies=[Depends(check_write)])
def decide(fee_id: UUID, payload: FeeDecision, user=Depends(manager), db=Depends(database, scope='function')):
    fee, work, name = find_fee(db, fee_id, write=True)
    original = previous_result(db, user, fee, payload)
    if original is not None:
        return original
    before = fee_state(fee)
    apply_decision(fee, payload.decision)
    fee.version += 1
    return append_event(db, user, fee, before, payload.decision.model_dump(mode='json'),
                        fee_summary(fee, work, name), payload)
