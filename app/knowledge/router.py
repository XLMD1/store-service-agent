from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import ValidationError
from sqlalchemy import select

from app.auth.models import User
from app.auth.router import check_write, current_user, database
from app.auth.service import digest, ensure_permission, identity, lock_accounts
from app.knowledge.models import KnowledgeEvent, KnowledgeScan, KnowledgeVersion
from app.knowledge.scans import IMPORT_BODY_LIMIT, decode_bundle, render_page
from app.knowledge.schemas import ManualImport, Transition


router = APIRouter(prefix='/api/knowledge/versions')
PAGE_SIZE = 50
MANAGE = {'knowledge.review', 'knowledge.publish'}
TRANSITIONS = {
    'review': ('knowledge.review', 'pending_review', 'reviewed'),
    'publish': ('knowledge.publish', 'reviewed', 'published'),
    'retire': ('knowledge.publish', 'published', 'retired'),
}


def may_manage(db, user):
    db.refresh(user)
    return user.enabled and bool(MANAGE.intersection(identity(db, user)['permissions']))


def importer(user=Depends(current_user), db=Depends(database, scope='function')):
    if not may_manage(db, user):
        raise HTTPException(403, 'Permission denied')
    return user


async def scanned_manual(request: Request, user=Depends(importer)):
    raw = bytearray()
    async for chunk in request.stream():
        if len(raw) + len(chunk) > IMPORT_BODY_LIMIT:
            raise HTTPException(413, 'Manual scans exceed the upload limit')
        raw.extend(chunk)
    try:
        return ManualImport.model_validate_json(raw)
    except ValidationError:
        raise HTTPException(422, 'Invalid manual import') from None


def summary(row):
    return {key: getattr(row, key) for key in ('id', 'title', 'document_code', 'edition', 'models', 'state', 'version')}


def visible_version(db, user, version_id):
    ensure_permission(db, user, 'knowledge.read')
    row = db.get(KnowledgeVersion, str(version_id))
    if row is None or (row.state not in {'published', 'retired'} and not may_manage(db, user)):
        raise HTTPException(404, 'Manual version not found')
    return row


@router.get('')
def list_versions(offset: int = Query(0, ge=0), user=Depends(current_user), db=Depends(database, scope='function')):
    ensure_permission(db, user, 'knowledge.read')
    query = select(KnowledgeVersion)
    if not may_manage(db, user):
        query = query.where(KnowledgeVersion.state == 'published')
    rows = list(db.scalars(query.order_by(KnowledgeVersion.created_at.desc(), KnowledgeVersion.id)
                           .offset(offset).limit(PAGE_SIZE + 1)))
    return {'items': [summary(row) for row in rows[:PAGE_SIZE]],
            'next_offset': offset + PAGE_SIZE if len(rows) > PAGE_SIZE else None}


@router.post('', status_code=201, dependencies=[Depends(check_write)])
def import_version(payload=Depends(scanned_manual), user=Depends(importer), db=Depends(database, scope='function')):
    scans = decode_bundle(payload.scans)
    request_id = str(payload.request_id)
    request_hash = digest(payload.model_dump_json())
    lock_accounts(db)
    if not may_manage(db, user):
        raise HTTPException(403, 'Permission denied')
    existing = db.scalar(select(KnowledgeVersion).where(KnowledgeVersion.created_by == user.id,
                                                        KnowledgeVersion.request_id == request_id))
    if existing:
        if existing.request_digest != request_hash:
            raise HTTPException(409, 'Import request already used with different content')
        return summary(existing)
    values = payload.model_dump(exclude={'scans', 'request_id', 'confirmed'})
    if db.scalar(select(KnowledgeVersion.id).where(KnowledgeVersion.document_code == values['document_code'],
                                                   KnowledgeVersion.edition == values['edition'])):
        raise HTTPException(409, 'This manual edition already exists')
    row = KnowledgeVersion(created_by=user.id, request_id=request_id, request_digest=request_hash, **values)
    db.add(row)
    db.flush()
    db.add_all(KnowledgeScan(version_id=row.id, position=index, **scan) for index, scan in enumerate(scans, 1))
    return summary(row)


@router.get('/{version_id}')
def read_version(version_id: UUID, user=Depends(current_user), db=Depends(database, scope='function')):
    row = visible_version(db, user, version_id)
    scans = db.scalars(select(KnowledgeScan).where(KnowledgeScan.version_id == row.id).order_by(KnowledgeScan.position))
    events = db.execute(select(KnowledgeEvent, User.username).join(User, User.id == KnowledgeEvent.actor_id)
                        .where(KnowledgeEvent.version_id == row.id).order_by(KnowledgeEvent.version))
    return {
        **summary(row),
        'scans': [{key: getattr(scan, key) for key in
                   ('position', 'first_page', 'last_page', 'leading_pages', 'trailing_pages')} for scan in scans],
        'events': [{'action': event.action, 'actor': actor, 'note': event.note, 'created_at': event.created_at}
                   for event, actor in events],
    }


@router.get('/{version_id}/scans/{position}')
def original(version_id: UUID, position: int, user=Depends(current_user), db=Depends(database, scope='function')):
    row = visible_version(db, user, version_id)
    scan = db.get(KnowledgeScan, (row.id, position))
    if scan is None:
        raise HTTPException(404, 'Scan not found')
    return Response(scan.data, media_type=scan.mime_type, headers={'Content-Security-Policy': "default-src 'none'; sandbox"})


@router.get('/{version_id}/pages/{number}')
def page(version_id: UUID, number: int, user=Depends(current_user), db=Depends(database, scope='function')):
    row = visible_version(db, user, version_id)
    scan = db.scalar(select(KnowledgeScan).where(KnowledgeScan.version_id == row.id, KnowledgeScan.first_page <= number,
                                                KnowledgeScan.last_page >= number))
    if scan is None:
        raise HTTPException(404, 'Manual page not found')
    try:
        data = render_page(scan, number)
    except OSError:
        raise HTTPException(503, 'Manual page is temporarily unavailable') from None
    return Response(data, media_type='image/png', headers={'Content-Security-Policy': "default-src 'none'; sandbox"})


@router.post('/{version_id}/transition', dependencies=[Depends(check_write)])
def change_version(version_id: UUID, payload: Transition, user=Depends(current_user), db=Depends(database, scope='function')):
    permission, expected, target = TRANSITIONS[payload.action]
    lock_accounts(db)
    ensure_permission(db, user, permission)
    row = visible_version(db, user, version_id)
    operation_id = str(payload.operation_id)
    request_hash = digest(payload.model_dump_json())
    existing = db.scalar(select(KnowledgeEvent).where(KnowledgeEvent.actor_id == user.id,
                                                      KnowledgeEvent.operation_id == operation_id))
    if existing:
        if existing.version_id != row.id or existing.request_digest != request_hash:
            raise HTTPException(409, 'Manual transition request already used with different content')
        return {'state': existing.state, 'version': existing.version}
    if row.version != payload.version or row.state != expected:
        raise HTTPException(409, 'Manual state or version changed')
    if target == 'published' and db.scalar(select(KnowledgeVersion.id).where(
            KnowledgeVersion.document_code == row.document_code, KnowledgeVersion.state == 'published')):
        raise HTTPException(409, 'Retire the current published edition first')
    row.state = target
    row.version += 1
    db.add(KnowledgeEvent(version_id=row.id, actor_id=user.id, operation_id=operation_id, request_digest=request_hash,
                          state=row.state, version=row.version, note=payload.note, action=payload.action))
    return {'state': row.state, 'version': row.version}
