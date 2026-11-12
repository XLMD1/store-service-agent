from datetime import timedelta
from uuid import uuid4

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.agent.graph import plan_task
from app.agent.models import AgentTask, AgentTaskItem
from app.agent.provider import DeepSeekPlanner, ProviderUnavailable
from app.agent.schemas import PlanStep
from app.agent.tools import catalog_context, execute, inventory_question, missing_question, permission
from app.auth.models import User
from app.auth.service import ensure_permission, now
from app.operations.models import Draft, Operation
from app.operations.service import draft_result


MAX_MODEL_ATTEMPTS = 6
UNPLANNED_QUESTION = '请补充库房、型号和希望办理的库存事项；尚未产生可确认业务。'
OUTBOUND_QUESTION = '这次是普通出库，还是客户提走已预留的货？请回复「普通出库」或「预留提货」，也可以一起补充库房、型号、数量和实际发生时间。'


def bare_outbound(text):
    return text.strip(' \t\r\n。！!？?') in ('出库', '准备出库', '要出库', '我要出库', '我想出库', '需要出库', '办理出库', '帮我出库')


def access(db, actor_id, task_id, locking=False, *, include_deleted=False):
    user = db.get(User, actor_id)
    if not user:
        raise HTTPException(401, 'Authentication required')
    ensure_permission(db, user, 'inventory.read')
    query = select(AgentTask).where(AgentTask.id == str(task_id), AgentTask.actor_id == actor_id)
    if not include_deleted:
        query = query.where(AgentTask.state != 'deleted')
    task = db.scalar(query.with_for_update() if locking else query)
    if not task:
        raise HTTPException(404, 'Task not found')
    return user, task


def items(db, task):
    return list(db.scalars(select(AgentTaskItem).where(AgentTaskItem.task_id == task.id).order_by(AgentTaskItem.position)))


def snapshot(db, user, task):
    result = []
    for item in items(db, task):
        view = {'id': item.id, 'action': item.plan['action'], 'state': item.state, 'question': item.question,
                'candidates': item.candidates, 'draft': None, 'result': item.result}
        try:
            ensure_permission(db, user, permission(item.plan['action']))
        except HTTPException:
            view.update(state='failed', question='当前账号已无此项权限，请交有权人员处理。', candidates={}, result=None)
            result.append(view)
            continue
        if item.draft_id:
            draft = db.get(Draft, item.draft_id)
            if draft.state in ('deleted', 'cancelled'):
                view.update(state='cancelled', question='该草稿已删除或取消。', candidates={}, result=None)
                result.append(view)
                continue
            view['draft'] = draft_result(db, draft)
            if view['draft']['operation_id']:
                operation = db.get(Operation, view['draft']['operation_id'])
                if operation.state == 'succeeded':
                    view.update(state='completed', result=operation.result, question='')
                else:
                    view.update(state='awaiting_confirmation', question='')
            elif view['state'] != 'failed':
                missing = None if item.candidates else draft.missing_fields
                question = item.question if draft.missing_fields == ['review_required'] and item.question else missing_question(item.plan, item.candidates, missing)
                view.update(state='missing', question=question)
        elif item.state == 'missing' and item.candidates and not item.question:
            view['question'] = missing_question(item.plan, item.candidates)
        result.append(view)
    state = task.state
    question = task.question
    if not result and not task.followups and question == UNPLANNED_QUESTION and bare_outbound(task.text):
        question = OUTBOUND_QUESTION
    if state == 'processing' and task.lease and task.lease_until <= now() and not result:
        state, question = 'awaiting_verification', '上次处理已中断，请继续核验任务；不会自动重复登记。'
    if state not in ('cancelled', 'deleted') and not (task.lease and task.lease_until > now()):
        states = {row['state'] for row in result}
        state = ('completed' if states == {'completed'} else 'awaiting_confirmation' if 'awaiting_confirmation' in states
                 else 'missing' if 'missing' in states else 'failed' if 'failed' in states
                 else 'cancelled' if 'cancelled' in states else state)
    return {'id': task.id, 'text': task.text, 'followups': task.followups, 'version': task.version, 'state': state, 'question': question,
        'can_retry': state not in ('cancelled', 'deleted') and task.planned_revision != task.plan_revision,
        'items': result, 'created_at': task.created_at.isoformat(), 'updated_at': task.updated_at.isoformat(),
        'budget': {'model_attempts': task.model_attempts, 'max_model_attempts': MAX_MODEL_ATTEMPTS,
                   'known_tokens': task.known_tokens, 'tool_calls': task.tool_calls, 'max_tool_calls': 12}}


