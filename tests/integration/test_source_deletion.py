from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

from fastapi.testclient import TestClient

from tests.integration.test_auth import csrf, create_user, login
from tests.integration.test_service_archive import archive, confirm, draft_path, preview
from tests.integration.test_source_photos import photo, picture
from tests.integration.test_sources import source_payload, submit


def delete_source(client, path, confirmed=True):
    return client.request('DELETE', path, headers=csrf(client), json={'confirmed': confirmed})


def test_delete_own_unfiled_source_hides_photo_and_draft_and_can_be_retried(application):
    with TestClient(application) as owner, TestClient(application) as clerk:
        login(owner)
        create_user(owner, username='sample-clerk', roles=['clerk'])
        login(clerk, {'username': 'sample-clerk', 'password': 'Sample-Stock-Password-123'})
        request_id = str(uuid4())
        original = picture()
        saved = photo(clerk, original, request_id=request_id)
        assert saved.status_code == 201
        path = '/api/sources/' + saved.json()['id']
        draft = clerk.post(path + '/drafts', headers=csrf(clerk), json={
            'request_id': str(uuid4()), 'fields': {'problem': '样例未归档'},
        })
        assert draft.status_code == 201
        assert delete_source(owner, path).status_code == 404
        assert clerk.request('DELETE', path, json={'confirmed': True}).status_code == 403
        assert delete_source(clerk, path, False).status_code == 422
        assert delete_source(clerk, path).status_code == 204
        assert delete_source(clerk, path).status_code == 204
        assert clerk.get('/api/sources').json()['items'] == []
        for suffix in ('', '/original', '/drafts/' + draft.json()['id']):
            assert clerk.get(path + suffix).status_code == 404
        assert photo(clerk, original, request_id=request_id).status_code == 409


def test_sources_linked_to_archive_follow_up_or_task_are_kept(application):
    with TestClient(application) as client:
        login(client)
        draft, source = draft_path(client, address='虚构地址', problem='样例故障')
        record = archive(client, draft)
        origin = '/api/sources/' + source
        assert delete_source(client, origin).status_code == 409

        follow_up = photo(client, picture()).json()['id']
        result = client.post(f"/api/service-records/{record['id']}/supplements", headers=csrf(client), json={
            'operation_id': str(uuid4()), 'version': 1, 'result': '样例复测', 'source_id': follow_up,
            'confirmed': True,
        })
        assert result.status_code == 200
        assert delete_source(client, '/api/sources/' + follow_up).status_code == 409

        task = client.post('/api/service-agent/tasks', headers=csrf(client), json={
            'request_id': str(uuid4()), 'text': '新报修，内容：虚构样例漏水',
        }).json()
        prepared = client.post(f"/api/service-agent/tasks/{task['id']}/prepare", headers=csrf(client),
                               json={'version': task['version']})
        assert prepared.status_code == 200
        task_source = '/api/sources/' + prepared.json()['preview']['source_id']
        assert delete_source(client, task_source).status_code == 409

        unused = submit(client, source_payload())
        protection = {row['id']: row['can_delete'] for row in client.get('/api/sources').json()['items']}
        assert all(not protection[item] for item in (source, follow_up, task_source.rsplit('/', 1)[1]))
        assert protection[unused.json()['id']]
        assert delete_source(client, '/api/sources/' + unused.json()['id']).status_code == 204
        assert client.get(origin).status_code == 200
        assert client.get('/api/sources/' + follow_up + '/original').status_code == 200


def test_delete_and_archive_never_leave_a_formal_record_without_a_source(application):
    with TestClient(application) as first, TestClient(application) as second:
        login(first)
        login(second)
        draft, source = draft_path(first, address='虚构地址', problem='样例故障')
        reviewed = preview(first, draft)
        assert reviewed.status_code == 200
        operation = reviewed.json()['operation_id']
        path = '/api/sources/' + source
        with ThreadPoolExecutor(2) as pool:
            deleting = pool.submit(delete_source, first, path)
            archiving = pool.submit(confirm, second, draft, operation)
        statuses = deleting.result().status_code, archiving.result().status_code, first.get(path).status_code
        assert statuses in ((204, 404, 404), (409, 200, 200))
