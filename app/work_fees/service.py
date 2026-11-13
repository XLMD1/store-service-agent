from datetime import UTC

from fastapi import HTTPException
from sqlalchemy import select

from app.auth.models import User, UserRole, new_id
from app.auth.service import digest
from app.service_records.models import ServiceRecord
from app.work_fees.models import FeeEvent, WorkerFee, WorkOrder


def work_summary(work):
    return {
        'id': work.id, 'kind': work.kind, 'location': work.location, 'description': work.description,
        'scheduled_on': work.scheduled_on.isoformat() if work.scheduled_on else None,
        'reference': work.reference, 'service_record_id': work.service_record_id,
        'backfill_from': work.backfill_from.isoformat() if work.backfill_from else None,
    }


def fee_state(fee):
    return {
        'version': fee.version, 'state': fee.state, 'worked_on': fee.worked_on.isoformat() if fee.worked_on else None,
        'report': fee.report, 'claimed_cents': fee.claimed_cents, 'confirmed_cents': fee.confirmed_cents,
        'settlement': fee.settlement,
    }


def fee_summary(fee, work, worker_name):
    return {'id': fee.id, 'worker_id': fee.worker_id, 'worker_name': worker_name,
            'work': work_summary(work), **fee_state(fee)}


def event_summary(event):
    return {
        'actor_id': event.actor_id, 'operation_id': event.operation_id,
        'occurred_at': event.occurred_at.astimezone(UTC).isoformat(),
        'decision': event.decision, 'before': event.before,
        'after': {name: event.result[name] for name in event.before},
    }


def find_workers(db, ids):
    workers = dict(db.execute(select(User.id, User.username).join(UserRole)
                              .where(User.enabled.is_(True), UserRole.role == 'technician',
                                     User.id.in_(ids))).all())
    if len(workers) != len(ids):
        raise HTTPException(422, 'Choose active technicians')
    return workers


def start_work(db, actor, payload, *, cutoff=None):
    request_id = str(payload.request_id)
    fingerprint = digest(payload.model_dump_json())
    existing = db.scalar(select(WorkOrder).where(WorkOrder.created_by == actor.id,
                                                 WorkOrder.request_id == request_id))
    if existing:
        if existing.request_digest != fingerprint:
            raise HTTPException(409, 'Work request already used with different details')
        return existing, False
    fields = payload.work.model_dump()
    record_id = fields.pop('service_record_id')
    if record_id and db.get(ServiceRecord, str(record_id)) is None:
        raise HTTPException(404, 'Service record not found')
    work = WorkOrder(created_by=actor.id, request_id=request_id, request_digest=fingerprint,
                     service_record_id=str(record_id) if record_id else None, backfill_from=cutoff, **fields)
    db.add(work)
    db.flush()
    return work, True


def report_fee(fee, report):
    fee.worked_on = report.worked_on
    fee.report = report.model_dump(mode='json')
    fee.claimed_cents = report.total
    fee.state = 'review'


def apply_decision(fee, decision):
    action = decision.action
    if action == 'approve':
        if fee.state != 'review':
            raise HTTPException(409, 'Fee is not awaiting review')
        if fee.claimed_cents != decision.amount_cents and not decision.reason:
            raise HTTPException(422, 'Explain why the approved amount differs')
        fee.confirmed_cents = decision.amount_cents
        fee.state = 'payable'
    elif action == 'correct_amount':
        if fee.state != 'payable':
            raise HTTPException(409, 'Reopen a settled fee before correcting the amount')
        fee.confirmed_cents = decision.amount_cents
    elif action == 'reopen':
        if fee.state not in {'deducted', 'paid'}:
            raise HTTPException(409, 'Fee is not settled')
        fee.settlement = None
        fee.state = 'payable'
    else:
        if fee.state != 'payable' or not fee.confirmed_cents:
            raise HTTPException(409, 'Only a positive payable fee can be settled')
        fee.settlement = {**decision.model_dump(mode='json'), 'amount_cents': fee.confirmed_cents}
        fee.state = action


def previous_result(db, user, fee, payload):
    event = db.scalar(select(FeeEvent).where(FeeEvent.actor_id == user.id,
                                             FeeEvent.operation_id == str(payload.operation_id)))
    if event:
        if event.fee_id != fee.id or event.request_digest != digest(payload.model_dump_json()):
            raise HTTPException(409, 'Operation already used with different details')
        return event.result
    if fee.version != payload.version:
        raise HTTPException(409, 'Fee changed, reload before continuing')
    return None


def append_event(db, user, fee, before, decision, result, payload=None):
    db.add(FeeEvent(fee_id=fee.id, actor_id=user.id,
                    operation_id=str(payload.operation_id) if payload else new_id(),
                    request_digest=digest(payload.model_dump_json()) if payload else digest(fee.id),
                    decision=decision, before=before, result=result))
    db.flush()
    return result