def create_task(db, user, payload):
    ensure_permission(db, user, 'inventory.read')
    task_id = str(uuid4())
    db.execute(insert(AgentTask).values(id=task_id, actor_id=user.id, request_id=str(payload.request_id),
        text=payload.text).on_conflict_do_nothing(index_elements=['actor_id','request_id']))
    task = db.scalar(select(AgentTask).where(AgentTask.actor_id == user.id, AgentTask.request_id == str(payload.request_id)))
    if task.state == 'deleted':
        raise HTTPException(409, 'Task has been deleted')
    if task.text != payload.text:
        raise HTTPException(409, 'Request identifier is bound to another task')
    return snapshot(db, user, task)


def finish_error(sessions, actor_id, task_id, token, message):
    with sessions.begin() as db:
        user, task = access(db, actor_id, task_id, True)
        if task.lease != token:
            raise HTTPException(409, 'Task execution changed')
        task.lease = task.lease_until = None
        task.state, task.question = 'failed', message
        task.version += 1
        task.updated_at = now()
        return snapshot(db, user, task)


def locked_drafts(db, task):
    draft_ids = [row.draft_id for row in items(db, task) if row.draft_id]
    ops = db.scalars(select(Operation).where(Operation.draft_id.in_(draft_ids)).order_by(Operation.id)
                     .with_for_update().execution_options(populate_existing=True)).all()
    drafts = db.scalars(select(Draft).where(Draft.id.in_(draft_ids)).order_by(Draft.id)
                        .with_for_update().execution_options(populate_existing=True)).all()
    return ops, drafts


def run_task(app, actor_id, task_id, payload):
    sessions = app.state.sessions
    planner = getattr(app.state, 'agent_planner', None) or DeepSeekPlanner(app.state.settings.deepseek_settings_file)
    with sessions.begin() as db:
        user, task = access(db, actor_id, task_id, True)
        if task.version != payload.expected_version or task.state == 'cancelled':
            raise HTTPException(409, 'Task version changed or cancelled')
        if task.lease and task.lease_until > now():
            raise HTTPException(409, 'Task is already being processed')
        existing = items(db, task)
        if not existing and not payload.reply and not task.followups and bare_outbound(task.text):
            if task.question != OUTBOUND_QUESTION:
                task.state, task.question = 'missing', OUTBOUND_QUESTION
                task.planned_revision = task.plan_revision
                task.version += 1
                task.updated_at = now()
            return snapshot(db, user, task)
        if existing and not payload.reply and task.planned_revision == task.plan_revision:
            task.state = snapshot(db, user, task)['state']
            return snapshot(db, user, task)
        if payload.reply:
            if len(task.followups) >= MAX_MODEL_ATTEMPTS:
                raise HTTPException(409, 'Follow-up limit reached')
            ops, drafts = locked_drafts(db, task)
            if existing and all(v['state'] in ('completed', 'cancelled') for v in snapshot(db, user, task)['items']):
                raise HTTPException(409, 'Completed task requires a separate correction task')
            for operation in ops:
                if operation.state == 'pending':
                    operation.state = 'superseded'
            for draft in drafts:
                if draft.state not in ('succeeded', 'cancelled', 'deleted'):
                    draft.version += 1
                    draft.state, draft.preview, draft.missing_fields = 'missing', None, ['review_required']
            for item in existing:
                if item.state != 'completed' and (not item.draft_id or db.get(Draft, item.draft_id).state not in ('succeeded', 'cancelled', 'deleted')):
                    item.state, item.result, item.candidates, item.question = 'missing', None, {}, ''
            task.followups = task.followups+[payload.reply]
            task.plan_revision += 1
            task.version += 1
            task.updated_at = now()
        if not getattr(planner, 'available', True):
            task.state, task.question = 'failed', '尚未配置DeepSeek服务端密钥；仍可使用库存查询和人工表单。'
            task.version += 1
            return snapshot(db, user, task)
        if task.model_attempts >= MAX_MODEL_ATTEMPTS or task.tool_calls >= 12 or task.known_tokens >= 12000:
            task.state, task.question = 'failed', '本任务已达到开发调用上限，请核对已有结果并改用原表单。'
            return snapshot(db, user, task)
        token = task.lease = str(uuid4())
        task.lease_until = now()+timedelta(seconds=120)
        task.state, task.question = 'processing', ''
        task.model_attempts += 1
        task.version += 1
        text = task.text+'\n补充：'+'\n'.join(task.followups) if task.followups else task.text
        context = catalog_context(db)
        active_ids = {view['id'] for view in snapshot(db,user,task)['items']
                      if view['state'] not in ('completed', 'cancelled')}
        previous = [{**row.plan, 'id': row.id} for row in existing if row.id in active_ids]
        thread = task.id+':'+str(task.plan_revision)
    try:
        planned = plan_task(app.state.settings, thread, planner, text, context, previous)
    except (ProviderUnavailable, ValidationError):
        return finish_error(sessions, actor_id, task_id, token, 'DeepSeek暂不可用或结果未通过校验。任务已保存，可重试或改用原表单。')
    with sessions.begin() as db:
        user, task = access(db, actor_id, task_id, True)
        if task.lease != token or task.state == 'cancelled' or task.lease_until <= now():
            raise HTTPException(409, 'Task lease expired; refresh before continuing')
        existing = items(db, task)
        plans = planned['plan']['steps']
        by_id = {row.id: row for row in existing}
        if existing and (any(not p.get('id') or p['id'] not in by_id or p['action'] != by_id[p['id']].plan['action'] for p in plans)
                         or len({p['id'] for p in plans}) != len(plans)):
            task.lease = task.lease_until = None
            task.state, task.question = 'failed', '补充结果与原任务不一致，请从原表单核对；已成功项保持不变。'
            task.version += 1
            return snapshot(db,user,task)
        views = {v['id']: v for v in snapshot(db,user,task)['items']}
        for position, plan in enumerate(plans):
            item = by_id.get(plan.get('id'))
            if item and views[item.id]['state'] in ('completed', 'cancelled'):
                continue
            if item:
                merged = {**item.plan, **{k:v for k,v in plan.items() if v not in (None,'')}}
                for field in ['quantity','on_hand','opening_reserved','new_quantity','basis_kind']:
                    merged[field] = plan.get(field)
                changed = {key for key in ['warehouse', 'model', 'customer', 'reference'] if merged.get(key) != item.plan.get(key)}
                if changed & {'warehouse', 'model', 'customer'}:
                    merged['reference'] = ''
                item.selections = {k:v for k,v in item.selections.items() if k not in changed
                                   and not (k == 'reference' and changed)}
                item.plan = merged
            else:
                item = AgentTaskItem(task_id=task.id, position=position, plan=plan, selections={})
                db.add(item)
                db.flush()
            if task.tool_calls >= 12:
                item.state, item.question = 'failed', '已达到工具调用上限，请改用原表单。'
                continue
            task.tool_calls += 1
            execute_item(db, user, item)
        usage = planned.get('usage', {}).get('total_tokens', 0)
        task.known_tokens += usage if isinstance(usage,int) and 0 <= usage <= 100000 else 0
        task.lease = task.lease_until = None
        task.question = UNPLANNED_QUESTION if not plans else ''
        task.planned_revision = task.plan_revision
        task.state = 'missing' if not plans else snapshot(db,user,task)['state']
        task.version += 1
        task.updated_at = now()
        db.flush()
        task.state = snapshot(db,user,task)['state']
        return snapshot(db,user,task)


