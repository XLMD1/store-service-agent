from base64 import b64decode
from binascii import Error as Base64Error
from hashlib import sha256
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import ValidationError
from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import insert

from app.auth.router import check_write, current_user, database
from app.auth.service import ensure_permission, lock_accounts, now
from app.service_records.models import ServiceAgentTask, ServiceRecord, ServiceRecordDraft, ServiceRecordSupplement
from app.sources.models import Source
from app.sources.photos import FORMATS, MAX_PIXELS, image_type, persist_original, read_original
from app.sources.schemas import PhotoSourceCreate, SourceDelete, TextSourceCreate


router = APIRouter(prefix='/api/sources')
PAGE_SIZE = 50


def summary(source):
    return {
        'id': source.id, 'status': 'saved', 'actor_id': source.actor_id,
        'submitted_at': source.submitted_at.isoformat(), 'source_kind': source.source_kind,
        'source_label': source.source_label, 'page_label': source.page_label,
        'material_type': 'photo' if source.photo_type else 'text',
    }


def save_source(db, user, request_id, values):
    source = db.scalar(insert(Source).values(actor_id=user.id, request_id=request_id, **values)
                       .on_conflict_do_nothing(constraint='uq_service_source_request').returning(Source))
    if source is None:
        source = db.scalar(select(Source).where(Source.actor_id == user.id, Source.request_id == request_id))
        if source.deleted_at is not None:
            raise HTTPException(409, 'Source was deleted')
        if any(getattr(source, key) != value for key, value in values.items()):
            raise HTTPException(409, 'Source request already used with different content')
    return source


def visible_source(db, user, source_id, *, for_update=False, include_deleted=False):
    ensure_permission(db, user, 'service.read')
    query = select(Source).where(Source.id == str(source_id), Source.actor_id == user.id)
    if not include_deleted:
        query = query.where(Source.deleted_at.is_(None))
    source = db.scalar(query.with_for_update() if for_update else query)
    if source is None:
        raise HTTPException(404, 'Source not found')
    return source


def source_in_use(source_id):
    archived = (select(ServiceRecord.id).join(ServiceRecordDraft, ServiceRecord.draft_id == ServiceRecordDraft.id)
                .where(ServiceRecordDraft.source_id == source_id).exists())
    supplement = select(ServiceRecordSupplement.id).where(ServiceRecordSupplement.source_id == source_id).exists()
    task = select(ServiceAgentTask.id).where(ServiceAgentTask.source_id == source_id).exists()
    return or_(archived, supplement, task)


async def photo_payload(request: Request):
    settings = request.app.state.settings
    limit = 4 * ((settings.source_photo_max_bytes + 2) // 3) + 8192
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > limit:
            raise HTTPException(413, 'Photo exceeds configured limit')
        body.extend(chunk)
    try:
        return PhotoSourceCreate.model_validate_json(body)
    except ValidationError as error:
        raise HTTPException(422, 'Invalid photo submission') from error


@router.get('/policy')
def policy(request: Request, user=Depends(current_user), db=Depends(database, scope='function')):
    ensure_permission(db, user, 'service.draft')
    settings = request.app.state.settings
    return {'text_max_chars': settings.source_text_max_chars, 'photo_max_bytes': settings.source_photo_max_bytes,
            'photo_media_types': list(FORMATS.values()), 'photo_max_pixels': MAX_PIXELS,
            'photos_per_upload': 1, 'retention': 'manual_review'}


@router.post('', status_code=201, dependencies=[Depends(check_write)])
def save(payload: TextSourceCreate, request: Request, user=Depends(current_user),
         db=Depends(database, scope='function')):
    ensure_permission(db, user, 'service.draft')
    values = payload.model_dump(exclude={'request_id'})
    if len(payload.text) > request.app.state.settings.source_text_max_chars:
        raise HTTPException(422, 'Source text exceeds configured limit')
    return summary(save_source(db, user, str(payload.request_id), values))


def photo_submitter(user=Depends(current_user), db=Depends(database, scope='function')):
    ensure_permission(db, user, 'service.draft')
    return user


@router.post('/photos', status_code=201, dependencies=[Depends(check_write)])
def save_photo(request: Request, user=Depends(photo_submitter), payload=Depends(photo_payload),
               db=Depends(database, scope='function')):
    settings = request.app.state.settings
    try:
        data = b64decode(payload.image_base64, validate=True)
    except (Base64Error, ValueError) as error:
        raise HTTPException(422, 'Invalid photo encoding') from error
    if len(data) > settings.source_photo_max_bytes:
        raise HTTPException(413, 'Photo exceeds configured limit')
    mime = image_type(data)
    values = payload.model_dump(exclude={'request_id', 'image_base64'})
    source = save_source(db, user, str(payload.request_id), {
        **values, 'text': None, 'photo_type': mime, 'photo_size': len(data), 'photo_sha256': sha256(data).hexdigest(),
    })
    try:
        persist_original(settings, source, data)
    except OSError as error:
        raise HTTPException(503, 'Photo could not be saved') from error
    return summary(source)


@router.get('')
def list_mine(offset: int = Query(0, ge=0), user=Depends(current_user),
              db=Depends(database, scope='function')):
    ensure_permission(db, user, 'service.read')
    rows = list(db.execute(select(Source, source_in_use(Source.id)).where(
        Source.actor_id == user.id, Source.deleted_at.is_(None))
        .order_by(Source.submitted_at.desc(), Source.id.desc()).offset(offset).limit(PAGE_SIZE + 1)))
    return {'items': [{**summary(source), 'can_delete': not in_use} for source, in_use in rows[:PAGE_SIZE]],
            'next_offset': offset + PAGE_SIZE if len(rows) > PAGE_SIZE else None}


@router.delete('/{source_id}', status_code=204, dependencies=[Depends(check_write)])
def remove(source_id: UUID, payload: SourceDelete, user=Depends(current_user),
           db=Depends(database, scope='function')):
    lock_accounts(db)
    source = visible_source(db, user, source_id, for_update=True, include_deleted=True)
    ensure_permission(db, user, 'service.draft')
    if source.deleted_at is not None:
        return
    if db.scalar(select(source_in_use(source.id))):
        raise HTTPException(409, 'Source is linked to an archive, supplement, or task')
    source.deleted_at = now()


@router.get('/{source_id}')
def read(source_id: UUID, user=Depends(current_user), db=Depends(database, scope='function')):
    source = visible_source(db, user, source_id)
    return {**summary(source), 'text': source.text, 'note': source.note,
            'extracted_count': len(source.extracted_draft_ids or []),
            'message_time': source.message_time.isoformat() if source.message_time else None}


@router.get('/{source_id}/original')
def original(source_id: UUID, request: Request, user=Depends(current_user),
             db=Depends(database, scope='function')):
    source = visible_source(db, user, source_id)
    if not source.photo_type:
        raise HTTPException(404, 'Photo source not found')
    try:
        data = read_original(request.app.state.settings, source)
    except OSError as error:
        raise HTTPException(503, 'Original photo temporarily unavailable') from error
    return Response(data, media_type=source.photo_type, headers={'Content-Security-Policy': "default-src 'none'; sandbox"})
