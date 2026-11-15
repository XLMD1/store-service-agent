import re
from datetime import UTC
from unicodedata import normalize
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import ValidationError
from sqlalchemy import select

from app.auth.models import User
from app.auth.router import check_write, current_user, database
from app.auth.service import digest, ensure_permission, lock_accounts
from app.service_records.models import (ServiceContact, ServiceRecord, ServiceRecordDraft, ServiceRecordRevision,
                                        ServiceRecordSupplement)
from app.service_records.schemas import ArchiveSearch, DraftFields, RevisionConfirm, SupplementConfirm
from app.sources.models import Source
from app.sources.router import visible_source


router = APIRouter(prefix='/api/service-records')
PAGE_SIZE = 50


def phone_key(value):
    cleaned = re.sub(r'[\s()-]', '', normalize('NFKC', value or '')).removeprefix('+')
    return cleaned if re.fullmatch(r'[0-9]{7,15}', cleaned) else None


def address_key(value):
    return ''.join(normalize('NFKC', value or '').casefold().split()) or None


def contact_summary(contact):
    return {'id': contact.id, 'name': contact.name, 'phone': contact.phone, 'address': contact.address}


def find_contact(db, contact_id):
    contact = db.get(ServiceContact, str(contact_id))
    if contact is None:
        raise HTTPException(404, 'Service contact not found')
    return contact


def verified_contact_fields(fields):
    uncertain = set(fields.get('uncertain_fields', ()))
    if not (fields.get('problem') or '').strip() or 'problem' in uncertain:
        raise HTTPException(422, 'Review the problem before archiving')
    phone = fields.get('phone') if 'phone' not in uncertain else None
    address = fields.get('address') if 'address' not in uncertain else None
    phone_value = phone_key(phone)
    address_value = address_key(address)
    if not (phone_value or address_value):
        raise HTTPException(422, 'A usable phone or address is required')
    name = (fields.get('customer_name') or '').strip() if 'customer_name' not in uncertain else ''
    return {'name': name or None, 'phone': phone if phone_value else None, 'phone_key': phone_value,
            'address': address if address_value else None, 'address_key': address_value}


def saved_archive(db, draft):
    return db.scalar(select(ServiceRecord).where(ServiceRecord.draft_id == draft.id))


def archive_receipt(record):
    return {'id': record.id, 'contact_id': record.contact_id, 'operation_id': record.operation_id,
            'archived_at': record.archived_at.astimezone(UTC).isoformat()}


@router.post('/search', dependencies=[Depends(check_write)])
def search(payload: ArchiveSearch, user=Depends(current_user), db=Depends(database, scope='function')):
    ensure_permission(db, user, 'service.read')
    return contact_candidates(db, payload.q, payload.offset)


def contact_candidates(db, query, offset=0):
    address = address_key(query)
    if address is None or '\x00' in address:
        raise HTTPException(422, 'Enter a phone number or an address')
    phone = phone_key(query)
    match = ServiceContact.phone_key == phone if phone else ServiceContact.address_key.contains(address, autoescape=True)
    rows = list(db.scalars(select(ServiceContact).where(match)
                           .order_by(ServiceContact.id).offset(offset).limit(PAGE_SIZE + 1)))
    return {'items': [contact_summary(row) for row in rows[:PAGE_SIZE]],
            'next_offset': offset + PAGE_SIZE if len(rows) > PAGE_SIZE else None}


@router.get('/contacts/{contact_id}')
def history(contact_id: UUID, offset: int = Query(0, ge=0), user=Depends(current_user),
            db=Depends(database, scope='function')):
    ensure_permission(db, user, 'service.read')
    contact = find_contact(db, contact_id)
    return {'contact': contact_summary(contact), **contact_history(db, user, contact.id, offset)}


