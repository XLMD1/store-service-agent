from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import create_app
from tests.integration.test_auth import csrf, create_user, login
from tests.integration.test_sources import source_payload, submit


def draft_path(client, **fields):
    source = submit(client, source_payload()).json()
    path = f"/api/sources/{source['id']}/drafts"
    draft = client.post(path, headers=csrf(client), json={'request_id': str(uuid4()), 'fields': fields})
    assert draft.status_code == 201, draft.text
    return path + '/' + draft.json()['id'], source['id']


def preview(client, path, version=1, contact_id=None):
    association = {'contact_id': contact_id} if contact_id else {'create_new': True}
    return client.post(path + '/archive-preview', headers=csrf(client),
                       json={'version': version, **association})


def confirm(client, path, operation):
    return client.post(path + '/archive-confirm', headers=csrf(client),
                       json={'operation_id': operation, 'confirmed': True})


def search(client, query):
    result = client.post('/api/service-records/search', headers=csrf(client), json={'q': query})
    assert result.status_code == 200, result.text
    return result.json()


def archive(client, path, **options):
    reviewed = preview(client, path, **options)
    assert reviewed.status_code == 200, reviewed.text
    result = confirm(client, path, reviewed.json()['operation_id'])
    assert result.status_code == 200, result.text
    return result.json()


def test_archive_search_keeps_same_phone_addresses_separate(application, settings):
    with TestClient(application) as client:
        login(client)
        first, source_id = draft_path(client, phone='138 0000 0000', address='虚构花园一号',
                                      problem='无法启动', treatment='检查供电')
        one = archive(client, first)
        second, _ = draft_path(client, phone='13800000000', address='虚构花园二号', problem='不制热')
        two = archive(client, second)
        assert one['contact_id'] != two['contact_id']
        third, _ = draft_path(client, phone='13800000000', address='虚构花园二号', problem='二次报修')
        archive(client, third, contact_id=two['contact_id'])

    restarted = create_app(settings)
    try:
        with TestClient(restarted) as client:
            login(client)
            assert {item['address'] for item in search(client, '13800000000')['items']} == {'虚构花园一号', '虚构花园二号'}
            assert [row['id'] for row in search(client, '花园二号')['items']] == [two['contact_id']]
            result = client.get(f"/api/service-records/contacts/{one['contact_id']}")
            [row] = result.json()['items']
            assert row['fields']['problem'] == '无法启动'
            assert row['fields']['repair_date'] is None
            assert row['source_id'] == source_id
            assert client.get('/api/sources/' + source_id).status_code == 200
            assert client.get(f"/api/service-records/contacts/{two['contact_id']}").json()['items'][0]['fields']['problem'] == '二次报修'
            assert search(client, '从未存在的地址')['items'] == []
    finally:
        restarted.state.engine.dispose()


def test_archive_requires_valid_current_confirm_and_only_writes_once(application):
    with TestClient(application) as client:
        login(client)
        path, _ = draft_path(client, phone='138…45', uncertain_fields=['phone'], problem='虚构问题')
        assert preview(client, path).status_code == 422
        fields = {'phone': '138…45', 'address': '虚构街道', 'problem': '虚构问题', 'uncertain_fields': ['phone']}
        assert client.put(path, headers=csrf(client), json={'version': 1, 'fields': fields}).status_code == 200
        original = preview(client, path, version=2).json()['operation_id']
        assert client.put(path, headers=csrf(client), json={'version': 2, 'fields': fields}).status_code == 200
        assert confirm(client, path, original).status_code == 409
        current = preview(client, path, version=3).json()['operation_id']
        assert client.post(path + '/archive-confirm', json={'operation_id': current, 'confirmed': True}).status_code == 403
        assert client.post(path + '/archive-confirm', headers=csrf(client),
                           json={'operation_id': current, 'confirmed': False}).status_code == 422
        result = confirm(client, path, current)
        assert result.status_code == 200, result.text
        assert confirm(client, path, current).json() == result.json()
        assert confirm(client, path, str(uuid4())).status_code == 409
        assert client.get(path).json()['state'] == 'archived'
        assert client.put(path, headers=csrf(client), json={'version': 3, 'fields': fields}).status_code == 409
        assert search(client, '13845')['items'] == []


def test_archive_access_respects_confirmation_and_original_source_permissions(application):
    with TestClient(application) as owner, TestClient(application) as tech:
        login(owner)
        create_user(owner, username='demo-tech', roles=['technician'])
        login(tech, {'username': 'demo-tech', 'password': 'Sample-Stock-Password-123'})
        tech_path, _ = draft_path(tech, address='虚构地址', problem='虚构问题')
        assert preview(tech, tech_path).status_code == 403
        path, source = draft_path(owner, address='虚构地址', problem='虚构问题')
        assert preview(tech, path).status_code == 404
        saved = archive(owner, path)
        timeline = tech.get(f"/api/service-records/contacts/{saved['contact_id']}").json()['items']
        assert timeline[0]['source_id'] is None
        assert tech.get('/api/sources/' + source).status_code == 404
