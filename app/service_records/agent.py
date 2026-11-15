import re
from uuid import UUID, uuid5

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.auth.models import new_id
from app.auth.router import check_write, current_user, database
from app.auth.service import digest, ensure_permission, identity, lock_accounts
from app.service_records.agent_schema import (ServiceTaskConfigure, ServiceTaskCreate, ServiceTaskSelect,
                                              ServiceTaskVersion)
from app.service_records.archive import (archive_receipt, contact_candidates, contact_history, contact_summary,
                                         find_record, phone_key, saved_archive, save_supplement)
from app.service_records.models import ServiceAgentTask, ServiceContact, ServiceRecord, ServiceRecordDraft
from app.service_records.router import confirm_archive, preview_archive
from app.service_records.schemas import ArchiveConfirm, ArchivePreview, DraftFields, SupplementConfirm
from app.sources.router import save_source, visible_source
from app.task_calendar import month_range


router = APIRouter(prefix='/api/service-agent/tasks')
UUID_PATTERN = re.compile(r'(?<![0-9a-fA-F])[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}(?![0-9a-fA-F])')
PHONE_PATTERN = re.compile(r'(?<![0-9])1[ -]?[3-9](?:[ -]?[0-9]){9}(?![0-9])')
INTENT_PATTERNS = {
    'supplement': re.compile('补充|补到|补记|追加|补录.+结果'),
    'new': re.compile('新报修|新建报修|又报修|再次报修|新故障|新建售后'),
    'lookup': re.compile('查|历史|上次|之前怎么处理'),
}


def read_plan(text):
    matches = [kind for kind, pattern in INTENT_PATTERNS.items() if pattern.search(text)]
    # Looking up the target is inherent to either kind of write task.
    if len(matches) > 1 and 'lookup' in matches:
        matches.remove('lookup')
    numbers = sorted({phone_key(value) for value in PHONE_PATTERN.findall(text)})
    record_ids = sorted({value.lower() for value in UUID_PATTERN.findall(text)})
    address = re.search(r'地址\s*[:：]\s*([^，,。；;\r\n]+)', text)
    body = re.search(r'(?:内容|结果|问题)\s*[:：]\s*(.+)', text, re.DOTALL)
    quoted = re.findall(r'[“「]([^”」]+)[”」]', text)
    lookup = (record_ids[0] if len(record_ids) == 1 else
              numbers[0] if len(numbers) == 1 and not record_ids and not address else
              address[1].strip() if not record_ids and not numbers and address else '')
    content = body[1].strip() if body else quoted[0].strip() if len(quoted) == 1 else ''
    return {'intent': matches[0] if len(matches) == 1 else None,
            'lookup': lookup if len(lookup) <= 500 else '',
            'content': content if len(content) <= 4000 else ''}


def task_access(db, user, task_id, *, lock=False):
    ensure_permission(db, user, 'service.read')
    query = select(ServiceAgentTask).where(ServiceAgentTask.id == str(task_id), ServiceAgentTask.actor_id == user.id)
    task = db.scalar(query.with_for_update() if lock else query)
    if task is None:
        raise HTTPException(404, 'Service task not found')
    return task


def candidates(db, user, task):
    lookup = task.plan['lookup']
    if not lookup:
        return [], [], None
    if UUID_PATTERN.fullmatch(lookup):
        record = db.get(ServiceRecord, lookup.lower())
        if record is None or record.voided:
            return [], [], None
        contact = db.get(ServiceContact, record.contact_id)
        contacts = [contact_summary(contact)]
        records = contact_history(db, user, contact.id, active_only=True, record_id=record.id)['items']
        return contacts, records, None
    contacts = contact_candidates(db, lookup)
    if not task.contact_id:
        return contacts['items'], [], contacts['next_offset']
    records = contact_history(db, user, task.contact_id, active_only=True)
    return contacts['items'], records['items'], records['next_offset']


def task_receipt(db, task):
    if task.receipt:
        return task.receipt
    if task.draft_id:
        saved = saved_archive(db, db.get(ServiceRecordDraft, task.draft_id))
        if saved:
            return archive_receipt(saved)
    return None


