from uuid import uuid4
from datetime import UTC, datetime

from fastapi.testclient import TestClient

from app.main import create_app
from app.service_records.models import ServiceAgentTask
from tests.integration.test_auth import csrf, create_user, login
from tests.integration.test_service_archive import archive, draft_path
from tests.integration.test_source_photos import photo, picture


def post(client, path, body):
    response = client.post(path, headers=csrf(client), json=body)
    assert response.status_code in (200, 201), response.text
    return response.json()


def test_lookup_and_supplement_require_explicit_record_and_restore_after_restart(application, settings):
    with TestClient(application) as owner, TestClient(application) as clerk:
        login(owner)
        create_user(owner, username='sample-clerk', roles=['clerk'])
        login(clerk, {'username': 'sample-clerk', 'password': 'Sample-Stock-Password-123'})
        first, _ = draft_path(owner, phone='13800000000', address='样例北路', problem='不制热')
        north = archive(owner, first)
        second, _ = draft_path(owner, phone='13800000000', address='样例南路', problem='无法启动')
        south = archive(owner, second)
        create = {'request_id': str(uuid4()), 'text': '给13800000000补充维修结果，内容：复测正常'}
        new = post(owner, '/api/service-agent/tasks', create)
        path = '/api/service-agent/tasks/' + new['id']
        assert post(owner, '/api/service-agent/tasks', create)['id'] == new['id']
        assert new['intent'] == 'supplement'
        assert {item['id'] for item in new['contacts']} == {north['contact_id'], south['contact_id']}
        assert clerk.get(path).status_code == 404
        assert owner.post(path + '/prepare', headers=csrf(owner), json={'version': new['version']}).status_code == 422
        selected = post(owner, path + '/select', {'version': new['version'], 'contact_id': north['contact_id']})
        assert [row['id'] for row in selected['records']] == [north['id']]
        assert owner.post(path + '/select', headers=csrf(owner),
                          json={'version': selected['version'], 'record_id': south['id']}).status_code == 422
        selected = post(owner, path + '/select', {'version': selected['version'], 'record_id': north['id']})
        ready = post(owner, path + '/prepare', {'version': selected['version']})
        assert ready['state'] == 'awaiting_confirmation'
        assert ready['preview']['content'] == '复测正常'
        assert owner.get('/api/service-records/' + north['id'] + '/supplements').json()['items'] == []

    restarted = create_app(settings)
    try:
        with TestClient(restarted) as owner:
            login(owner)
            restored = owner.get(path).json()
            assert restored['preview'] == ready['preview']
            confirmation = {'operation_id': restored['preview']['operation_id'], 'confirmed': True}
            result = post(owner, path + '/confirm', confirmation)
            assert result['state'] == 'completed'
            assert post(owner, path + '/confirm', confirmation)['receipt'] == result['receipt']
            assert len(owner.get('/api/service-records/' + north['id'] + '/supplements').json()['items']) == 1
            assert owner.get('/api/service-records/' + south['id'] + '/supplements').json()['items'] == []
    finally:
        restarted.state.engine.dispose()


def test_new_report_creates_separate_draft_and_keeps_existing_record(application):
    with TestClient(application) as owner:
        login(owner)
        original, _ = draft_path(owner, address='样例东路', problem='不制热')
        record = archive(owner, original)
        new = post(owner, '/api/service-agent/tasks', {
            'request_id': str(uuid4()), 'text': '样例东路又报修了，地址：样例东路，内容：漏水',
        })
        path = '/api/service-agent/tasks/' + new['id']
        assert new['intent'] == 'new'
        selected = post(owner, path + '/select', {'version': new['version'], 'contact_id': record['contact_id']})
        selected = post(owner, path + '/configure', {'version': selected['version'], 'intent': 'new',
                                                     'lookup': '样例东路', 'content': '新故障：水管漏水'})
        ready = post(owner, path + '/prepare', {'version': selected['version']})
        preview = ready['preview']
        assert ready['state'] == 'awaiting_confirmation'
        assert owner.get('/api/sources/' + preview['source_id']).json()['text'] == '新故障：水管漏水'
        draft_url = '/api/sources/' + preview['source_id'] + '/drafts/' + preview['draft_id']
        assert owner.get(draft_url).json()['fields']['problem'] == '新故障：水管漏水'
        saved = post(owner, path + '/confirm', {'operation_id': preview['operation_id'], 'confirmed': True})
        assert saved['receipt']['id'] != record['id']
        assert saved['receipt']['contact_id'] == record['contact_id']
        history = owner.get('/api/service-records/contacts/' + record['contact_id']).json()['items']
        assert {row['fields']['problem'] for row in history} == {'新故障：水管漏水', '不制热'}


