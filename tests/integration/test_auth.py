from datetime import datetime, timedelta, timezone
import hashlib

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import select, text


ORIGIN = 'http://127.0.0.1:8000'
OWNER = {'username': 'demo-owner', 'password': 'Sample-Owner-Password-123'}


def csrf(client):
    response = client.get('/api/auth/csrf')
    assert response.status_code == 200
    return {'Origin': ORIGIN, 'X-CSRF-Token': response.json()['csrf_token']}


def login(client, credentials=OWNER):
    response = client.post('/api/auth/login', json=credentials, headers=csrf(client))
    assert response.status_code == 200, response.text
    return response


def create_user(client, username='demo-stock', roles=None):
    response = client.post('/api/accounts', headers=csrf(client), json={
        'username': username, 'password': 'Sample-Stock-Password-123',
        'roles': roles or ['stock_operator'], 'confirmed': True})
    assert response.status_code == 201, response.text
    return response.json()


def test_technician_directory_includes_disabled_accounts_only_for_owner(application):
    with TestClient(application) as owner, TestClient(application) as worker:
        login(owner)
        account = create_user(owner, username='sample-technician', roles=['technician'])
        login(worker, {'username': 'sample-technician', 'password': 'Sample-Stock-Password-123'})
        path = '/api/accounts/technicians'
        assert worker.get(path).status_code == 403
        expected = {'id': account['id'], 'username': 'sample-technician', 'enabled': True}
        result = owner.get(path)
        assert result.status_code == 200
        assert result.json()['items'] == [expected]
        assert owner.patch('/api/accounts/' + account['id'], headers=csrf(owner),
                           json={'enabled': False, 'confirmed': True}).status_code == 200
        assert owner.get(path).json()['items'] == [{**expected, 'enabled': False}]
        assert owner.get('/api/work-fees/workers').json()['items'] == []
        assert worker.get('/api/auth/me').status_code == 401
        assert owner.patch('/api/accounts/' + account['id'], headers=csrf(owner),
                           json={'enabled': True, 'confirmed': True}).status_code == 200
        assert owner.get('/api/work-fees/workers').json()['items'] == [
            {'id': account['id'], 'name': 'sample-technician'},
        ]
        assert worker.get('/api/auth/me').status_code == 401


def test_anonymous_cannot_read_identity_or_manage_accounts(application):
    with TestClient(application) as client:
        assert client.get('/api/auth/me').status_code == 401
        assert client.post('/api/accounts', json={}, headers=csrf(client)).status_code == 401


def test_login_rotates_session_and_persists_only_hashes(application):
    from app.auth.models import AuthSession, User
    with TestClient(application) as client:
        headers = csrf(client)
        before = client.cookies['store_session']
        response = client.post('/api/auth/login', json=OWNER, headers=headers)
        assert response.status_code == 200
        token = client.cookies['store_session']
        assert token != before
        assert 'HttpOnly' in response.headers['set-cookie']
        assert 'SameSite=strict' in response.headers['set-cookie']
        identity = client.get('/api/auth/me').json()
        assert identity['username'] == 'demo-owner'
        assert 'account.manage' in identity['permissions']
        assert 'password_hash' not in identity
        with application.state.sessions() as db:
            row = db.scalar(select(AuthSession).where(AuthSession.token_hash == hashlib.sha256(token.encode()).hexdigest()))
            assert row is not None and row.user_id == identity['id']
            assert row.csrf_hash != headers['X-CSRF-Token']
            assert db.scalar(select(User)).password_hash != OWNER['password']


@pytest.mark.parametrize('credentials', [
    {'username': 'demo-owner', 'password': 'Wrong-Password-123'},
    {'username': 'no-such-user', 'password': 'Wrong-Password-123'},
])
def test_wrong_credentials_do_not_authenticate(application, credentials):
    with TestClient(application) as client:
        assert client.post('/api/auth/login', json=credentials, headers=csrf(client)).status_code == 401
        assert client.get('/api/auth/me').status_code == 401


