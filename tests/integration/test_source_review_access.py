from uuid import uuid4

from fastapi.testclient import TestClient

from tests.integration.test_auth import csrf, create_user, login
from tests.integration.test_service_archive import archive, confirm, draft_path, preview
from tests.integration.test_source_photos import photo, picture


def sign_in(client, username):
    login(client, {'username': username, 'password': 'Sample-Stock-Password-123'})


def test_source_handoff_scopes_access_and_keeps_archives_separate(application):
    with TestClient(application) as owner, TestClient(application) as clerk, TestClient(application) as tech:
        login(owner)
        create_user(owner, 'review-clerk', ['clerk'])
        create_user(owner, 'review-tech', ['technician'])
        create_user(owner, 'review-stock', ['stock_operator'])
        sign_in(clerk, 'review-clerk')
        sign_in(tech, 'review-tech')
        draft, source_id = draft_path(owner, problem='虚构维修', address='样例街道 1 号')
        other, _ = draft_path(owner, problem='另一份原件', address='样例街道 2 号')
        source = f'/api/sources/{source_id}'
        access = source + '/review-access'
        clerk_request = {'username': 'review-clerk', 'confirmed': True, 'request_id': str(uuid4())}

        assert clerk.get(source).status_code == 404
        assert clerk.get(draft).status_code == 404
        assert clerk.post(access, headers=csrf(clerk),
                          json=clerk_request).status_code == 404
        assert owner.post(access, json=clerk_request).status_code == 403
        assert owner.post(access, headers=csrf(owner),
                          json={**clerk_request, 'confirmed': False}).status_code == 422
        assert owner.post(access, headers=csrf(owner),
                          json={**clerk_request, 'username': 'review-stock'}).status_code == 422

        def grant(payload):
            result = owner.post(access, headers=csrf(owner), json=payload)
            assert result.status_code == 200, result.text
            return result.json()

        granted = grant(clerk_request)
        assert grant(clerk_request) == granted
        grant({**clerk_request, 'username': 'review-tech', 'request_id': str(uuid4())})
        assert {row['username'] for row in owner.get(access).json()['items']} == {'review-clerk', 'review-tech'}
        assert clerk.get('/api/sources').json()['items'] == []
        shared = clerk.get('/api/sources?scope=shared').json()
        assert shared['supports_review_access']
        assert [(row['id'], row['can_delete']) for row in shared['items']] == [(source_id, False)]
        assert clerk.get(source).json()['owned_by_viewer'] is False
        assert owner.get(source).json()['owned_by_viewer'] is True
        assert clerk.get(draft).status_code == 200
        assert clerk.get(other).status_code == 404
        assert clerk.get(access).status_code == 404
        assert clerk.request('DELETE', source, headers=csrf(clerk), json={'confirmed': True}).status_code == 404
        assert tech.get(draft).status_code == 200
        assert preview(tech, draft).status_code == 403
        second = tech.post(source + '/drafts', headers=csrf(tech),
                           json={'request_id': str(uuid4()), 'fields': {'problem': '同份原件的第二条维修'}})
        assert second.status_code == 201
        second_path = source + '/drafts/' + second.json()['id']
        edited = tech.put(second_path, headers=csrf(tech),
                          json={'version': 1, 'fields': {'problem': '核对维修结果'}})
        assert edited.status_code == 200
        assert owner.get(second_path).json()['version'] == 2
        assert clerk.get(second_path).status_code == 200

        reviewed = preview(clerk, draft)
        assert reviewed.status_code == 200, reviewed.text
        operation = reviewed.json()['operation_id']
        revoke = access + '/' + granted['id']
        for _ in range(2):
            assert owner.request('DELETE', revoke, headers=csrf(owner), json={'confirmed': True}).status_code == 204
        assert clerk.get(source).status_code == 404
        assert clerk.get(draft).status_code == 404
        assert clerk.get(second_path).status_code == 404
        assert clerk.get('/api/sources?scope=shared').json()['items'] == []
        assert confirm(clerk, draft, operation).status_code == 404
        assert owner.post(access, headers=csrf(owner), json=clerk_request).status_code == 409
        assert clerk.get(source).status_code == 404
        assert grant({**clerk_request, 'request_id': str(uuid4())})['id'] != granted['id']
        assert confirm(clerk, draft, operation).status_code == 409

        entry = archive(clerk, draft)
        history = '/api/service-records/contacts/' + entry['contact_id']
        assert tech.get(history).json()['items'][0]['source_id'] == source_id
        unshared = archive(owner, other)
        history = '/api/service-records/contacts/' + unshared['contact_id']
        assert clerk.get(history).json()['items'][0]['source_id'] is None


def test_reenabling_reviewer_requires_a_new_handoff(application):
    with TestClient(application) as owner, TestClient(application) as clerk:
        login(owner)
        account = create_user(owner, 'review-clerk', ['clerk'])
        sign_in(clerk, 'review-clerk')
        image = picture()
        source_id = photo(owner, image).json()['id']
        source = f'/api/sources/{source_id}'
        access = source + '/review-access'
        account_path = '/api/accounts/' + account['id']
        assert clerk.get(source + '/original').status_code == 404
        payload = {'username': 'review-clerk', 'confirmed': True, 'request_id': str(uuid4())}
        assert owner.post(access, headers=csrf(owner), json=payload).status_code == 200
        assert clerk.get(source + '/original').content == image
        for enabled in [False, True]:
            assert owner.patch(account_path, headers=csrf(owner),
                               json={'enabled': enabled, 'confirmed': True}).status_code == 200
        sign_in(clerk, 'review-clerk')
        assert clerk.get(source).status_code == 404
        assert clerk.get(source + '/original').status_code == 404
        assert owner.get(access).json()['items'] == []
