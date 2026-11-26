from datetime import timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import Field, field_validator
from sqlalchemy import or_, select

from app.auth.models import User
from app.auth.router import check_write, current_user, database
from app.auth.service import digest, ensure_permission, identity, lock_accounts, now
from app.knowledge.models import RepairCase
from app.knowledge.schemas import ConfirmedInput
from app.sources.schemas import check_text


router = APIRouter(prefix='/api/repair/cases')
State = Literal['pending_review', 'reviewed', 'rejected']


class Submission(ConfirmedInput):
    request_id: UUID
    model: str = Field(min_length=1, max_length=100)
    problem: str = Field(min_length=1, max_length=2000)
    conditions: str = Field(min_length=1, max_length=2000)
    outcome: str = Field(min_length=1, max_length=2000)

    @field_validator('model', 'problem', 'conditions', 'outcome')
    @classmethod
    def valid_text(cls, value):
        check_text(value)
        return value


class Review(ConfirmedInput):
    request_id: UUID
    decision: Literal['reviewed', 'rejected']
    note: str = Field(min_length=1, max_length=1000)

    @field_validator('note')
    @classmethod
    def valid_note(cls, value):
        check_text(value)
        return value


def summaries(db, rows):
    actor_ids = {actor for row in rows for actor in (row.submitted_by, row.reviewed_by) if actor}
    actors = dict(db.execute(select(User.id, User.username).where(User.id.in_(actor_ids))).all())
    items = []
    for row in rows:
        item = {key: getattr(row, key) for key in (
            'id', 'model', 'problem', 'conditions', 'outcome', 'state', 'review_note')}
        items.append({**item, 'submitted_by': actors[row.submitted_by], 'reviewed_by': actors.get(row.reviewed_by),
                      'submitted_at': row.submitted_at.astimezone(timezone.utc),
                      'reviewed_at': row.reviewed_at.astimezone(timezone.utc) if row.reviewed_at else None})
    return items


@router.get('')
def list_cases(model: str = Query('', max_length=100), state: State | None = None,
               offset: int = Query(0, ge=0), user=Depends(current_user), db=Depends(database, scope='function')):
    ensure_permission(db, user, 'knowledge.read')
    query = select(RepairCase)
    if 'knowledge.review' not in identity(db, user)['permissions']:
        query = query.where(or_(RepairCase.submitted_by == user.id, RepairCase.state == 'reviewed'))
    if state:
        query = query.where(RepairCase.state == state)
    if model.strip():
        query = query.where(RepairCase.model == model.strip())
    rows = list(db.scalars(query.order_by(RepairCase.submitted_at.desc(), RepairCase.id).offset(offset).limit(51)))
    return {'items': summaries(db, rows[:50]), 'next_offset': offset + 50 if len(rows) > 50 else None}


@router.post('', status_code=201, dependencies=[Depends(check_write)])
def submit(payload: Submission, user=Depends(current_user), db=Depends(database, scope='function')):
    lock_accounts(db)
    ensure_permission(db, user, 'knowledge.review')
    key = str(payload.request_id)
    fingerprint = digest(payload.model_dump_json())
    row = db.scalar(select(RepairCase).where(RepairCase.submitted_by == user.id, RepairCase.request_id == key))
    if row:
        if row.request_digest != fingerprint:
            raise HTTPException(409, 'Request already used with different content')
    else:
        row = RepairCase(submitted_by=user.id, request_id=key, request_digest=fingerprint,
                         **payload.model_dump(exclude={'confirmed', 'request_id'}))
        db.add(row)
        db.flush()
    return summaries(db, [row])[0]


@router.post('/{case_id}/review', dependencies=[Depends(check_write)])
def review(case_id: UUID, payload: Review, user=Depends(current_user), db=Depends(database, scope='function')):
    lock_accounts(db)
    ensure_permission(db, user, 'knowledge.review')
    row = db.get(RepairCase, str(case_id))
    if row is None:
        raise HTTPException(404, 'Repair case not found')
    key = str(payload.request_id)
    prior = db.scalar(select(RepairCase).where(RepairCase.reviewed_by == user.id, RepairCase.review_request_id == key))
    if prior:
        if prior.id == row.id and prior.state == payload.decision and prior.review_note == payload.note:
            return summaries(db, [prior])[0]
        raise HTTPException(409, 'Review request already used')
    if row.state != 'pending_review':
        raise HTTPException(409, 'Repair case already reviewed')
    row.state = payload.decision
    row.review_note = payload.note
    row.reviewed_by = user.id
    row.reviewed_at = now()
    row.review_request_id = key
    db.flush()
    return summaries(db, [row])[0]
