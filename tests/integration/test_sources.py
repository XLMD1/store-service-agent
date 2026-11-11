from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.main import create_app
from tests.integration.test_auth import csrf, create_user, login


def source_payload(**values):
    return {'request_id': str(uuid4()), 'text': '  虚构纸本样例\n维修日期未记。\n', **values}


def submit(client, payload):
    return client.post('/api/sources', headers=csrf(client), json=payload)


def test_text_source_is_exact_and_persists_after_restart(application, settings):
    with TestClient(application) as client:
        login(client)
        payload = source_payload()
        created = submit(client, payload)
        assert created.status_code == 201, created.text
        summary = created.json()
        assert 'text' not in summary
        assert summary['status'] == 'saved' and summary['submitted_at']
        assert submit(client, payload).json() == summary
        assert submit(client, {**payload, 'text': '不同的原文'}).status_code == 409
        source_id = summary['id']
    restarted = create_app(settings)
    try:
        with TestClient(restarted) as client:
            login(client)
            result = client.get('/api/sources/' + source_id)
            assert result.status_code == 200
            assert result.headers['cache-control'] == 'no-store'
            assert result.json()['text'] == payload['text']
            assert result.json()['source_label'] is None and result.json()['page_label'] is None
            assert result.json()['message_time'] is None
            assert client.get('/api/sources').json()['items'] == [summary]
    finally:
        restarted.state.engine.dispose()


def test_source_submission_checks_permissions_and_payload(application):
    with TestClient(application) as client:
        assert client.get('/api/sources').status_code == 401
        login(client)
        limit = client.get('/api/sources/policy').json()['text_max_chars']
        assert client.post('/api/sources', json=source_payload()).status_code == 403
        assert submit(client, source_payload(text=' ')).status_code == 422
        assert submit(client, source_payload(text='字' * (limit + 1))).status_code == 422
        assert submit(client, source_payload(text='原文\x00')).status_code == 422
        assert submit(client, source_payload(message_time='2026-10-01')).status_code == 422
        assert client.get('/api/sources').json()['items'] == []
        create_user(client)
        with TestClient(application) as stock:
            login(stock, {'username':'demo-stock','password':'Sample-Stock-Password-123'})
            assert submit(stock, source_payload()).status_code == 403
            assert stock.get('/api/sources').status_code == 403


def test_unfiled_source_is_private_and_revocation_takes_effect(application):
    with TestClient(application) as owner, TestClient(application) as clerk:
        login(owner)
        user = create_user(owner, username='demo-clerk', roles=['clerk'])
        login(clerk, {'username':'demo-clerk','password':'Sample-Stock-Password-123'})
        result = submit(clerk, source_payload(source_label='虚构纸本', page_label='第 2 页'))
        assert result.status_code == 201
        path = '/api/sources/' + result.json()['id']
        assert clerk.get(path).json()['page_label'] == '第 2 页'
        assert owner.get(path).status_code == 404
        assert owner.get('/api/sources').json()['items'] == []
        with application.state.sessions.begin() as db:
            db.execute(text("UPDATE user_roles SET role='stock_operator' WHERE user_id=:id"), {'id':user['id']})
        assert clerk.get(path).status_code == 403
        with application.state.sessions.begin() as db:
            db.execute(text('UPDATE users SET enabled=false WHERE id=:id'), {'id':user['id']})
        assert clerk.get(path).status_code == 401
