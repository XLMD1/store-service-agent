from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import create_app
from tests.integration.test_auth import csrf, create_user, login
from tests.integration.test_service_archive import archive, draft_path
from tests.integration.test_source_photos import photo, picture


def supplement(version=1, **values):
    return {'operation_id': str(uuid4()), 'version': version, 'result': '复测制热正常',
            'confirmed': True, **values}


def test_supplement_keeps_original_record_and_links_follow_up_photo(application, settings):
    original_photo = picture()
    with TestClient(application) as client:
        login(client)
        draft, original = draft_path(client, address='样例路一号', problem='不制热', result='等待复测')
        record = archive(client, draft)
        path = f"/api/service-records/{record['id']}/supplements"
        saved_photo = photo(client, original_photo)
        assert saved_photo.status_code == 201
        source_id = saved_photo.json()['id']
        payload = supplement(source_id=source_id)
        empty = client.get(path)
        assert empty.status_code == 200, empty.text
        assert empty.json() == {'version': 1, 'items': [], 'next_offset': None}
        assert client.post(path, json=payload).status_code == 403
        assert client.post(path, headers=csrf(client), json={**payload, 'confirmed': False}).status_code == 422
        assert client.post(path, headers=csrf(client), json={**payload, 'source_id': original}).status_code == 422
        saved = client.post(path, headers=csrf(client), json=payload)
        assert saved.status_code == 200, saved.text
        assert client.post(path, headers=csrf(client), json=payload).json() == saved.json()
        assert client.post(path, headers=csrf(client), json={**payload, 'result': '已更换设备'}).status_code == 409
        assert client.get(f'/api/sources/{source_id}/original').content == original_photo
    reopened = create_app(settings)
    try:
        with TestClient(reopened) as client:
            login(client)
            history = client.get(f"/api/service-records/contacts/{record['contact_id']}").json()
            [entry] = history['items']
            assert entry['id'] == record['id']
            assert entry['fields']['result'] == '等待复测'
            assert entry['latest_result'] == '复测制热正常'
            assert entry['source_id'] == original
            result = client.get(path).json()
            assert result['version'] == 2
            assert result['items'] == [saved.json()]
            assert saved.json()['source_id'] == source_id
            assert saved.json()['result'] == payload['result']
            assert saved.json()['actor'] == 'demo-owner'
            assert client.get('/api/sources/' + original).status_code == 200
    finally:
        reopened.state.engine.dispose()


def test_stale_supplement_conflicts_without_widening_source_access(application):
    with TestClient(application) as owner, TestClient(application) as clerk, TestClient(application) as tech:
        login(owner)
        create_user(owner, username='sample-clerk', roles=['clerk'])
        create_user(owner, username='sample-tech', roles=['technician'])
        login(clerk, {'username': 'sample-clerk', 'password': 'Sample-Stock-Password-123'})
        login(tech, {'username': 'sample-tech', 'password': 'Sample-Stock-Password-123'})
        draft, _ = draft_path(owner, address='样例路二号', problem='不点火')
        record = archive(owner, draft)
        path = f"/api/service-records/{record['id']}/supplements"
        source_id = photo(owner, picture()).json()['id']
        assert clerk.get(path).json()['version'] == owner.get(path).json()['version'] == 1
        clerk_source = photo(clerk, picture()).json()['id']
        assert tech.post(path, headers=csrf(tech), json=supplement(source_id=source_id)).status_code == 403
        assert clerk.post(path, headers=csrf(clerk), json=supplement(source_id=source_id)).status_code == 404
        accepted = owner.post(path, headers=csrf(owner), json=supplement(source_id=source_id))
        assert accepted.status_code == 200
        assert clerk.post(path, headers=csrf(clerk), json=supplement(source_id=clerk_source)).status_code == 409
        latest = clerk.get(path).json()
        assert latest['version'] == 2
        assert len(latest['items']) == 1
        assert latest['items'][0]['source_id'] is None
        assert latest['items'][0]['result'] == '复测制热正常'
        assert clerk.get(f'/api/sources/{source_id}/original').status_code == 404
        saved = clerk.post(path, headers=csrf(clerk), json=supplement(2, source_id=clerk_source, result='次日回访运行正常'))
        assert saved.status_code == 200, saved.text
        assert owner.get(path).json()['version'] == 3


def test_correction_preserves_previous_fields_and_only_owner_can_void(application):
    with TestClient(application) as owner, TestClient(application) as clerk:
        login(owner)
        create_user(owner, username='sample-clerk', roles=['clerk'])
        login(clerk, {'username': 'sample-clerk', 'password': 'Sample-Stock-Password-123'})
        draft, original = draft_path(owner, address='样例路三号', problem='不制热', model='错录 A1')
        record = archive(owner, draft)
        base = f"/api/service-records/{record['id']}"
        history = f"/api/service-records/contacts/{record['contact_id']}"
        follow_up = photo(owner, picture()).json()['id']
        assert owner.post(base + '/supplements', headers=csrf(owner),
                          json=supplement(source_id=follow_up)).status_code == 200
        correction = {'operation_id': str(uuid4()), 'version': 2, 'kind': 'correct',
                      'reason': '核对铭牌后更正', 'changes': {'model': '正确信息 A2'}, 'confirmed': True}
        assert clerk.post(base + '/revisions', json=correction).status_code == 403
        fixed = clerk.post(base + '/revisions', headers=csrf(clerk), json=correction)
        assert fixed.status_code == 200, fixed.text
        assert fixed.json()['before'] == {'model': '错录 A1'}
        assert fixed.json()['after'] == {'model': '正确信息 A2'}
        assert clerk.post(base + '/revisions', headers=csrf(clerk), json=correction).json() == fixed.json()
        assert owner.post(base + '/supplements', headers=csrf(owner),
                          json=supplement(2, source_id=follow_up)).status_code == 409
        row = owner.get(history).json()['items'][0]
        assert row['fields']['model'] == '正确信息 A2'
        assert row['latest_result'] == '复测制热正常'
        assert owner.get(draft).json()['fields']['model'] == '错录 A1'
        void = {'operation_id': str(uuid4()), 'version': 3, 'kind': 'void',
                'reason': '重复归档', 'confirmed': True}
        assert clerk.post(base + '/revisions', headers=csrf(clerk), json=void).status_code == 403
        voided = owner.post(base + '/revisions', headers=csrf(owner), json=void)
        assert voided.status_code == 200, voided.text
        assert owner.post(base + '/revisions', headers=csrf(owner), json=void).json() == voided.json()
        row = owner.get(history).json()['items'][0]
        assert row['status'] == 'voided' and row['source_id'] == original
        assert owner.get('/api/sources/' + original).status_code == 200
        assert owner.post(base + '/supplements', headers=csrf(owner),
                          json=supplement(4, source_id=follow_up)).status_code == 409
        assert [item['kind'] for item in owner.get(base + '/revisions').json()['items']] == ['void', 'correct']