def task_summary(db, user, task):
    receipt = task_receipt(db, task)
    contacts, records, more = candidates(db, user, task)
    target = task.contact_id and task.record_id
    selected = contact_history(db, user, task.contact_id, record_id=task.record_id)['items'] if target else []
    record = selected[0] if selected else None
    state = 'needs_review'
    preview = task.preview
    stale = False
    if receipt or (task.plan['intent'] == 'lookup' and record):
        state = 'completed'
    elif preview:
        state = 'awaiting_confirmation' if preview['operation_id'] else 'draft_saved'
        if task.plan['intent'] == 'supplement':
            stale = not record or record['status'] != 'active' or record['version'] != preview['record_version']
        elif task.draft_id and preview['operation_id']:
            draft = db.get(ServiceRecordDraft, task.draft_id)
            stale = not draft.archive_preview or draft.archive_preview['operation_id'] != preview['operation_id']
    return {'id': task.id, 'version': task.version, 'text': task.text, **task.plan, 'state': state,
            'contact_id': task.contact_id, 'record_id': task.record_id, 'created_at': task.created_at.isoformat(),
            'contacts': contacts, 'records': records, 'more_candidates': more is not None, 'record': record,
            'preview': preview, 'preview_stale': stale, 'receipt': receipt}


def editable_task(db, user, task_id, version):
    task = task_access(db, user, task_id, lock=True)
    if task.version != version or task_receipt(db, task) or task.draft_id:
        raise HTTPException(409, 'Service task changed')
    return task


@router.post('', status_code=201, dependencies=[Depends(check_write)])
def create(payload: ServiceTaskCreate, user=Depends(current_user), db=Depends(database, scope='function')):
    ensure_permission(db, user, 'service.read')
    request_id = str(payload.request_id)
    task = db.scalar(insert(ServiceAgentTask).values(actor_id=user.id, request_id=request_id, text=payload.text,
                     plan=read_plan(payload.text)).on_conflict_do_nothing(constraint='uq_service_agent_request')
                     .returning(ServiceAgentTask))
    if task is None:
        task = db.scalar(select(ServiceAgentTask).where(ServiceAgentTask.actor_id == user.id,
                                                        ServiceAgentTask.request_id == request_id))
        if task.text != payload.text:
            raise HTTPException(409, 'Service task request already used with different content')
    return task_summary(db, user, task)


@router.get('')
def tasks(offset: int = Query(0, ge=0), month: str | None = Query(default=None, pattern=r'^\d{4}-\d{2}$'),
          pending_only: bool = False, user=Depends(current_user), db=Depends(database, scope='function')):
    ensure_permission(db, user, 'service.read')
    done = (ServiceAgentTask.receipt['id'].astext.is_not(None)
            | ((ServiceAgentTask.plan['intent'].astext == 'lookup').is_(True) & ServiceAgentTask.record_id.is_not(None))
            | select(ServiceRecord.id).where(ServiceRecord.draft_id == ServiceAgentTask.draft_id).exists())
    query = select(ServiceAgentTask, done).where(ServiceAgentTask.actor_id == user.id)
    if month:
        start, end = month_range(month)
        query = query.where(ServiceAgentTask.created_at >= start, ServiceAgentTask.created_at < end)
    if pending_only:
        query = query.where(~done)
    query = query.order_by(ServiceAgentTask.created_at.desc(), ServiceAgentTask.id).offset(offset)
    paged = not (month or pending_only)
    rows = list(db.execute(query.limit(51) if paged else query))
    return {'items': [task_list_item(task, finished) for task, finished in (rows[:50] if paged else rows)],
            'next_offset': offset + 50 if paged and len(rows) > 50 else None}


def task_list_item(task, finished):
    intent = task.plan['intent']
    if finished:
        state = 'completed'
    elif task.preview:
        state = 'awaiting_confirmation' if task.preview['operation_id'] else 'draft_saved'
    elif task.plan['lookup'] and (not task.contact_id or
                                  (intent in ('lookup', 'supplement') and not task.record_id)):
        state = 'needs_choice'
    else:
        state = 'missing'
    return {'id': task.id, 'text': task.text[:70], 'intent': intent, 'state': state,
            'created_at': task.created_at.isoformat(), 'done': finished}


@router.get('/{task_id}')
def detail(task_id: UUID, user=Depends(current_user), db=Depends(database, scope='function')):
    return task_summary(db, user, task_access(db, user, task_id))


@router.post('/{task_id}/configure', dependencies=[Depends(check_write)])
def configure(task_id: UUID, payload: ServiceTaskConfigure, user=Depends(current_user),
              db=Depends(database, scope='function')):
    task = editable_task(db, user, task_id, payload.version)
    plan = payload.model_dump(exclude={'version'})
    if plan['lookup'] != task.plan['lookup'] or plan['intent'] != task.plan['intent']:
        task.contact_id = task.record_id = None
    task.plan = plan
    task.preview = None
    task.version += 1
    return task_summary(db, user, task)


