from base64 import b64encode
from io import BytesIO
from uuid import uuid4

from fastapi.testclient import TestClient
from PIL import Image

from tests.integration.test_auth import create_user, csrf, login


PATH = '/api/knowledge/versions'


def image_bytes():
    image = Image.new('RGB', (8, 30), 'white')
    image.paste('red', (0, 10, 8, 20))
    image.paste('blue', (0, 20, 8, 30))
    output = BytesIO()
    image.save(output, format='PNG')
    return output.getvalue()


def import_data(**overrides):
    return {'request_id': str(uuid4()), 'confirmed': True, 'title': '虚构维修资料', 'document_code': 'SAMPLE',
            'edition': 'B', 'models': ['SAMPLE-1', 'SAMPLE-2'],
            'scans': [{'first_page': 1, 'last_page': 2, 'leading_pages': 1,
                       'image_base64': b64encode(image_bytes()).decode()}], **overrides}


def create_version(client, payload):
    response = client.post(PATH, headers=csrf(client), json=payload)
    assert response.status_code == 201, response.text
    return PATH + '/' + response.json()['id']


def transition_data(action, version):
    return {'operation_id': str(uuid4()), 'action': action, 'version': version, 'confirmed': True,
            'note': '虚构样例已核对'}


def transition(client, path, payload):
    return client.post(path + '/transition', headers=csrf(client), json=payload)


def sign_in(client, username):
    login(client, {'username': username, 'password': 'Sample-Stock-Password-123'})


def test_scan_import_preserves_original_and_printed_page_number(application):
    with TestClient(application) as owner:
        login(owner)
        payload = import_data()
        assert owner.post(PATH, json=payload).status_code == 403
        invalid = {**payload, 'scans': [{**payload['scans'][0], 'last_page': 3}]}
        assert owner.post(PATH, headers=csrf(owner), json=invalid).status_code == 422
        assert owner.get(PATH).json()['items'] == []
        path = create_version(owner, payload)
        assert create_version(owner, payload) == path
        assert owner.post(PATH, headers=csrf(owner), json={**payload, 'title': '修改标题'}).status_code == 409
        assert owner.post(PATH, headers=csrf(owner), json=import_data()).status_code == 409
        assert owner.get(path + '/scans/1').content == image_bytes()
        page = owner.get(path + '/pages/2')
        assert page.headers['cache-control'] == 'no-store'
        with Image.open(BytesIO(page.content)) as image:
            assert image.size == (8, 10)
            assert image.getpixel((0, 0)) == (0, 0, 255)
        assert owner.get(path + '/pages/3').status_code == 404
        data = owner.get(path).json()
        assert data['state'] == 'pending_review'
        assert data['models'] == payload['models']
        assert data['scans'] == [{'position': 1, 'first_page': 1, 'last_page': 2,
                                  'leading_pages': 1, 'trailing_pages': 0}]


def test_review_and_publish_permissions_preserve_retired_originals(application):
    with TestClient(application) as owner, TestClient(application) as worker, TestClient(application) as clerk:
        login(owner)
        create_user(owner, 'sample-technician', ['technician'])
        create_user(owner, 'sample-clerk', ['clerk'])
        sign_in(worker, 'sample-technician')
        sign_in(clerk, 'sample-clerk')
        assert clerk.post(PATH, headers=csrf(clerk), json=import_data()).status_code == 403
        path = create_version(owner, import_data())
        assert clerk.get(path).status_code == 404
        assert clerk.get(path + '/pages/1').status_code == 404
        assert clerk.get(path + '/scans/1').status_code == 404
        assert owner.get(path).json()['state'] == 'pending_review'

        review = transition_data('review', 1)
        assert transition(owner, path, review).status_code == 403
        assert transition(owner, path, transition_data('publish', 1)).status_code == 409
        assert transition(worker, path, {**review, 'confirmed': False}).status_code == 422
        reviewed = transition(worker, path, review)
        assert reviewed.status_code == 200, reviewed.text
        assert transition(worker, path, review).json() == reviewed.json()
        assert transition(worker, path, transition_data('publish', 2)).status_code == 403
        assert transition(owner, path, transition_data('publish', 1)).status_code == 409
        assert transition(owner, path, transition_data('publish', 2)).json()['state'] == 'published'
        assert len(clerk.get(PATH).json()['items']) == 1
        assert clerk.get(path + '/pages/1').status_code == 200

        next_path = create_version(owner, import_data(edition='C'))
        assert transition(worker, next_path, transition_data('review', 1)).status_code == 200
        assert transition(owner, next_path, transition_data('publish', 2)).status_code == 409
        assert transition(owner, path, transition_data('retire', 3)).json()['state'] == 'retired'
        assert clerk.get(PATH).json()['items'] == []
        assert clerk.get(path + '/scans/1').content == image_bytes()
        assert transition(owner, next_path, transition_data('publish', 2)).status_code == 200
        actions = [event['action'] for event in owner.get(path).json()['events']]
        assert actions == ['review', 'publish', 'retire']
