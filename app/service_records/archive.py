import re
from datetime import UTC
from unicodedata import normalize
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select

from app.auth.router import check_write, current_user, database
from app.auth.service import ensure_permission
from app.service_records.models import ServiceContact, ServiceRecord, ServiceRecordDraft
from app.service_records.schemas import ArchiveSearch
from app.sources.models import Source


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
    address = address_key(payload.q)
    if address is None or '\x00' in address:
        raise HTTPException(422, 'Enter a phone number or an address')
    phone = phone_key(payload.q)
    match = ServiceContact.phone_key == phone if phone else ServiceContact.address_key.contains(address, autoescape=True)
    rows = list(db.scalars(select(ServiceContact).where(match)
                           .order_by(ServiceContact.id).offset(payload.offset).limit(PAGE_SIZE + 1)))
    return {'items': [contact_summary(row) for row in rows[:PAGE_SIZE]],
            'next_offset': payload.offset + PAGE_SIZE if len(rows) > PAGE_SIZE else None}


@router.get('/contacts/{contact_id}')
def history(contact_id: UUID, offset: int = Query(0, ge=0), user=Depends(current_user),
            db=Depends(database, scope='function')):
    ensure_permission(db, user, 'service.read')
    contact = find_contact(db, contact_id)
    rows = list(db.execute(select(ServiceRecord, Source.id, Source.actor_id)
                           .join(ServiceRecordDraft, ServiceRecord.draft_id == ServiceRecordDraft.id)
                           .join(Source, ServiceRecordDraft.source_id == Source.id)
                           .where(ServiceRecord.contact_id == contact.id)
                           .order_by(ServiceRecord.fields['repair_date'].astext.desc().nulls_last(),
                                     ServiceRecord.archived_at.desc(), ServiceRecord.id)
                           .offset(offset).limit(PAGE_SIZE + 1)))
    return {'contact': contact_summary(contact),
            'items': [{'id': record.id, 'fields': record.fields, 'archived_at': record.archived_at.isoformat(),
                       'source_id': source_id if actor_id == user.id else None}
                      for record, source_id, actor_id in rows[:PAGE_SIZE]],
            'next_offset': offset + PAGE_SIZE if len(rows) > PAGE_SIZE else None}