@router.post('/{task_id}/select', dependencies=[Depends(check_write)])
def select_candidate(task_id: UUID, payload: ServiceTaskSelect, user=Depends(current_user),
                     db=Depends(database, scope='function')):
    task = editable_task(db, user, task_id, payload.version)
    contacts, records, _ = candidates(db, user, task)
    if payload.contact_id and str(payload.contact_id) in {row['id'] for row in contacts}:
        task.contact_id, task.record_id = str(payload.contact_id), None
    elif (task.plan['intent'] in ('lookup', 'supplement') and task.contact_id and payload.record_id
          and str(payload.record_id) in {row['id'] for row in records}):
        task.record_id = str(payload.record_id)
    else:
        raise HTTPException(422, 'Choose a candidate from this task')
    task.preview = None
    task.version += 1
    return task_summary(db, user, task)


@router.post('/{task_id}/prepare', dependencies=[Depends(check_write)])
def prepare(task_id: UUID, payload: ServiceTaskVersion, request: Request, user=Depends(current_user),
            db=Depends(database, scope='function')):
    lock_accounts(db)
    task = editable_task(db, user, task_id, payload.version)
    ensure_permission(db, user, 'service.draft')
    intent, lookup, content = (task.plan[name] for name in ('intent', 'lookup', 'content'))
    if (intent not in ('new', 'supplement') or not content or (lookup and not task.contact_id)
            or (intent == 'supplement' and not task.record_id)):
        raise HTTPException(422, 'Complete the task details and select the target')
    source_text = task.text if read_plan(task.text)['content'] == content else content
    if len(source_text) > request.app.state.settings.source_text_max_chars:
        raise HTTPException(422, 'Task text exceeds the source size limit')
    record = find_record(db, task.record_id) if task.record_id and intent == 'supplement' else None
    if record and record.voided:
        raise HTTPException(409, 'Selected service record is voided')
    source_request = str(uuid5(UUID(task.id), source_text))
    source = save_source(db, user, source_request, {'text': source_text, 'source_label': '工作台售后任务'})
    task.source_id = source.id
    task.preview = {'content': content, 'source_id': source.id, 'operation_id': None}
    if record:
        ensure_permission(db, user, 'service.confirm')
        task.preview = task.preview | {'record_version': record.version, 'before': record.fields,
                                       'operation_id': new_id()}
    else:
        contact = db.get(ServiceContact, task.contact_id) if task.contact_id else None
        contact_fields = {'customer_name': contact.name, 'phone': contact.phone, 'address': contact.address} if contact else {}
        fields = DraftFields(problem=content, **contact_fields)
        draft = ServiceRecordDraft(source_id=source.id, request_id=task.id,
                                   request_digest=digest(fields.model_dump_json()), fields=fields.model_dump())
        db.add(draft)
        db.flush()
        task.draft_id = draft.id
        task.preview = task.preview | {'draft_id': draft.id}
        if contact and 'service.confirm' in identity(db, user)['permissions']:
            preview = preview_archive(draft.id, ArchivePreview(version=draft.version, contact_id=task.contact_id),
                                      source, user, db)
            task.preview = task.preview | {'operation_id': preview['operation_id'], 'contact': preview['contact']}
    task.version += 1
    return task_summary(db, user, task)


@router.post('/{task_id}/confirm', dependencies=[Depends(check_write)])
def confirm(task_id: UUID, payload: ArchiveConfirm, user=Depends(current_user),
            db=Depends(database, scope='function')):
    lock_accounts(db)
    task = task_access(db, user, task_id, lock=True)
    ensure_permission(db, user, 'service.confirm')
    preview = task.preview
    if not preview or preview['operation_id'] != str(payload.operation_id):
        raise HTTPException(409, 'Service task preview changed')
    if not task_receipt(db, task):
        source = visible_source(db, user, task.source_id)
        if task.draft_id:
            task.receipt = confirm_archive(task.draft_id, payload, source, user, db)
        else:
            record = find_record(db, task.record_id, for_update=True)
            decision = SupplementConfirm(operation_id=payload.operation_id, confirmed=True,
                                         version=preview['record_version'], source_id=source.id, result=preview['content'])
            task.receipt = save_supplement(db, user, record, decision) | {'record_id': record.id}
        task.version += 1
    return task_summary(db, user, task)
