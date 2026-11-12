from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.main import create_app
from tests.integration.test_auth import csrf, create_user, login
from tests.integration.test_source_photos import photo, picture
from tests.integration.test_sources import source_payload, submit


def test_photo_has_independent_drafts_after_restart(application, settings):
    original = picture()
    with TestClient(application) as client:
        login(client)
        source_id = photo(client, original).json()['id']
        source_path = f'/api/sources/{source_id}'
        drafts = source_path + '/drafts'
        first_input = {'request_id': str(uuid4()), 'fields': {'phone': '138…45',
                       'uncertain_fields': ['phone']}}
        first = client.post(drafts, headers=csrf(client), json=first_input)
        assert first.status_code == 201, first.text
        assert first.json()['fields']['phone'] == '138…45'
        assert first.json()['fields']['uncertain_fields'] == ['phone']
        assert first.json()['fields']['repair_date_precision'] == 'unknown'
        assert first.json()['fields']['repair_date'] is None
        assert first.json()['state'] == 'needs_review'
        assert client.post(drafts, headers=csrf(client), json=first_input).json() == first.json()
        assert client.post(drafts, headers=csrf(client), json={**first_input, 'fields': {}}).status_code == 409
        second = client.post(drafts, headers=csrf(client), json={'request_id': str(uuid4()), 'fields': {
            'problem': '虚构样例：设备无法启动', 'repair_date': '2025-02', 'repair_date_precision': 'month',
        }})
        assert second.status_code == 201, second.text
        assert first.json()['id'] != second.json()['id']

    restarted = create_app(settings)
    try:
        with TestClient(restarted) as client:
            login(client)
            saved = client.get(drafts).json()['items']
            assert {row['id']: row for row in saved} == {row['id']: row for row in (first.json(), second.json())}
            assert client.get(source_path + '/original').content == original
    finally:
        restarted.state.engine.dispose()


def test_edit_draft_rejects_stale_versions_and_invalid_date(application):
    with TestClient(application) as client:
        login(client)
        source = submit(client, source_payload()).json()
        drafts = f"/api/sources/{source['id']}/drafts"
        initial = {'request_id': str(uuid4()), 'fields': {}}
        created = client.post(drafts, headers=csrf(client), json=initial)
        assert created.status_code == 201, created.text
        path = drafts + '/' + created.json()['id']
        update = {'version': 1, 'fields': {'problem': '虚构样例：不制热',
                  'repair_date': '2025-02-29', 'repair_date_precision': 'day'}}
        assert client.put(path, headers=csrf(client), json=update).status_code == 422
        update['fields']['repair_date'] = '2024-02-29'
        edited = client.put(path, headers=csrf(client), json=update)
        assert edited.status_code == 200, edited.text
        assert edited.json()['version'] == 2
        update['fields']['problem'] = '另一会话的旧修改'
        assert client.put(path, headers=csrf(client), json=update).status_code == 409
        assert client.get(path).json() == edited.json()
        assert client.post(drafts, headers=csrf(client), json=initial).json() == edited.json()


def test_draft_access_follows_current_source_permissions(application):
    with TestClient(application) as owner, TestClient(application) as clerk:
        login(owner)
        account = create_user(owner, username='demo-clerk', roles=['clerk'])
        login(clerk, {'username': 'demo-clerk', 'password': 'Sample-Stock-Password-123'})
        source_id = submit(clerk, source_payload()).json()['id']
        drafts = f'/api/sources/{source_id}/drafts'
        payload = {'request_id': str(uuid4()), 'fields': {}}
        assert clerk.post(drafts, json=payload).status_code == 403
        draft = clerk.post(drafts, headers=csrf(clerk), json=payload)
        assert draft.status_code == 201, draft.text
        path = drafts + '/' + draft.json()['id']
        assert owner.get(drafts).status_code == 404
        assert owner.get(path).status_code == 404
        assert owner.post(drafts, headers=csrf(owner), json=payload).status_code == 404
        assert owner.put(path, headers=csrf(owner), json={'version': 1, 'fields': {}}).status_code == 404
        other_source = submit(clerk, source_payload()).json()['id']
        assert clerk.get(f"/api/sources/{other_source}/drafts/{draft.json()['id']}").status_code == 404
        with application.state.sessions.begin() as db:
            db.execute(text("UPDATE user_roles SET role='stock_operator' WHERE user_id=:id"), {'id': account['id']})
        assert clerk.get(path).status_code == 403
        assert clerk.put(path, headers=csrf(clerk), json={'version': 1, 'fields': {}}).status_code == 403