@pytest.mark.parametrize('mutation', ['no_origin', 'foreign_origin', 'no_csrf', 'bad_csrf'])
def test_login_rejects_cross_site_or_missing_csrf(application, mutation):
    with TestClient(application) as client:
        headers = csrf(client)
        if mutation == 'no_origin': headers.pop('Origin')
        if mutation == 'foreign_origin': headers['Origin'] = 'https://outside.invalid'
        if mutation == 'no_csrf': headers.pop('X-CSRF-Token')
        if mutation == 'bad_csrf': headers['X-CSRF-Token'] = 'incorrect'
        assert client.post('/api/auth/login', json=OWNER, headers=headers).status_code == 403
        assert client.get('/api/auth/me').status_code == 401


def test_two_accounts_share_service_and_roles_are_combined(application):
    with TestClient(application) as owner, TestClient(application) as worker:
        login(owner)
        user = create_user(owner, roles=['clerk', 'stock_operator'])
        login(worker, {'username': 'demo-stock', 'password': 'Sample-Stock-Password-123'})
        identity = worker.get('/api/auth/me').json()
        assert identity['id'] == user['id']
        assert identity['id'] != owner.get('/api/auth/me').json()['id']
        assert {'inventory.inbound', 'reservation.confirm'} <= set(identity['permissions'])
        assert 'account.manage' not in identity['permissions']
        assert worker.post('/api/accounts', headers=csrf(worker), json={
            'username': 'forbidden', 'password': 'Password-Test-12345', 'roles': ['owner'], 'confirmed': True
        }).status_code == 403


def test_logout_revokes_only_current_session(application):
    with TestClient(application) as first, TestClient(application) as second:
        login(first); login(second)
        stolen = first.cookies['store_session']
        assert first.post('/api/auth/logout', headers=csrf(first)).status_code == 204
        assert first.get('/api/auth/me').status_code == 401
        first.cookies.set('store_session', stolen)
        assert first.get('/api/auth/me').status_code == 401
        assert second.get('/api/auth/me').status_code == 200


def test_csrf_tokens_cannot_be_used_in_another_session(application):
    with TestClient(application) as first, TestClient(application) as second:
        login(first); login(second)
        assert second.post('/api/auth/logout', headers=csrf(first)).status_code == 403
        assert second.get('/api/auth/me').status_code == 200


def test_session_survives_application_recreation(application, settings):
    from app.main import create_app
    with TestClient(application) as original:
        login(original)
        token = original.cookies['store_session']
    restarted = create_app(settings)
    with TestClient(restarted) as client:
        client.cookies.set('store_session', token)
        assert client.get('/api/auth/me').json()['username'] == 'demo-owner'
    restarted.state.engine.dispose()


def test_disable_and_role_revocation_affect_existing_sessions(application):
    with TestClient(application) as owner, TestClient(application) as worker:
        login(owner)
        user = create_user(owner, roles=['owner'])
        login(worker, {'username': 'demo-stock', 'password': 'Sample-Stock-Password-123'})
        assert 'account.manage' in worker.get('/api/auth/me').json()['permissions']
        response = owner.patch('/api/accounts/' + user['id'], headers=csrf(owner), json={
            'roles': ['technician'], 'confirmed': True})
        assert response.status_code == 200
        assert 'account.manage' not in worker.get('/api/auth/me').json()['permissions']
        assert worker.post('/api/accounts', headers=csrf(worker), json={
            'username': 'forbidden', 'password': 'Password-Test-12345', 'roles': ['owner'], 'confirmed': True
        }).status_code == 403
        assert owner.patch('/api/accounts/' + user['id'], headers=csrf(owner), json={
            'enabled': False, 'confirmed': True}).status_code == 200
        assert worker.get('/api/auth/me').status_code == 401
        assert worker.post('/api/auth/login', headers=csrf(worker), json={
            'username': 'demo-stock', 'password': 'Sample-Stock-Password-123'}).status_code == 401


def test_expired_session_is_rejected(application):
    from app.auth.models import AuthSession
    with TestClient(application) as client:
        login(client)
        with application.state.sessions.begin() as db:
            row = db.scalar(select(AuthSession).where(AuthSession.user_id.is_not(None)))
            row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        assert client.get('/api/auth/me').status_code == 401


