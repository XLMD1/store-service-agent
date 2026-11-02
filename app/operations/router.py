from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

from app.auth.router import check_write, current_user, database
from app.auth.service import identity
from app.operations.models import Draft, Operation
from app.operations.schemas import Confirmation, DraftCreate, DraftUpdate
from app.operations.service import PERMISSIONS, check_actor, confirm_operation, draft_result, prepare_draft


router = APIRouter(prefix='/api')


@router.post('/drafts', status_code=201, dependencies=[Depends(check_write)])
def create_draft(payload: DraftCreate, user=Depends(current_user), db=Depends(database, scope='function')):
    return prepare_draft(db, user, payload.parameters, kind=payload.kind)


@router.get('/drafts')
def pending_drafts(user=Depends(current_user), db=Depends(database, scope='function')):
    permissions = identity(db, user)['permissions']
    kinds = [kind for kind, permission in PERMISSIONS.items() if permission in permissions]
    rows = db.scalars(select(Draft).where(Draft.created_by == user.id, Draft.kind.in_(kinds),
                                         Draft.state.in_(['missing', 'ready'])).order_by(Draft.id))
    return [draft_result(db, row) for row in rows]


@router.get('/drafts/{draft_id}')
def get_draft(draft_id: UUID, user=Depends(current_user), db=Depends(database, scope='function')):
    row = db.get(Draft, str(draft_id))
    if not row:
        raise HTTPException(404, 'Draft not found')
    check_actor(db, user, row.created_by, row.kind)
    return draft_result(db, row)


@router.patch('/drafts/{draft_id}', dependencies=[Depends(check_write)])
def edit_draft(draft_id: UUID, payload: DraftUpdate, user=Depends(current_user), db=Depends(database, scope='function')):
    # Use the same operation -> draft lock order as confirmation, including old operations.
    db.scalars(select(Operation).where(Operation.draft_id == str(draft_id)).order_by(Operation.id).with_for_update()).all()
    row = db.scalar(select(Draft).where(Draft.id == str(draft_id)).with_for_update())
    if not row:
        raise HTTPException(404, 'Draft not found')
    check_actor(db, user, row.created_by, row.kind)
    if row.version != payload.expected_version or row.state == 'succeeded':
        raise HTTPException(409, 'Draft version changed or already submitted')
    return prepare_draft(db, user, payload.parameters, row)


@router.post('/operations/{operation_id}/confirm', dependencies=[Depends(check_write)])
def confirm(operation_id: UUID, payload: Confirmation, user=Depends(current_user), db=Depends(database, scope='function')):
    return confirm_operation(db, user, operation_id, payload)


@router.get('/operations/{operation_id}')
def operation_result(operation_id: UUID, user=Depends(current_user), db=Depends(database, scope='function')):
    row = db.get(Operation, str(operation_id))
    if not row:
        raise HTTPException(404, 'Operation not found')
    draft = db.get(Draft, row.draft_id)
    check_actor(db, user, row.actor_id, draft.kind)
    return {'id': row.id, 'state': row.state, 'result': row.result}
