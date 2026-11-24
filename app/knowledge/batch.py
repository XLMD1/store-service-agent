import re
from unicodedata import normalize
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select

from app.auth.router import check_write, current_user, database
from app.auth.service import ensure_permission, lock_accounts
from app.knowledge.lookup import index_fields, published_version, save_page_index
from app.knowledge.models import KnowledgeIndexDraft, KnowledgePageIndex, KnowledgeScan
from app.knowledge.scans import render_page
from app.knowledge.schemas import ConfirmIndexes, INDEX_REVIEW_PAGES, RecognizePages
from app.service_records.ocr import recognize_photo


router = APIRouter(prefix='/api/knowledge/versions/{version_id}/index-drafts')
OCR_SPACING = re.compile(r'(?<=[\u3400-\u9fff、，。；：？！])\s+(?=[\u3400-\u9fff、，。；：？！])')
OCR_CODE = re.compile(r'^([A-Za-z]{1,3})\s*([0-9]{1,4}[A-Za-z]?)(?=[:：\s\u3400-\u9fff]|$)')
PAGE_HEADERS = {'使用说明书', '安装说明书', '维修说明书', '产品说明书'}


def read_candidate(raw):
    lines = [OCR_SPACING.sub('', normalize('NFKC', line)).strip() for line in raw.splitlines()]
    lines = [line for line in lines if line and line not in PAGE_HEADERS and not line.isdigit()]
    if not lines:
        return {'status': 'failed', 'title': '', 'keywords': '', 'source_excerpt': ''}
    title = next((line for line in lines if re.search(r'[\u3400-\u9fff]{2}', line) and len(line) <= 80), '')
    codes = {}
    for i, line in enumerate(lines):
        match = OCR_CODE.match(line)
        if match:
            code = ''.join(match.groups()).upper()
            codes[code] = None
            lines[i] = code + line[match.end():]
    terms = [line for line in lines if len(line) >= 4 and line != title][:6]
    keywords = ' '.join(codes) if codes else '\n'.join(terms)
    excerpt = '\n'.join(lines)
    needs_review = not title or not keywords or len(excerpt) < 20 or sum(len(line) == 1 for line in lines) >= 3
    return {'status': 'needs_review' if needs_review else 'ready', 'title': title,
            'keywords': keywords[:2000], 'source_excerpt': excerpt[:8000]}


def scans_in_range(db, version_id, first, last):
    if not 1 <= last - first + 1 <= INDEX_REVIEW_PAGES:
        raise HTTPException(422, 'Select a valid page range')
    scans = db.scalars(select(KnowledgeScan).where(
        KnowledgeScan.version_id == version_id, KnowledgeScan.first_page <= last, KnowledgeScan.last_page >= first,
    ).order_by(KnowledgeScan.first_page)).all()
    if not scans or first < scans[0].first_page or last > scans[-1].last_page:
        raise HTTPException(404, 'Manual page not found')
    return scans


def drafts_in_range(db, version_id, first, last):
    return select(KnowledgeIndexDraft).where(KnowledgeIndexDraft.version_id == version_id,
                                            KnowledgeIndexDraft.page.between(first, last))


def draft_list(db, version_id, first, last):
    rows = db.execute(drafts_in_range(db, version_id, first, last).add_columns(KnowledgePageIndex).outerjoin(
        KnowledgePageIndex, (KnowledgePageIndex.version_id == KnowledgeIndexDraft.version_id) &
        (KnowledgePageIndex.page == KnowledgeIndexDraft.page),
    ).order_by(KnowledgeIndexDraft.page))
    return {'items': [{
        'page': draft.page, 'status': draft.status, 'title': draft.title, 'keywords': draft.keywords,
        'source_excerpt': draft.source_excerpt, 'revision': entry.revision if entry else 0,
        'current': {**index_fields(entry), 'source_excerpt': entry.source_excerpt} if entry else None,
        'original_url': f'/api/knowledge/versions/{version_id}/pages/{draft.page}',
    } for draft, entry in rows]}


@router.get('')
def list_drafts(version_id: UUID, first_page: int = Query(ge=1, le=9999), last_page: int = Query(ge=1, le=9999),
                user=Depends(current_user), db=Depends(database, scope='function')):
    ensure_permission(db, user, 'knowledge.review')
    version_id = published_version(db, version_id)
    scans_in_range(db, version_id, first_page, last_page)
    return draft_list(db, version_id, first_page, last_page)


@router.post('/recognize')
def recognize_batch(version_id: UUID, payload: RecognizePages, request: Request):
    state = request.app.state
    first, last = payload.first_page, payload.last_page
    with state.sessions.begin() as db:
        check_write(request, db)
        ensure_permission(db, current_user(request, db), 'knowledge.review')
        version_id = published_version(db, version_id)
        scans = scans_in_range(db, version_id, first, last)
        existing = {row.page for row in db.scalars(drafts_in_range(db, version_id, first, last))
                    if row.status == 'ready' or (row.status == 'needs_review' and not payload.retry)}
        pending = [page for page in range(first, last + 1) if page not in existing]
        if not pending:
            return draft_list(db, version_id, first, last)
        sources = {page: next(scan for scan in scans if scan.first_page <= page <= scan.last_page) for page in pending}
        for scan in set(sources.values()):
            # Load the deferred scan bytes before releasing the database transaction for OCR.
            _ = scan.data
            db.expunge(scan)

    recognized = {}
    recognize = getattr(state, 'knowledge_ocr', recognize_photo)
    for page, scan in sources.items():
        try:
            candidate = read_candidate(recognize(render_page(scan, page)))
        except OSError:
            candidate = read_candidate('')
        recognized[page] = candidate

    with state.sessions.begin() as db:
        lock_accounts(db)
        check_write(request, db)
        ensure_permission(db, current_user(request, db), 'knowledge.review')
        published_version(db, version_id)
        for page, candidate in recognized.items():
            draft = db.get(KnowledgeIndexDraft, (version_id, page))
            if draft is None:
                db.add(KnowledgeIndexDraft(version_id=version_id, page=page, **candidate))
            elif draft.status == 'failed' or (payload.retry and draft.status == 'needs_review'
                                               and candidate['status'] != 'failed'):
                for field, value in candidate.items():
                    setattr(draft, field, value)
        db.flush()
        return draft_list(db, version_id, first, last)


@router.post('/confirm', dependencies=[Depends(check_write)])
def confirm_batch(version_id: UUID, payload: ConfirmIndexes, user=Depends(current_user),
                  db=Depends(database, scope='function')):
    lock_accounts(db)
    ensure_permission(db, user, 'knowledge.review')
    version_id = published_version(db, version_id)
    saved = []
    for item in payload.entries:
        draft = db.get(KnowledgeIndexDraft, (version_id, item.page))
        if draft is None or draft.status == 'failed':
            raise HTTPException(409, 'An OCR draft is unavailable for this page')
        result = save_page_index(db, user, version_id, item.page, item, item.source_excerpt)
        saved.append({'page': item.page, **result, 'source_excerpt': item.source_excerpt})
    return {'items': saved}