@pytest.mark.parametrize('payload', [
    {'roles': ['technician'], 'confirmed': True},
    {'enabled': False, 'confirmed': True},
])
def test_last_enabled_owner_cannot_be_removed(application, payload):
    with TestClient(application) as client:
        login(client)
        owner_id = client.get('/api/auth/me').json()['id']
        assert client.patch('/api/accounts/' + owner_id, headers=csrf(client), json=payload).status_code == 409
        assert 'account.manage' in client.get('/api/auth/me').json()['permissions']


@pytest.mark.parametrize('overrides', [
    {'confirmed': False}, {'roles': ['invented']}, {'actor_id': 'spoofed'}, {'password': 'short'}
])
def test_account_creation_rejects_unconfirmed_or_invalid_input(application, overrides):
    with TestClient(application) as client:
        login(client)
        payload = {'username': 'demo-stock', 'password': 'Sample-Stock-Password-123',
                   'roles': ['stock_operator'], 'confirmed': True, **overrides}
        assert client.post('/api/accounts', headers=csrf(client), json=payload).status_code == 422
        with application.state.sessions() as db:
            assert db.scalar(text('SELECT count(*) FROM users')) == 1


def test_duplicate_user_has_no_partial_audit_or_role_rows(application):
    with TestClient(application) as client:
        login(client); create_user(client)
        assert client.post('/api/accounts', headers=csrf(client), json={
            'username': 'demo-stock', 'password': 'Sample-Stock-Password-123',
            'roles': ['owner'], 'confirmed': True}).status_code == 409
        with application.state.sessions() as db:
            assert db.scalar(text('SELECT count(*) FROM users')) == 2
            assert db.scalar(text('SELECT count(*) FROM account_audit')) == 2


def test_bootstrap_owner_is_once_only(application):
    from app.auth.service import initialize_owner
    with application.state.sessions.begin() as db:
        with pytest.raises(ValueError):
            initialize_owner(db, 'another-owner', 'Password-Test-12345', confirmed=True)


def test_reenabled_account_does_not_recover_revoked_session(application):
    with TestClient(application) as owner, TestClient(application) as worker:
        login(owner); user = create_user(owner)
        login(worker, {'username': 'demo-stock', 'password': 'Sample-Stock-Password-123'})
        for enabled in [False, True]:
            assert owner.patch('/api/accounts/' + user['id'], headers=csrf(owner), json={
                'enabled': enabled, 'confirmed': True}).status_code == 200
        assert worker.get('/api/auth/me').status_code == 401


@pytest.mark.parametrize('method', ['create', 'update', 'logout'])
@pytest.mark.parametrize('mutation', ['bad_csrf', 'no_origin', 'foreign_origin'])
def test_all_authenticated_write_routes_require_csrf_and_origin(application, method, mutation):
    with TestClient(application) as client:
        login(client)
        owner_id = client.get('/api/auth/me').json()['id']
        headers = csrf(client)
        if mutation == 'bad_csrf': headers['X-CSRF-Token'] = 'wrong'
        if mutation == 'no_origin': headers.pop('Origin')
        if mutation == 'foreign_origin': headers['Origin'] = 'https://outside.invalid'
        if method == 'create':
            response = client.post('/api/accounts', headers=headers, json={
                'username': 'forbidden', 'password': 'Password-Test-12345', 'roles': ['owner'], 'confirmed': True})
        elif method == 'update':
            response = client.patch('/api/accounts/' + owner_id, headers=headers, json={
                'roles': ['technician'], 'confirmed': True})
        else:
            response = client.post('/api/auth/logout', headers=headers)
        assert response.status_code == 403
        assert client.get('/api/auth/me').status_code == 200
        with application.state.sessions() as db:
            assert db.scalar(text('SELECT count(*) FROM account_audit')) == 1


def test_validation_error_does_not_echo_password(application):
    with TestClient(application) as client:
        response = client.post('/api/auth/login', headers=csrf(client), json={
            **OWNER, 'password': 'sensitive-test-secret', 'roles': ['owner']})
        assert response.status_code == 422
        assert 'sensitive-test-secret' not in response.text