def contact_history(db, user, contact_id, offset=0, *, active_only=False, record_id=None):
    latest = (select(ServiceRecordSupplement.result).where(ServiceRecordSupplement.record_id == ServiceRecord.id)
              .order_by(ServiceRecordSupplement.version.desc()).limit(1).scalar_subquery())
    query = (select(ServiceRecord, Source.id, Source.actor_id, latest)
             .join(ServiceRecordDraft, ServiceRecord.draft_id == ServiceRecordDraft.id)
             .join(Source, ServiceRecordDraft.source_id == Source.id)
             .where(ServiceRecord.contact_id == contact_id))
    if active_only:
        query = query.where(ServiceRecord.voided.is_(False))
    if record_id:
        query = query.where(ServiceRecord.id == record_id)
    rows = list(db.execute(query.order_by(ServiceRecord.fields['repair_date'].astext.desc().nulls_last(),
                                          ServiceRecord.archived_at.desc(), ServiceRecord.id)
                           .offset(offset).limit(PAGE_SIZE + 1)))
    return {'items': [{'id': record.id, 'fields': record.fields, 'archived_at': record.archived_at.isoformat(),
                       'status': 'voided' if record.voided else 'active', 'version': record.version,
                       'latest_result': latest_result,
                       'source_id': source_id if actor_id == user.id else None}
                      for record, source_id, actor_id, latest_result in rows[:PAGE_SIZE]],
            'next_offset': offset + PAGE_SIZE if len(rows) > PAGE_SIZE else None}


def find_record(db, record_id, *, for_update=False):
    query = select(ServiceRecord).where(ServiceRecord.id == str(record_id))
    record = db.scalar(query.with_for_update() if for_update else query)
    if record is None:
        raise HTTPException(404, 'Service record not found')
    return record


def supplement_summary(supplement, actor, source_allowed):
    return {'id': supplement.id, 'version': supplement.version, 'result': supplement.result,
            'source_id': supplement.source_id if source_allowed else None,
            'actor': actor, 'created_at': supplement.created_at.astimezone(UTC).isoformat()}


@router.get('/{record_id}/supplements')
def list_supplements(record_id: UUID, offset: int = Query(0, ge=0), user=Depends(current_user),
                     db=Depends(database, scope='function')):
    ensure_permission(db, user, 'service.read')
    record = find_record(db, record_id)
    entries = list(db.execute(
        select(ServiceRecordSupplement, User.username, Source.actor_id)
        .join(User, User.id == ServiceRecordSupplement.actor_id)
        .join(Source, Source.id == ServiceRecordSupplement.source_id)
        .where(ServiceRecordSupplement.record_id == record.id, ServiceRecordSupplement.version <= record.version)
        .order_by(ServiceRecordSupplement.version.desc()).offset(offset).limit(PAGE_SIZE + 1)
    ))
    return {'version': record.version, 'next_offset': offset + PAGE_SIZE if len(entries) > PAGE_SIZE else None,
            'items': [supplement_summary(entry, actor, source_actor == user.id)
                      for entry, actor, source_actor in entries[:PAGE_SIZE]]}


@router.post('/{record_id}/supplements', dependencies=[Depends(check_write)])
def add_supplement(record_id: UUID, payload: SupplementConfirm, user=Depends(current_user),
                   db=Depends(database, scope='function')):
    lock_accounts(db)
    ensure_permission(db, user, 'service.read')
    ensure_permission(db, user, 'service.confirm')
    record = find_record(db, record_id, for_update=True)
    return save_supplement(db, user, record, payload)


def save_supplement(db, user, record, payload):
    source = visible_source(db, user, payload.source_id)
    if db.get(ServiceRecordDraft, record.draft_id).source_id == source.id:
        raise HTTPException(422, 'Choose a follow-up source')
    operation_id = str(payload.operation_id)
    request_digest = digest(payload.model_dump_json())
    existing = db.scalar(select(ServiceRecordSupplement).where(
        ServiceRecordSupplement.record_id == record.id, ServiceRecordSupplement.actor_id == user.id,
        ServiceRecordSupplement.operation_id == operation_id,
    ))
    if existing:
        if request_digest != existing.request_digest:
            raise HTTPException(409, 'Supplement request already used with different content')
        return supplement_summary(existing, user.username, True)
    if record.voided or record.version != payload.version:
        raise HTTPException(409, 'Service record changed, review the latest version')
    record.version += 1
    supplement = ServiceRecordSupplement(
        record_id=record.id, version=record.version, actor_id=user.id, operation_id=operation_id,
        request_digest=request_digest, source_id=source.id, result=payload.result,
    )
    db.add(supplement)
    db.flush()
    return supplement_summary(supplement, user.username, True)


