from datetime import timedelta
import hmac
import secrets
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from app.auth.models import AccountAudit, AuthSession, User, UserRole
from app.auth.schemas import AccountCreate, AccountUpdate, Login
from app.auth.service import (DUMMY_PASSWORD_HASH, create_account, csrf_for_session, digest, identity,
                              lock_accounts, login_budget, now, verify_password)


router = APIRouter(prefix='/api')
COOKIE = 'store_session'


def database(request: Request):
    with request.app.state.sessions.begin() as db:
        yield db


def session_row(request, db):
    token = request.cookies.get(COOKIE, '')
    if not token or len(token) > 256:
        return None
    return db.scalar(select(AuthSession).where(AuthSession.token_hash == digest(token),
                     AuthSession.revoked_at.is_(None), AuthSession.expires_at > now()))


def current_user(request: Request, db=Depends(database, scope='function')):
    session = session_row(request, db)
    user = db.get(User, session.user_id) if session and session.user_id else None
    if not user or not user.enabled:
        raise HTTPException(401, 'Authentication required')
    return user


def check_write(request: Request, db=Depends(database, scope='function')):
    if request.headers.get('origin') != request.app.state.settings.origin:
        raise HTTPException(403, 'Origin rejected')
    session = session_row(request, db)
    csrf = request.headers.get('x-csrf-token', '')
    if not session or not csrf or len(csrf) > 256 or not hmac.compare_digest(session.csrf_hash, digest(csrf)):
        raise HTTPException(403, 'CSRF rejected')
    return session


def account_manager(user=Depends(current_user), db=Depends(database, scope='function')):
    lock_accounts(db)
    db.refresh(user)
    if not user.enabled or 'account.manage' not in identity(db, user)['permissions']:
        raise HTTPException(403, 'Permission denied')
    return user


def issue_session(request, response, db, *, user_id=None):
    token = secrets.token_urlsafe(32)
    csrf = csrf_for_session(token)
    lifetime = 8 * 60 * 60 if user_id else 15 * 60
    row = AuthSession(token_hash=digest(token), csrf_hash=digest(csrf), user_id=user_id,
                      expires_at=now() + timedelta(seconds=lifetime))
    db.add(row)
    response.set_cookie(COOKIE, token, max_age=lifetime, httponly=True,
                        secure=request.app.state.settings.cookie_secure, samesite='strict', path='/')
    return csrf


@router.get('/auth/csrf')
def csrf_token(request: Request, response: Response, db=Depends(database, scope='function')):
    row = session_row(request, db)
    if row:
        token = csrf_for_session(request.cookies[COOKIE])
        row.csrf_hash = digest(token)
    else:
        token = issue_session(request, response, db)
    return {'csrf_token': token}


@router.post('/auth/login')
def login(payload: Login, request: Request, response: Response,
          session=Depends(check_write), db=Depends(database, scope='function')):
    budget = login_budget(db, payload.username, request.client.host if request.client else 'unknown')
    if budget is None:
        return JSONResponse(status_code=429, content={'detail': 'Too many login attempts'},
                            headers={'Retry-After': '300'})
    user = db.scalar(select(User).where(User.username == payload.username).with_for_update())
    valid = verify_password(payload.password.get_secret_value(), user.password_hash if user else DUMMY_PASSWORD_HASH)
    if not user or not valid or not user.enabled:
        # A normal response commits the rate counter; raising would roll it back.
        return JSONResponse(status_code=401, content={'detail': 'Invalid credentials'})
    budget.attempts = 0
    session.revoked_at = now()
    issue_session(request, response, db, user_id=user.id)
    return identity(db, user)


@router.get('/auth/me')
def me(user=Depends(current_user), db=Depends(database, scope='function')):
    return identity(db, user)


@router.post('/auth/logout', status_code=204)
def logout(response: Response, session=Depends(check_write), user=Depends(current_user)):
    session.revoked_at = now()
    response.delete_cookie(COOKIE, path='/')


@router.get('/accounts/technicians')
def list_technicians(actor=Depends(account_manager), db=Depends(database, scope='function')):
    rows = db.execute(select(User.id, User.username, User.enabled)
                      .join(UserRole, UserRole.user_id == User.id)
                      .where(UserRole.role == 'technician').order_by(User.username))
    return {'items': [dict(row._mapping) for row in rows]}


@router.post('/accounts', status_code=201, dependencies=[Depends(check_write)])
def add_account(payload: AccountCreate, actor=Depends(account_manager), db=Depends(database, scope='function')):
    try:
        user = create_account(db, payload, actor.id)
    except IntegrityError:
        raise HTTPException(409, 'Username already exists') from None
    return identity(db, user)


@router.patch('/accounts/{user_id}', dependencies=[Depends(check_write)])
def update_account(user_id: UUID, payload: AccountUpdate, actor=Depends(account_manager), db=Depends(database, scope='function')):
    user = db.scalar(select(User).where(User.id == str(user_id)).with_for_update())
    if not user:
        raise HTTPException(404, 'Account not found')
    if 'roles' in payload.model_fields_set and payload.roles is None:
        raise HTTPException(422, 'roles cannot be null')
    if 'enabled' in payload.model_fields_set and payload.enabled is None:
        raise HTTPException(422, 'enabled cannot be null')
    roles = sorted(set(payload.roles)) if payload.roles is not None else identity(db, user)['roles']
    enabled = user.enabled if payload.enabled is None else payload.enabled
    owners = list(db.scalars(select(User.id).join(UserRole).where(
        User.enabled.is_(True), UserRole.role == 'owner')))
    if owners == [user.id] and (not enabled or 'owner' not in roles):
        raise HTTPException(409, 'Cannot remove the last enabled owner')
    user.enabled = enabled
    db.execute(delete(UserRole).where(UserRole.user_id == user.id))
    db.add_all(UserRole(user_id=user.id, role=role) for role in roles)
    db.add(AccountAudit(actor_id=actor.id, target_id=user.id, action='update',
                        changes={'roles': roles, 'enabled': enabled}))
    # Re-enabling an account must never resurrect its old authenticated sessions.
    if not enabled:
        for row in db.scalars(select(AuthSession).where(AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None))):
            row.revoked_at = now()
    db.flush()
    return identity(db, user)
