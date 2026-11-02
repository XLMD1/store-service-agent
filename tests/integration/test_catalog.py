from fastapi.testclient import TestClient

from tests.integration.test_auth import csrf, login, create_user
from tests.integration.test_inventory_opening import add


def test_catalog_requires_owner_and_preserves_versions(application):
    with TestClient(application) as client:
        login(client)
        item = add(client, 'warehouses', {'code': 'DEMO-1', 'name': '示例库'})
        assert item['version'] == 1
        url = '/api/catalog/warehouses/' + item['id']
        assert client.patch(url, headers=csrf(client), json={
            'expected_version': 1, 'name': '示例库改名', 'confirmed': True}).json()['version'] == 2
        assert client.patch(url, headers=csrf(client), json={
            'expected_version': 1, 'enabled': False, 'confirmed': True}).status_code == 409
        assert client.patch(url, headers=csrf(client), json={
            'expected_version': 2, 'enabled': False, 'confirmed': True}).status_code == 200
        assert client.get('/api/catalog/warehouses').json()[0]['id'] == item['id']
        assert client.delete(url, headers=csrf(client)).status_code == 405
        create_user(client, roles=['technician'])
    with TestClient(application) as worker:
        login(worker, {'username': 'demo-stock', 'password': 'Sample-Stock-Password-123'})
        assert worker.get('/api/catalog/models').status_code == 200
        assert worker.post('/api/catalog/models', headers=csrf(worker), json={
            'name': 'unauthorized', 'confirmed': True}).status_code == 403


def test_catalog_confirmation_unknown_fields_and_duplicate_are_rejected(application):
    with TestClient(application) as client:
        login(client)
        for extra in [{'confirmed': False}, {'actor_id': 'spoofed'}]:
            assert client.post('/api/catalog/models', headers=csrf(client), json={
                'name': '示例型号', 'confirmed': True, **extra}).status_code == 422
        first = add(client, 'models', {'name': '示例型号'})
        assert client.post('/api/catalog/models', headers=csrf(client), json={
            'name': '示例型号', 'confirmed': True}).status_code == 409
        assert client.get('/api/catalog/models').json() == [first]