def test_concurrent_owner_demotions_leave_one_enabled_owner(application):
    from concurrent.futures import ThreadPoolExecutor
    with TestClient(application) as first, TestClient(application) as second:
        login(first)
        user = create_user(first, roles=['owner'])
        login(second, {'username': 'demo-stock', 'password': 'Sample-Stock-Password-123'})
        original = first.get('/api/auth/me').json()['id']
        headers_one, headers_two = csrf(first), csrf(second)
        def demote(client, user_id, headers):
            return client.patch('/api/accounts/' + user_id, headers=headers,
                                json={'roles': ['technician'], 'confirmed': True}).status_code
        with ThreadPoolExecutor(max_workers=2) as pool:
            one = pool.submit(demote, first, original, headers_one)
            two = pool.submit(demote, second, user['id'], headers_two)
            assert sorted([one.result(), two.result()]) == [200, 409]
        with application.state.sessions() as db:
            assert db.scalar(text("SELECT count(*) FROM users u JOIN user_roles r ON r.user_id=u.id "
                                  "WHERE u.enabled AND r.role='owner'")) == 1


def test_reading_csrf_in_another_tab_keeps_original_form_valid(application):
    with TestClient(application) as client:
        login(client)
        first_tab = csrf(client)
        csrf(client)
        assert client.post('/api/auth/logout', headers=first_tab).status_code == 204


def test_failed_login_limit_persists_and_recovers_after_cooldown(application, settings):
    from app.main import create_app
    with TestClient(application) as client:
        headers = csrf(client)
        for _ in range(5):
            assert client.post('/api/auth/login', headers=headers, json={**OWNER, 'password': 'incorrect'}).status_code == 401
        assert client.post('/api/auth/login', headers=headers, json=OWNER).status_code == 429
    restarted = create_app(settings)
    try:
        with TestClient(restarted) as client:
            assert client.post('/api/auth/login', headers=csrf(client), json=OWNER).status_code == 429
            with application.state.sessions.begin() as db:
                db.execute(text("UPDATE login_throttles SET window_started_at = now() - interval '6 minutes'"))
            assert client.post('/api/auth/login', headers=csrf(client), json=OWNER).status_code == 200
    finally:
        restarted.state.engine.dispose()


def test_peer_limit_rejects_username_spraying(application):
    with TestClient(application) as client:
        headers = csrf(client)
        for i in range(30):
            assert client.post('/api/auth/login', headers=headers, json={
                'username': f'unknown-{i}', 'password': 'incorrect'}).status_code == 401
        response = client.post('/api/auth/login', headers=headers, json=OWNER)
        assert response.status_code == 429
        assert int(response.headers['retry-after']) > 0


def test_successful_login_resets_account_failure_count(application):
    with TestClient(application) as client:
        for _ in range(2):
            headers = csrf(client)
            for _ in range(4):
                assert client.post('/api/auth/login', headers=headers, json={**OWNER, 'password': 'incorrect'}).status_code == 401
            login(client)


def test_concurrent_failed_logins_cannot_exceed_account_budget(application):
    from concurrent.futures import ThreadPoolExecutor
    from contextlib import ExitStack
    with ExitStack() as stack:
        clients = [stack.enter_context(TestClient(application)) for _ in range(8)]
        headers = [csrf(client) for client in clients]
        def attempt(index):
            return clients[index].post('/api/auth/login', headers=headers[index],
                                       json={**OWNER, 'password': 'incorrect'}).status_code
        with ThreadPoolExecutor(max_workers=8) as pool:
            statuses = list(pool.map(attempt, range(8)))
        assert statuses.count(401) == 5
        assert statuses.count(429) == 3


def test_https_session_cookie_is_secure(application, settings):
    from dataclasses import replace
    from app.main import create_app
    secure_app = create_app(replace(settings, origin='https://example.test', cookie_secure=True))
    try:
        with TestClient(secure_app, base_url='https://example.test') as client:
            token = client.get('/api/auth/csrf').json()['csrf_token']
            response = client.post('/api/auth/login', json=OWNER,
                                   headers={'Origin': 'https://example.test', 'X-CSRF-Token': token})
            assert response.status_code == 200
            assert '; Secure' in response.headers['set-cookie']
            assert client.get('/api/auth/me').status_code == 200
    finally:
        secure_app.state.engine.dispose()