def execute_item(db, user, item):
    try:
        with db.begin_nested():
            execute(db, user, item)
    except HTTPException as error:
        item.state = 'failed'
        item.question = '当前账号没有此项权限。' if error.status_code == 403 else inventory_question(error.detail)


def select_candidate(db, user, task, payload):
    if task.version != payload.expected_version or task.state == 'cancelled' or task.lease and task.lease_until > now():
        raise HTTPException(409, 'Task changed or is processing')
    item = db.scalar(select(AgentTaskItem).where(AgentTaskItem.task_id==task.id, AgentTaskItem.id==str(payload.item_id)))
    if not item or str(payload.value) not in {row['id'] for row in item.candidates.get(payload.field,[])}:
        raise HTTPException(422, 'Choose a current candidate')
    if task.tool_calls >= 12:
        raise HTTPException(409, 'Tool budget reached')
    selected = dict(item.selections)
    if payload.field in ['warehouse', 'model', 'customer']:
        selected.pop('reference', None)
    item.selections = {**selected, payload.field: str(payload.value)}
    execute_item(db, user, item)
    task.tool_calls += 1
    task.version += 1
    task.updated_at = now()
    return snapshot(db,user,task)


def stop_task(db, task, expected_version, *, delete=False):
    if task.state == 'deleted':
        return
    if task.version != expected_version:
        raise HTTPException(409, 'Task version changed')
    ops, drafts = locked_drafts(db, task)
    for operation in ops:
        if operation.state == 'pending':
            operation.state = 'superseded'
    for draft in drafts:
        if draft.state not in ('succeeded', 'deleted'):
            draft.state = 'deleted' if delete else 'cancelled'
    task.state = 'deleted' if delete else 'cancelled'
    task.question = '已停止未提交部分。已登记的事项可查原回执。'
    task.updated_at = now()
    task.lease = task.lease_until = None
    task.version += 1

def cancel_task(db, user, task, payload):
    stop_task(db, task, payload.expected_version)
    return snapshot(db,user,task)
