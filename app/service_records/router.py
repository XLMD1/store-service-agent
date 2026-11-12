from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.auth.router import check_write, current_user, database
from app.auth.service import digest, ensure_permission
from app.service_records.models import ServiceRecordDraft
from app.service_records.schemas import DraftCreate, DraftUpdate
from app.sources.router import visible_source


router = APIRouter(prefix='/api/sources/{source_id}/drafts')
PAGE_SIZE = 50


def draft_source(source_id: UUID, user=Depends(current_user), db=Depends(database, scope='function')):
    return visible_source(db, user, source_id)


def writable_source(source=Depends(draft_source), user=Depends(current_user),
                    db=Depends(database, scope='function')):
    ensure_permission(db, user, 'service.draft')
    return source


def summary(draft):
    return {
        'id': draft.id, 'source_id': draft.source_id, 'version': draft.version,
        'state': 'needs_review', 'fields': draft.fields, 'created_at': draft.created_at.isoformat(),
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
    return summary(draft)


@router.get('')
def list_drafts(offset: int = Query(0, ge=0), source=Depends(draft_source),
                db=Depends(database, scope='function')):
    rows = list(db.scalars(select(ServiceRecordDraft).where(ServiceRecordDraft.source_id == source.id)
                          .order_by(ServiceRecordDraft.created_at, ServiceRecordDraft.id)
                          .offset(offset).limit(PAGE_SIZE + 1)))
    return {'items': [summary(draft) for draft in rows[:PAGE_SIZE]],
            'next_offset': offset + PAGE_SIZE if len(rows) > PAGE_SIZE else None}


@router.get('/{draft_id}')
def read_draft(draft_id: UUID, source=Depends(draft_source), db=Depends(database, scope='function')):
    return summary(find_draft(db, source, draft_id))


@router.put('/{draft_id}', dependencies=[Depends(check_write)])
def update_draft(draft_id: UUID, payload: DraftUpdate, source=Depends(writable_source),
                 db=Depends(database, scope='function')):
    draft = find_draft(db, source, draft_id, for_update=True)
    if draft.version != payload.version:
        raise HTTPException(409, 'Service draft changed, reload before editing')
    draft.fields = payload.fields.model_dump()
    draft.version += 1
    return summary(draft)
