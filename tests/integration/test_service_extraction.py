from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import text

from app.main import create_app
from tests.integration.test_auth import csrf, create_user, login
from tests.integration.test_source_photos import photo, picture
from tests.integration.test_sources import source_payload, submit


SAMPLE = '客户：样例甲\n电话：138…45\n问题：不点火\n\n地址：样例路 2 号\n故障：不制热\n维修日期：2025年7月'


def extraction(client, source):
    return client.post(f"/api/sources/{source}/drafts/extract", headers=csrf(client))


def test_text_extraction_saves_independent_drafts_and_recovers_after_restart(application, settings):
    with TestClient(application) as client:
        login(client)
        source = submit(client, source_payload(text=SAMPLE)).json()['id']
        path = f'/api/sources/{source}/drafts'
        assert client.post(path + '/extract').status_code == 403
        result = extraction(client, source)
        assert result.status_code == 200, result.text
        ids = result.json()['draft_ids']
        assert len(set(ids)) == 2
        first, second = [client.get(f'{path}/{draft_id}').json() for draft_id in ids]
        assert first['state'] == second['state'] == 'needs_review'
        assert first['fields']['phone'] == '138…45'
        assert first['fields']['uncertain_fields'] == ['phone']
        assert first['fields']['repair_date'] is None
        assert second['fields']['repair_date'] == '2025-07'
        assert second['fields']['repair_date_precision'] == 'month'
        assert client.get('/api/sources/' + source).json()['text'] == SAMPLE
        assert extraction(client, source).json() == result.json()
    reopened = create_app(settings)
    try:
        with TestClient(reopened) as client:
            login(client)
            assert extraction(client, source).json() == result.json()
            assert len(client.get(path).json()['items']) == 2
    finally:
        reopened.state.engine.dispose()


def test_photo_failure_keeps_original_and_allows_retry(application):
    def failure(_):
        raise OSError('fake failure')

    application.state.service_ocr = failure
    with TestClient(application) as client:
        login(client)
        original = picture()
        source = photo(client, original).json()['id']
        assert extraction(client, source).status_code == 503
        assert client.get(f'/api/sources/{source}/drafts').json()['items'] == []
        assert client.get(f'/api/sources/{source}/original').content == original
        application.state.service_ocr = lambda data: '第 1 条\n客 户 ： 样 例 甲\n第 2 条\n问 题 ： 不 制 热' if data == original else ''
        result = extraction(client, source)
        assert result.status_code == 200, result.text
        first, second = result.json()['draft_ids']
        fields = client.get(f'/api/sources/{source}/drafts/{first}').json()['fields']
        assert fields['customer_name'] == '样例甲'
        assert fields['uncertain_fields'] == ['customer_name']
        assert client.get(f'/api/sources/{source}/drafts/{second}').json()['fields']['problem'] == '不制热'


@pytest.mark.parametrize('raw', ['样例客户说不制热', '客户：样例甲\n客户：样例乙'])
def test_unrecognized_or_ambiguous_text_leaves_manual_draft_available(application, raw):
    with TestClient(application) as client:
        login(client)
        source = submit(client, source_payload(text=raw)).json()['id']
        path = f'/api/sources/{source}/drafts'
        assert extraction(client, source).status_code == 422
        assert client.get(path).json()['items'] == []
        manual = client.post(path, headers=csrf(client), json={
            'request_id': str(uuid4()), 'fields': {'problem': '手工核对后的描述'},
        })
        assert manual.status_code == 201


def test_revocation_during_ocr_prevents_saving_drafts(application):
    with TestClient(application) as owner, TestClient(application) as clerk:
        login(owner)
        user = create_user(owner, username='sample-clerk', roles=['clerk'])
        login(clerk, {'username': 'sample-clerk', 'password': 'Sample-Stock-Password-123'})
        source = photo(clerk, picture()).json()['id']
        assert extraction(owner, source).status_code == 404

        def revoke(_):
            with application.state.sessions.begin() as db:
                db.execute(text("UPDATE user_roles SET role='stock_operator' WHERE user_id=:id"), {'id': user['id']})
            return SAMPLE

        application.state.service_ocr = revoke
        assert extraction(clerk, source).status_code == 403
        with application.state.sessions() as db:
            assert db.scalar(text('SELECT count(*) FROM service_record_drafts')) == 0


def test_concurrent_photo_extraction_keeps_one_result_and_preserves_manual_drafts(application):
    barrier = Barrier(2, timeout=10)

    def recognize(_):
        barrier.wait()
        return SAMPLE

    application.state.service_ocr = recognize
    with TestClient(application) as first, TestClient(application) as second:
        login(first)
        login(second)
        source = photo(first, picture()).json()['id']
        path = f'/api/sources/{source}/drafts'
        manual = first.post(path, headers=csrf(first), json={
            'request_id': str(uuid4()), 'fields': {'problem': '手工记录'},
        })
        assert manual.status_code == 201, manual.text
        with ThreadPoolExecutor(2) as pool:
            responses = list(pool.map(lambda client: extraction(client, source), (first, second)))
        assert all(response.status_code == 200 for response in responses)
        ids = responses[0].json()['draft_ids']
        assert responses[1].json()['draft_ids'] == ids
        drafts = first.get(path).json()['items']
        assert {draft['id'] for draft in drafts} == {manual.json()['id'], *ids}
        saved_manual = first.get(path + '/' + manual.json()['id']).json()
        assert saved_manual == manual.json()
