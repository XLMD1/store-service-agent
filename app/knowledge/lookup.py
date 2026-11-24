import re
from unicodedata import normalize
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select

from app.auth.router import check_write, current_user, database
from app.auth.service import ensure_permission, lock_accounts
from app.knowledge.models import KnowledgePageIndex, KnowledgeScan, KnowledgeVersion
from app.knowledge.schemas import KnowledgeSearch, PageIndexInput


router = APIRouter(prefix='/api/knowledge')
MAX_RESULTS = 50
CODE = re.compile(r'[a-z]+[0-9][a-z0-9]*')


def normalized(value):
    return normalize('NFKC', value).casefold()


def index_fields(entry):
    if entry is None:
        return {'title': '', 'keywords': '', 'revision': 0}
    return {'title': entry.title, 'keywords': entry.keywords, 'revision': entry.revision}


def published_version(db, version_id):
    version = db.get(KnowledgeVersion, str(version_id))
    if version is None:
        raise HTTPException(404, 'Manual version not found')
    if version.state != 'published':
        raise HTTPException(409, 'Only published pages can be indexed')
    return version.id


def published_page(db, version_id, number):
    version_id = published_version(db, version_id)
    scan = db.scalar(select(KnowledgeScan.position).where(
        KnowledgeScan.version_id == version_id, KnowledgeScan.first_page <= number, KnowledgeScan.last_page >= number,
    ))
    if scan is None:
        raise HTTPException(404, 'Manual page not found')
    return version_id


@router.get('/versions/{version_id}/pages/{number}/index')
def read_index(version_id: UUID, number: int, user=Depends(current_user), db=Depends(database, scope='function')):
    ensure_permission(db, user, 'knowledge.review')
    version_id = published_page(db, version_id, number)
    return index_fields(db.get(KnowledgePageIndex, (version_id, number)))


@router.put('/versions/{version_id}/pages/{number}/index', dependencies=[Depends(check_write)])
def write_index(version_id: UUID, number: int, payload: PageIndexInput,
                user=Depends(current_user), db=Depends(database, scope='function')):
    lock_accounts(db)
    ensure_permission(db, user, 'knowledge.review')
    version_id = published_page(db, version_id, number)
    return save_page_index(db, user, version_id, number, payload)


def save_page_index(db, user, version_id, number, payload, source_excerpt=None):
    entry = db.get(KnowledgePageIndex, (version_id, number))
    if source_excerpt is None:
        source_excerpt = entry.source_excerpt if entry else ''
    if entry and (entry.title, entry.keywords, entry.source_excerpt) == (payload.title, payload.keywords, source_excerpt):
        return index_fields(entry)
    if payload.revision != (entry.revision if entry else 0):
        raise HTTPException(409, 'Page index changed')
    if entry is None:
        entry = KnowledgePageIndex(version_id=version_id, page=number)
        db.add(entry)
    entry.title = payload.title
    entry.keywords = payload.keywords
    entry.source_excerpt = source_excerpt
    entry.search_text = normalized('\n'.join((payload.title, payload.keywords, source_excerpt)))
    entry.updated_by = user.id
    entry.revision = payload.revision + 1
    return index_fields(entry)


@router.get('/search/models')
def search_models(user=Depends(current_user), db=Depends(database, scope='function')):
    ensure_permission(db, user, 'knowledge.search')
    model = func.jsonb_array_elements_text(KnowledgeVersion.models).label('model')
    rows = db.scalars(select(model).where(KnowledgeVersion.state == 'published').distinct().order_by(model))
    return {'models': list(rows)}


@router.post('/search', dependencies=[Depends(check_write)])
def search_pages(payload: KnowledgeSearch, user=Depends(current_user), db=Depends(database, scope='function')):
    ensure_permission(db, user, 'knowledge.search')
    terms = [term for term in re.split(r'[\s,、;]+', normalized(payload.query)) if term]
    if not terms:
        raise HTTPException(422, 'At least one search term is required')
    active = applicable_version(payload.model)
    entries = page_indexes(payload.model)
    rows = list(db.execute(entries.where(*term_conditions(terms)).order_by(
        KnowledgeVersion.title, KnowledgeVersion.id, KnowledgePageIndex.page,
    ).limit(MAX_RESULTS + 1)))
    if not rows:
        if not db.scalar(select(KnowledgeVersion.id).where(*active).limit(1)):
            status = 'unsupported_model'
        elif not db.scalar(entries.with_only_columns(KnowledgePageIndex.page).limit(1)):
            status = 'no_index'
        else:
            status = 'no_match'
        return {'status': status, 'items': [], 'has_more': False}
    return {'status': 'matched', 'has_more': len(rows) > MAX_RESULTS,
            'items': [page_reference(entry, version) for entry, version in rows[:MAX_RESULTS]]}


def applicable_version(model):
    return KnowledgeVersion.state == 'published', KnowledgeVersion.models.contains([model])


def page_indexes(model):
    return select(KnowledgePageIndex, KnowledgeVersion).join(KnowledgeVersion).where(*applicable_version(model))


def term_conditions(terms):
    conditions = []
    for term in terms:
        if CODE.fullmatch(term):
            # Codes stop at ASCII letters/digits, including when the next character is Chinese.
            conditions.append(KnowledgePageIndex.search_text.op('~')(f'(^|[^a-z0-9]){term}([^a-z0-9]|$)'))
        else:
            conditions.append(KnowledgePageIndex.search_text.contains(term, autoescape=True))
    return conditions


def page_reference(entry, version):
    return {
        'version_id': version.id,
        'title': version.title,
        'document_code': version.document_code,
        'edition': version.edition,
        'page': entry.page,
        'page_title': entry.title,
        'keywords': entry.keywords,
        'source_excerpt': entry.source_excerpt,
        'original_url': f'/api/knowledge/versions/{version.id}/pages/{entry.page}',
    }