def revision_summary(entry, username):
    return {'id': entry.id, 'kind': entry.kind, 'version': entry.version, 'reason': entry.reason,
            'before': entry.before, 'after': entry.after, 'actor': username,
            'created_at': entry.created_at.astimezone(UTC).isoformat()}


@router.get('/{record_id}/revisions')
def revisions(record_id: UUID, offset: int = Query(0, ge=0), user=Depends(current_user),
              db=Depends(database, scope='function')):
    ensure_permission(db, user, 'service.read')
    record = find_record(db, record_id)
    rows = list(db.execute(select(ServiceRecordRevision, User.username)
                           .join(User, User.id == ServiceRecordRevision.actor_id)
                           .where(ServiceRecordRevision.record_id == record.id,
                                  ServiceRecordRevision.version <= record.version)
                           .order_by(ServiceRecordRevision.version.desc()).offset(offset).limit(PAGE_SIZE + 1)))
    return {'items': [revision_summary(entry, username) for entry, username in rows[:PAGE_SIZE]],
            'version': record.version, 'fields': record.fields, 'status': 'voided' if record.voided else 'active',
            'next_offset': offset + PAGE_SIZE if len(rows) > PAGE_SIZE else None}


@router.post('/{record_id}/revisions', dependencies=[Depends(check_write)])
def apply_revision(record_id: UUID, payload: RevisionConfirm, user=Depends(current_user),
                   db=Depends(database, scope='function')):
    lock_accounts(db)
    ensure_permission(db, user, 'service.read')
    ensure_permission(db, user, 'account.manage' if payload.kind == 'void' else 'service.confirm')
    record = find_record(db, record_id, for_update=True)
    operation_id = str(payload.operation_id)
    request_digest = digest(payload.model_dump_json())
    existing = db.scalar(select(ServiceRecordRevision).where(
        ServiceRecordRevision.record_id == record.id, ServiceRecordRevision.actor_id == user.id,
        ServiceRecordRevision.operation_id == operation_id))
    if existing:
        if existing.request_digest != request_digest:
            raise HTTPException(409, 'Revision request already used with different content')
        return revision_summary(existing, user.username)
    if record.voided or record.version != payload.version:
        raise HTTPException(409, 'Service record changed, review the latest version')
    if payload.kind == 'void':
        before, after = {'status': 'active'}, {'status': 'voided'}
        record.voided = True
    else:
        values = record.fields | payload.changes
        reviewed = set(payload.changes)
        values['uncertain_fields'] = [name for name in values.get('uncertain_fields', []) if name not in reviewed]
        try:
            values = DraftFields.model_validate(values).model_dump()
        except ValidationError as error:
            raise HTTPException(422, 'Invalid corrected fields') from error
        if not (values['problem'] or '').strip():
            raise HTTPException(422, 'A problem description is required')
        changed = [name for name in values if values[name] != record.fields.get(name)]
        if not changed:
            raise HTTPException(422, 'No changed fields')
        before = {name: record.fields.get(name) for name in changed}
        after = {name: values[name] for name in changed}
        record.fields = values
    record.version += 1
    entry = ServiceRecordRevision(record_id=record.id, version=record.version, actor_id=user.id,
                                  operation_id=operation_id, request_digest=request_digest, kind=payload.kind,
                                  reason=payload.reason, before=before, after=after)
    db.add(entry)
    db.flush()
    return revision_summary(entry, user.username)
