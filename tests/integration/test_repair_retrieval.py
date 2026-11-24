from fastapi.testclient import TestClient

from tests.integration.test_auth import create_user, csrf, login
from tests.integration.test_knowledge_versions import create_version, import_data, sign_in, transition, transition_data


SEARCH = '/api/knowledge/search'


def search(client, model, query):
    response = client.post(SEARCH, headers=csrf(client), json={'model': model, 'query': query})
    assert response.status_code == 200, response.text
    return response.json()


def test_search_filters_live_model_and_exact_fault_code_and_retains_original_link(application):
    with TestClient(application) as owner, TestClient(application) as worker, TestClient(application) as reader:
        login(owner)
        create_user(owner, 'sample-reviewer', ['technician'])
        create_user(owner, 'sample-reader', ['clerk'])
        sign_in(worker, 'sample-reviewer')
        sign_in(reader, 'sample-reader')
        record = create_version(owner, import_data(models=['SAMPLE-1']))
        index = record + '/pages/2/index'
        entry = {'title': '故障与异常', 'keywords': 'E30 流量不足、E3温度传感器',
                 'revision': 0, 'confirmed': True}
        assert reader.get(SEARCH + '/models').json() == {'models': []}
        assert worker.put(index, headers=csrf(worker), json=entry).status_code == 409
        assert transition(worker, record, transition_data('review', 1)).status_code == 200
        assert transition(owner, record, transition_data('publish', 2)).status_code == 200
        assert reader.get(SEARCH + '/models').json() == {'models': ['SAMPLE-1']}
        assert search(reader, 'SAMPLE-1', 'E3')['status'] == 'no_index'
        assert reader.put(index, headers=csrf(reader), json=entry).status_code == 403
        assert worker.put(record + '/pages/3/index', headers=csrf(worker), json=entry).status_code == 404
        assert worker.put(index, headers=csrf(worker), json={**entry, 'confirmed': False}).status_code == 422
        saved = worker.put(index, headers=csrf(worker), json=entry)
        assert saved.status_code == 200, saved.text
        assert saved.json()['revision'] == 1
        assert worker.put(index, headers=csrf(worker), json=entry).json() == saved.json()
        assert worker.put(index, headers=csrf(worker), json={**entry, 'title': '其他标题'}).status_code == 409

        alternative = record + '/pages/1/index'
        assert worker.put(alternative, headers=csrf(worker),
                          json={**entry, 'keywords': 'E30流量不足'}).status_code == 200
        hits = search(reader, 'SAMPLE-1', 'Ｅ３ 温度')['items']
        assert [row['page'] for row in hits] == [2]
        assert hits[0]['edition'] == 'B'
        assert hits[0]['original_url'] == record + '/pages/2'
        assert reader.get(hits[0]['original_url']).status_code == 200
        assert [row['page'] for row in search(reader, 'SAMPLE-1', 'E3')['items']] == [2]
        assert search(reader, 'SAMPLE-10', 'E3')['status'] == 'unsupported_model'
        assert search(reader, 'SAMPLE-1', '不存在的术语')['status'] == 'no_match'
        assert reader.post(SEARCH, json={'model': 'SAMPLE-1', 'query': 'E3'}).status_code == 403

        assert transition(owner, record, transition_data('retire', 3)).status_code == 200
        assert search(reader, 'SAMPLE-1', 'E3')['items'] == []
        assert reader.get(hits[0]['original_url']).status_code == 200
