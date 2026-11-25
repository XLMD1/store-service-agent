from uuid import uuid4

from fastapi.testclient import TestClient

from tests.integration.test_auth import create_user, csrf, login
from tests.integration.test_knowledge_versions import create_version, import_data, sign_in, transition, transition_data


def test_case_review_is_confirmed_traceable_and_separate(application):
    path = '/api/repair/cases'
    case = {'model': 'SAMPLE-A', 'problem': 'E3', 'conditions': 'Sample display',
            'outcome': '样例经验声称 E3 表示供水异常，与传感器无关。', 'confirmed': True, 'request_id': str(uuid4())}
    review = {'decision': 'reviewed', 'note': 'Sample review', 'confirmed': True, 'request_id': str(uuid4())}
    with TestClient(application) as owner, TestClient(application) as tech, TestClient(application) as clerk:
        login(owner)
        create_user(owner, 'case-tech', ['technician'])
        create_user(owner, 'case-clerk', ['clerk'])
        sign_in(tech, 'case-tech')
        sign_in(clerk, 'case-clerk')

        def post(client, url, payload):
            return client.post(url, headers=csrf(client), json=payload)

        manual = create_version(owner, import_data(models=['SAMPLE-A']))
        assert transition(tech, manual, transition_data('review', 1)).status_code == 200
        assert transition(owner, manual, transition_data('publish', 2)).status_code == 200
        definition = 'E3：样例传感器故障'
        application.state.knowledge_ocr = lambda _: '样例故障码表\n' + definition
        drafts = manual + '/index-drafts'
        assert post(tech, drafts + '/recognize', {'first_page': 1, 'last_page': 1}).status_code == 200
        index = {'page': 1, 'revision': 0, 'title': '样例故障码表', 'keywords': 'E3', 'source_excerpt': definition}
        assert post(tech, drafts + '/confirm', {'confirmed': True, 'entries': [index]}).status_code == 200

        def assert_manual_answer():
            answer = post(clerk, '/api/repair/ask', {'model': 'SAMPLE-A', 'problem': 'E3'}).json()
            assert answer['status'] == 'answered' and answer['origin'] == 'manual'
            assert answer['points'] == [{'kind': 'meaning', 'source': 1, 'quote': definition, 'condition': ''}]
            assert [item['original_url'] for item in answer['sources']] == [manual + '/pages/1']
            assert answer['passages'] == [{'source': 1, 'text': definition}]

        assert_manual_answer()
        assert post(clerk, path, case).status_code == 403
        assert post(tech, path, {**case, 'confirmed': False}).status_code == 422
        submitted = post(tech, path, case)
        assert submitted.status_code == 201, submitted.text
        row = submitted.json()
        assert row['state'] == 'pending_review' and row['submitted_by'] == 'case-tech'
        assert post(tech, path, case).json() == row
        assert post(tech, path, {**case, 'model': 'changed'}).status_code == 409
        assert clerk.get(path).json()['items'] == []
        assert owner.get(path, params={'model': 'SAMPLE-A', 'state': 'pending_review'}).json()['items'] == [row]
        assert_manual_answer()
        url = f"{path}/{row['id']}/review"
        assert post(clerk, url, review).status_code == 403
        assert post(owner, url, {**review, 'confirmed': False}).status_code == 422
        accepted = post(owner, url, review)
        assert accepted.status_code == 200, accepted.text
        approved = accepted.json()
        assert approved['reviewed_by'] == 'demo-owner' and approved['reviewed_at']
        assert approved['state'] == 'reviewed' and approved['review_note'] == review['note']
        assert post(owner, url, review).json() == approved
        assert post(owner, url, {**review, 'decision': 'rejected'}).status_code == 409
        assert clerk.get(path, params={'model': 'SAMPLE-A', 'state': 'reviewed'}).json()['items'] == [approved]
        assert clerk.get(path, params={'model': 'SAMPLE-AB'}).json()['items'] == []
        assert_manual_answer()
        second = post(tech, path, {**case, 'request_id': str(uuid4())}).json()
        second_url = f"{path}/{second['id']}/review"
        assert post(owner, second_url, review).status_code == 409
        rejected = post(owner, second_url, {**review, 'decision': 'rejected', 'request_id': str(uuid4())})
        assert rejected.json()['state'] == 'rejected'
        assert clerk.get(path).json()['items'] == [approved]