def test_agent_version_conflict_requires_new_preview_and_lookup_is_read_only(application):
    with TestClient(application) as owner:
        login(owner)
        draft, source_id = draft_path(owner, address='样例西路', problem='不点火')
        record = archive(owner, draft)
        task_root = '/api/service-agent/tasks'
        lookup = post(owner, task_root, {'request_id': str(uuid4()), 'text': '查档案' + record['id']})
        path = task_root + '/' + lookup['id']
        lookup = post(owner, path + '/select', {'version': lookup['version'], 'contact_id': record['contact_id']})
        lookup = post(owner, path + '/select', {'version': lookup['version'], 'record_id': record['id']})
        assert lookup['state'] == 'completed' and lookup['preview'] is None
        assert lookup['record']['source_id'] == source_id

        task = post(owner, task_root, {
            'request_id': str(uuid4()), 'text': '补充档案' + record['id'] + '，内容：复测通过',
        })
        path = task_root + '/' + task['id']
        task = post(owner, path + '/select', {'version': task['version'], 'contact_id': record['contact_id']})
        task = post(owner, path + '/select', {'version': task['version'], 'record_id': record['id']})
        task = post(owner, path + '/prepare', {'version': task['version']})
        supplement_path = f"/api/service-records/{record['id']}/supplements"
        follow_up = photo(owner, picture()).json()['id']
        post(owner, supplement_path, {'operation_id': str(uuid4()), 'version': 1, 'result': '第一次复测',
                                     'source_id': follow_up, 'confirmed': True})
        confirm = {'operation_id': task['preview']['operation_id'], 'confirmed': True}
        assert owner.post(path + '/confirm', headers=csrf(owner), json=confirm).status_code == 409
        assert owner.get(path).json()['preview_stale'] is True
        new = post(owner, path + '/prepare', {'version': task['version']})
        assert not new['preview_stale'] and new['preview']['source_id'] == task['preview']['source_id']
        post(owner, path + '/confirm', {'operation_id': new['preview']['operation_id'], 'confirmed': True})
        assert len(owner.get(supplement_path).json()['items']) == 2


def test_service_task_lists_use_beijing_creation_month_and_pending_state(application):
    with TestClient(application) as owner, TestClient(application) as clerk:
        login(owner)
        create_user(owner, username='sample-clerk', roles=['clerk'])
        login(clerk, {'username': 'sample-clerk', 'password': 'Sample-Stock-Password-123'})
        root = '/api/service-agent/tasks'
        draft, _ = draft_path(owner, address='样例地址', problem='点火异常')
        record = archive(owner, draft)
        result = post(owner, root, {'request_id': str(uuid4()), 'text': '查档案' + record['id']})
        path = root + '/' + result['id']
        result = post(owner, path + '/select', {'version': result['version'], 'contact_id': record['contact_id']})
        result = post(owner, path + '/select', {'version': result['version'], 'record_id': record['id']})
        pending = post(owner, root, {'request_id': str(uuid4()), 'text': '补充内容：复测正常'})
        hidden = post(clerk, root, {'request_id': str(uuid4()), 'text': '查询样例'})
        with application.state.sessions.begin() as db:
            db.get(ServiceAgentTask, result['id']).created_at = datetime(2026, 10, 31, 16, 0, tzinfo=UTC)
            db.get(ServiceAgentTask, pending['id']).created_at = datetime(2026, 10, 31, 15, 59, tzinfo=UTC)
            db.get(ServiceAgentTask, hidden['id']).created_at = datetime(2026, 11, 1, tzinfo=UTC)
        october = owner.get(root + '?month=2026-10').json()['items']
        november = owner.get(root + '?month=2026-11').json()['items']
        assert [(row['id'], row['state']) for row in october] == [(pending['id'], 'missing')]
        assert [(row['id'], row['state']) for row in november] == [(result['id'], 'completed')]
        assert [row['id'] for row in owner.get(root + '?pending_only=true').json()['items']] == [pending['id']]
        assert owner.get(root + '?month=2026-13').status_code == 422
