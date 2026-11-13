from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.auth.router import check_write, current_user, database
from app.auth.models import new_id
from app.auth.service import digest, ensure_permission, lock_accounts
from app.service_records.archive import archive_receipt, contact_summary, find_contact, saved_archive, verified_contact_fields
from app.service_records.models import ServiceContact, ServiceRecord, ServiceRecordDraft
from app.service_records.schemas import ArchiveConfirm, ArchivePreview, DraftCreate, DraftUpdate
from app.sources.router import visible_source


router = APIRouter(prefix='/api/sources/{source_id}/drafts')
PAGE_SIZE = 50


def draft_source(source_id: UUID, user=Depends(current_user), db=Depends(database, scope='function')):
    return visible_source(db, user, source_id)


def writable_source(source=Depends(draft_source), user=Depends(current_user),
                    db=Depends(database, scope='function')):
    ensure_permission(db, user, 'service.draft')
    return source


def summary(draft, record=None):
    return {
        'id': draft.id, 'source_id': draft.source_id, 'version': draft.version,
        'state': 'archived' if record else 'needs_review',
        'fields': draft.fields, 'created_at': draft.created_at.isoformat(),
        'archive': archive_receipt(record) if record else None,
    }


def find_draft(db, source, draft_id, *, for_update=False):
    query = select(ServiceRecordDraft).where(ServiceRecordDraft.source_id == source.id,
                                             ServiceRecordDraft.id == str(draft_id))
    draft = db.scalar(query.with_for_update() if for_update else query)
    if draft is None:
        raise HTTPException(404, 'Service draft not found')
    return draft


@router.post('', status_code=201, dependencies=[Depends(check_write)])
def create_draft(payload: DraftCreate, source=Depends(writable_source), db=Depends(database, scope='function')):
    request_id = str(payload.request_id)
    request_digest = digest(payload.fields.model_dump_json())
    draft = db.scalar(insert(ServiceRecordDraft).values(
        source_id=source.id, request_id=request_id, request_digest=request_digest,
        fields=payload.fields.model_dump(),
    ).on_conflict_do_nothing(constraint='uq_service_draft_request').returning(ServiceRecordDraft))
    if draft is None:
        draft = db.scalar(select(ServiceRecordDraft).where(ServiceRecordDraft.source_id == source.id,
                                                           ServiceRecordDraft.request_id == request_id))
        if draft.request_digest != request_digest:
            raise HTTPException(409, 'Draft request already used with different content')
    return summary(draft, saved_archive(db, draft))


@router.get('')
def list_drafts(offset: int = Query(0, ge=0), source=Depends(draft_source),
                db=Depends(database, scope='function')):
    rows = list(db.execute(select(ServiceRecordDraft, ServiceRecord)
                           .outerjoin(ServiceRecord, ServiceRecord.draft_id == ServiceRecordDraft.id)
                           .where(ServiceRecordDraft.source_id == source.id)
                           .order_by(ServiceRecordDraft.created_at, ServiceRecordDraft.id)
                           .offset(offset).limit(PAGE_SIZE + 1)))
    return {'items': [summary(draft, record) for draft, record in rows[:PAGE_SIZE]],
            'next_offset': offset + PAGE_SIZE if len(rows) > PAGE_SIZE else None}


@router.get('/{draft_id}')
def read_draft(draft_id: UUID, source=Depends(draft_source), db=Depends(database, scope='function')):
    draft = find_draft(db, source, draft_id)
    return summary(draft, saved_archive(db, draft))


@router.put('/{draft_id}', dependencies=[Depends(check_write)])
def update_draft(draft_id: UUID, payload: DraftUpdate, source=Depends(writable_source),
                 db=Depends(database, scope='function')):
    draft = find_draft(db, source, draft_id, for_update=True)
    if draft.version != payload.version or saved_archive(db, draft):
        raise HTTPException(409, 'Service draft changed, reload before editing')
    draft.fields = payload.fields.model_dump()
    draft.version += 1
    draft.archive_preview = None
    return summary(draft)


def archive_access(source=Depends(draft_source), user=Depends(current_user),
                   db=Depends(database, scope='function')):
    lock_accounts(db)
    ensure_permission(db, user, 'service.confirm')
    return source


@router.post('/{draft_id}/archive-preview', dependencies=[Depends(check_write)])
def preview_archive(draft_id: UUID, payload: ArchivePreview, source=Depends(archive_access),
                    user=Depends(current_user), db=Depends(database, scope='function')):
    draft = find_draft(db, source, draft_id, for_update=True)
    if draft.version != payload.version or saved_archive(db, draft):
        raise HTTPException(409, 'Service draft changed, reload before archiving')
    identity = verified_contact_fields(draft.fields)
    contact_id = str(payload.contact_id) if payload.contact_id else None
    contact = find_contact(db, contact_id) if contact_id else ServiceContact(**identity)
    previous = draft.archive_preview
    binding = {'version': draft.version, 'actor_id': user.id, 'contact_id': contact_id}
    if previous and all(previous[key] == value for key, value in binding.items()):
        operation_id = previous['operation_id']
    else:
        operation_id = new_id()
        draft.archive_preview = {**binding, 'operation_id': operation_id}
    return {'operation_id': operation_id, 'version': draft.version, 'source_id': source.id,
            'fields': draft.fields, 'contact': contact_summary(contact)}


@router.post('/{draft_id}/archive-confirm', dependencies=[Depends(check_write)])
def confirm_archive(draft_id: UUID, payload: ArchiveConfirm, source=Depends(archive_access),
                    user=Depends(current_user), db=Depends(database, scope='function')):
    draft = find_draft(db, source, draft_id, for_update=True)
    operation_id = str(payload.operation_id)
    existing = saved_archive(db, draft)
    if existing and existing.operation_id == operation_id and existing.archived_by == user.id:
        return archive_receipt(existing)
    preview = draft.archive_preview
    if (existing or not preview or preview['version'] != draft.version
            or preview['operation_id'] != operation_id or preview['actor_id'] != user.id):
        raise HTTPException(409, 'Archive preview changed, review it again')
    identity = verified_contact_fields(draft.fields)
    if preview['contact_id']:
        contact = find_contact(db, preview['contact_id'])
    else:
        contact = ServiceContact(**identity)
        db.add(contact)
        db.flush()
    record = ServiceRecord(draft_id=draft.id, contact_id=contact.id, operation_id=operation_id,
                           archived_by=user.id, fields=draft.fields)
    db.add(record)
    draft.archive_preview = None
    db.flush()
    return archive_receipt(record)
