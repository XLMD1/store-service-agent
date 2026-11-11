from base64 import b64encode
from dataclasses import replace
from io import BytesIO
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import text

from app.main import create_app
from tests.integration.test_auth import csrf, create_user, login


def picture(format='PNG'):
    with BytesIO() as output:
        Image.new('RGB', (12, 12), 'white').save(output, format)
        return output.getvalue()


def photo(client, data, **metadata):
    payload = {'request_id': str(uuid4()), 'image_base64': b64encode(data).decode('ascii'), **metadata}
    return client.post('/api/sources/photos', headers=csrf(client), json=payload)


def test_photo_preserves_original_and_rechecks_access(application, settings):
    data = picture('JPEG')
    request_id = str(uuid4())
    with TestClient(application) as owner, TestClient(application) as clerk:
        login(owner)
        user = create_user(owner, username='demo-clerk', roles=['clerk'])
        login(clerk, {'username':'demo-clerk','password':'Sample-Stock-Password-123'})
        saved = photo(clerk, data, request_id=request_id, page_label='虚构第 1 页')
        assert saved.status_code == 201, saved.text
        summary = saved.json()
        assert summary['material_type'] == 'photo'
        assert photo(clerk, data, request_id=request_id, page_label='虚构第 1 页').json() == summary
        assert photo(clerk, picture(), request_id=request_id, page_label='虚构第 1 页').status_code == 409
        path = '/api/sources/' + summary['id']
        assert owner.get(path).status_code == 404
        assert owner.get(path + '/original').status_code == 404
        assert clerk.get(path).json()['text'] is None

    restarted = create_app(settings)
    try:
        with TestClient(restarted) as clerk:
            login(clerk, {'username':'demo-clerk','password':'Sample-Stock-Password-123'})
            response = clerk.get(path + '/original')
            assert response.status_code == 200 and response.content == data
            assert response.headers['content-type'] == 'image/jpeg'
            assert response.headers['cache-control'] == 'no-store'
            with restarted.state.sessions.begin() as db:
                db.execute(text("UPDATE user_roles SET role='stock_operator' WHERE user_id=:id"), {'id':user['id']})
            assert clerk.get(path + '/original').status_code == 403
            with restarted.state.sessions.begin() as db:
                db.execute(text('UPDATE users SET enabled=false WHERE id=:id'), {'id':user['id']})
            assert clerk.get(path + '/original').status_code == 401
    finally:
        restarted.state.engine.dispose()


def test_photo_rejects_invalid_oversized_and_unpersisted_uploads(application, tmp_path):
    with TestClient(application) as client:
        login(client)
        assert client.post('/api/sources/photos', json={}).status_code == 403
        assert photo(client, b'not an image').status_code == 422
        assert photo(client, picture()[:30]).status_code == 422
        assert photo(client, picture('GIF')).status_code == 422
        application.state.settings = replace(application.state.settings, source_photo_max_bytes=128)
        assert photo(client, b'x' * 129).status_code == 413
        assert client.post('/api/sources/photos', headers=csrf(client), content=b'x' * 16384).status_code == 413
        bad_root = tmp_path / 'file-not-directory'
        bad_root.write_bytes(b'x')
        application.state.settings = replace(application.state.settings, source_photo_max_bytes=2048,
                                             source_files_dir=str(bad_root))
        assert photo(client, picture()).status_code == 503
        assert client.get('/api/sources').json()['items'] == []


def test_missing_original_keeps_metadata_and_same_upload_can_restore(application, settings):
    with TestClient(application) as client:
        login(client)
        data = picture()
        request_id = str(uuid4())
        saved = photo(client, data, request_id=request_id).json()
        path = '/api/sources/' + saved['id']
        original = Path(settings.source_files_dir) / (saved['id'] + '.original')
        original.unlink()
        assert client.get(path).status_code == 200
        assert client.get(path + '/original').status_code == 503
        assert photo(client, data, request_id=request_id).json() == saved
        assert client.get(path + '/original').content == data
