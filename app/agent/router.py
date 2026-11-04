from uuid import UUID
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Request, HTTPException, Query
from sqlalchemy import select

from app.agent.models import AgentTask
from app.agent.provider import DeepSeekPlanner
from app.agent.schemas import Selection, TaskCreate, TaskRun, ProviderSettings
from app.agent.settings import configuration, save_key
from app.agent.service import access, cancel_task, create_task, run_task, select_candidate, snapshot
from app.auth.router import check_write, current_user, database
from app.auth.service import ensure_permission


router = APIRouter(prefix='/api/agent')


def short_actor(request: Request):
    # End authentication's read transaction before model/network calls.
    with request.app.state.sessions.begin() as db:
        check_write(request, db=db)
        return current_user(request, db=db).id


@router.get('/status')
def status(request: Request, user=Depends(current_user)):
    planner = getattr(request.app.state, 'agent_planner', None) or DeepSeekPlanner(request.app.state.settings.deepseek_settings_file)
    return {'provider': 'DeepSeek', 'model': getattr(planner,'model','测试替身'),
            'configured': getattr(planner,'available',True),
            'test_double': not isinstance(planner,DeepSeekPlanner)}


@router.get('/settings')
def provider_settings(request: Request, user=Depends(current_user), db=Depends(database,scope='function')):
    ensure_permission(db,user,'account.manage')
    return {**configuration(request.app.state.settings.deepseek_settings_file), 'model':DeepSeekPlanner().model}


def write_settings(request, user, db, key):
    ensure_permission(db,user,'account.manage')
    try:
        save_key(request.app.state.settings.deepseek_settings_file,key)
    except (OSError, ValueError):
        raise HTTPException(503,'本机设置保存失败，请检查服务用户的本机配置权限。') from None
    return provider_settings(request,user,db)


@router.post('/settings', dependencies=[Depends(check_write)])
def update_provider_settings(payload: ProviderSettings, request: Request, user=Depends(current_user), db=Depends(database,scope='function')):
    return write_settings(request,user,db,payload.api_key.get_secret_value())


@router.delete('/settings', dependencies=[Depends(check_write)])
def clear_provider_settings(request: Request, user=Depends(current_user), db=Depends(database,scope='function')):
    return write_settings(request,user,db,'')


@router.post('/tasks', status_code=201, dependencies=[Depends(check_write)])
def create(payload: TaskCreate, user=Depends(current_user), db=Depends(database,scope='function')):
    return create_task(db,user,payload)


@router.get('/tasks')
def listing(month: str | None = Query(default=None, pattern=r'^\d{4}-\d{2}$'), pending_only: bool = False,
            user=Depends(current_user), db=Depends(database,scope='function')):
    ensure_permission(db,user,'inventory.read')
    query = select(AgentTask).where(AgentTask.actor_id==user.id)
    if month:
        try:
            year, number = map(int, month.split('-'))
            start = datetime(year,number,1,tzinfo=ZoneInfo('Asia/Shanghai'))
            end = datetime(year+int(number==12),1 if number==12 else number+1,1,tzinfo=start.tzinfo)
        except ValueError:
            raise HTTPException(422,'Invalid calendar month') from None
        query = query.where(AgentTask.created_at>=start, AgentTask.created_at<end)
    if pending_only:
        query = query.where(AgentTask.state.not_in(['completed','cancelled']))
    query = query.order_by(AgentTask.created_at.desc(),AgentTask.id)
    rows = db.scalars(query if month or pending_only else query.limit(30))
    result = [snapshot(db,user,row) for row in rows]
    return [row for row in result if row['state'] not in ['completed','cancelled']] if pending_only else result


@router.get('/tasks/{task_id}')
def get(task_id: UUID, user=Depends(current_user), db=Depends(database,scope='function')):
    user, task = access(db,user.id,task_id)
    return snapshot(db,user,task)


@router.post('/tasks/{task_id}/run')
def run(task_id: UUID, payload: TaskRun, request: Request, actor_id=Depends(short_actor)):
    return run_task(request.app,actor_id,task_id,payload)


@router.post('/tasks/{task_id}/select', dependencies=[Depends(check_write)])
def choose(task_id: UUID, payload: Selection, user=Depends(current_user), db=Depends(database,scope='function')):
    user, task = access(db,user.id,task_id,True)
    return select_candidate(db,user,task,payload)


@router.post('/tasks/{task_id}/cancel', dependencies=[Depends(check_write)])
def cancel(task_id: UUID, payload: TaskRun, user=Depends(current_user), db=Depends(database,scope='function')):
    user, task = access(db,user.id,task_id,True)
    return cancel_task(db,user,task,payload)


@router.post('/tasks/{task_id}/refresh', dependencies=[Depends(check_write)])
def refresh(task_id: UUID, payload: TaskRun, user=Depends(current_user), db=Depends(database,scope='function')):
    user, task = access(db,user.id,task_id,True)
    if task.version != payload.expected_version:
        from fastapi import HTTPException
        raise HTTPException(409,'Task version changed')
    task.state = snapshot(db,user,task)['state']
    return snapshot(db,user,task)
