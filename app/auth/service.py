from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import secrets

from fastapi import HTTPException

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert

from app.auth.models import AccountAudit, LoginThrottle, User, UserRole
from app.auth.schemas import AccountCreate


ROLE_PERMISSIONS = {
    'clerk': {'service.read', 'service.draft', 'service.confirm', 'repair.query', 'inventory.read',
              'reservation.confirm', 'reservation.cancel'},
    'technician': {'service.read', 'service.draft', 'repair.query', 'knowledge.review', 'inventory.read'},
    'stock_operator': {'inventory.read', 'inventory.inbound', 'inventory.outbound', 'reservation.pickup'},
    'owner': {'service.read', 'service.draft', 'service.confirm', 'repair.query', 'inventory.read',
              'inventory.inbound', 'inventory.outbound', 'reservation.confirm', 'reservation.cancel',
              'reservation.pickup', 'inventory.opening', 'inventory.correct', 'catalog.manage',
              'account.manage', 'knowledge.publish'},
}


def now():
    return datetime.now(timezone.utc)


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def csrf_for_session(token):
    return hmac.new(token.encode(), b'store-agent-csrf', hashlib.sha256).hexdigest()


def login_budget(db, username, peer):
    # Fixed lock order keeps concurrent requests across both buckets deadlock-free.
    buckets = sorted([(digest('user:' + username), 5), (digest('peer:' + peer), 30)])
    account_bucket = None
    for key, limit in buckets:
        db.execute(insert(LoginThrottle).values(key=key, attempts=0, window_started_at=now())
                   .on_conflict_do_nothing())
        row = db.scalar(select(LoginThrottle).where(LoginThrottle.key == key).with_for_update())
        if row.window_started_at <= now() - timedelta(minutes=5):
            row.attempts = 0
            row.window_started_at = now()
        if row.attempts >= limit:
            return None
        row.attempts += 1
        if key == digest('user:' + username):
            account_bucket = row
    return account_bucket


def hash_password(password):
    salt = secrets.token_hex(16)
    derived = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 600_000).hex()
    return f'pbkdf2_sha256$600000${salt}${derived}'


def verify_password(password, encoded):
    _, iterations, salt, expected = encoded.split('$')
    actual = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), int(iterations)).hex()
    return hmac.compare_digest(actual, expected)


DUMMY_PASSWORD_HASH = hash_password(secrets.token_urlsafe(32))


def identity(db, user):
    roles = sorted(db.scalars(select(UserRole.role).where(UserRole.user_id == user.id)))
    permissions = sorted({p for role in roles for p in ROLE_PERMISSIONS[role]})
    return {'id': user.id, 'username': user.username, 'enabled': user.enabled,
            'roles': roles, 'permissions': permissions}


def ensure_permission(db, user, permission):
    db.refresh(user)
    if not user.enabled or permission not in identity(db, user)['permissions']:
        raise HTTPException(403, 'Permission denied')


def lock_accounts(db):
    # Serialize bootstrap and owner-role mutations, including concurrent last-owner removal.
    db.execute(text('SELECT pg_advisory_xact_lock(714001)'))


def create_account(db, payload, actor_id=None):
    user = User(username=payload.username, password_hash=hash_password(payload.password.get_secret_value()))
    db.add(user)
    db.flush()
    roles = sorted(set(payload.roles))
    db.add_all(UserRole(user_id=user.id, role=role) for role in roles)
    db.add(AccountAudit(actor_id=actor_id or user.id, target_id=user.id,
                        action='create' if actor_id else 'bootstrap', changes={'roles': roles, 'enabled': True}))
    db.flush()
    return user


def initialize_owner(db, username, password, *, confirmed=False):
    payload = AccountCreate(username=username, password=password, roles=['owner'], confirmed=confirmed)
    lock_accounts(db)
    if db.scalar(select(User.id).limit(1)):
        raise ValueError('Owner initialization is only allowed on an empty account database')
    return create_account(db, payload)
