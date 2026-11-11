from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.auth.router import check_write, current_user, database
from app.auth.service import ensure_permission
from app.sources.models import Source
from app.sources.schemas import TextSourceCreate


router = APIRouter(prefix='/api/sources')
PAGE_SIZE = 50


def summary(source):
    return {
        'id': source.id, 'status': 'saved', 'actor_id': source.actor_id,
        'submitted_at': source.submitted_at.isoformat(), 'source_kind': source.source_kind,
        'source_label': source.source_label, 'page_label': source.page_label,
    }


@router.get('/policy')
def policy(request: Request, user=Depends(current_user), db=Depends(database, scope='function')):
    ensure_permission(db, user, 'service.draft')
    return {'text_max_chars': request.app.state.settings.source_text_max_chars}


@router.post('', status_code=201, dependencies=[Depends(check_write)])
def save(payload: TextSourceCreate, request: Request, user=Depends(current_user),
         db=Depends(database, scope='function')):
    ensure_permission(db, user, 'service.draft')
    values = payload.model_dump(exclude={'request_id'})
    if len(payload.text) > request.app.state.settings.source_text_max_chars:
        raise HTTPException(422, 'Source text exceeds configured limit')
    request_id = str(payload.request_id)
    source = db.scalar(insert(Source).values(actor_id=user.id, request_id=request_id, **values)
                       .on_conflict_do_nothing(constraint='uq_service_source_request').returning(Source))
    if source is None:
        source = db.scalar(select(Source).where(Source.actor_id == user.id, Source.request_id == request_id))
        if any(getattr(source, key) != value for key, value in values.items()):
            raise HTTPException(409, 'Source request already used with different content')
    return summary(source)


@router.get('')
def list_mine(offset: int = Query(0, ge=0), user=Depends(current_user),
              db=Depends(database, scope='function')):
    ensure_permission(db, user, 'service.read')
    rows = list(db.scalars(select(Source).where(Source.actor_id == user.id)
                          .order_by(Source.submitted_at.desc(), Source.id.desc())
                          .offset(offset).limit(PAGE_SIZE + 1)))
    return {'items': [summary(source) for source in rows[:PAGE_SIZE]],
            'next_offset': offset + PAGE_SIZE if len(rows) > PAGE_SIZE else None}


@router.get('/{source_id}')
def read(source_id: UUID, user=Depends(current_user), db=Depends(database, scope='function')):
    ensure_permission(db, user, 'service.read')
    source = db.scalar(select(Source).where(Source.id == str(source_id), Source.actor_id == user.id))
    if source is None:
        raise HTTPException(404, 'Source not found')
    return {**summary(source), 'text': source.text, 'note': source.note,
            'message_time': source.message_time.isoformat() if source.message_time else None}
