from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

from fastapi.testclient import TestClient

from tests.integration.test_auth import create_user, csrf, login


BASE = '/api/work-fees'
WORK = {'kind': 'repair', 'location': '虚构花园一号', 'description': '检查设备'}
REPORT = {'worked_on': '2026-11-11', 'result': '已上门检查，待配件',
          'items': [{'name': '上门', 'quantity': 1, 'amount_cents': 6000}]}


def technician(owner, client, name):
    worker = create_user(owner, username=name, roles=['technician'])
    login(client, {'username': name, 'password': 'Sample-Stock-Password-123'})
    return worker['id']


def post(client, path, **payload):
    return client.post(BASE + path, headers=csrf(client), json=payload)


def report(client):
    result = post(client, '/reports', request_id=str(uuid4()), work=WORK, report=REPORT)
    assert result.status_code == 201, result.text
    return result.json()


def decide(client, fee, action, **values):
    return post(client, f"/{fee['id']}/decisions", operation_id=values.pop('operation_id', str(uuid4())),
                version=fee['version'], confirmed=True, decision={'action': action, **values})


def test_actual_work_report_requires_owner_review(application):
    with TestClient(application) as owner, TestClient(application) as worker:
        login(owner)
        technician(owner, worker, 'demo-worker')
        fee = report(worker)
        assert fee['state'] == 'review'
        assert fee['report']['result'] == '已上门检查，待配件'
        assert fee['claimed_cents'] == 6000
        assert owner.get(BASE).json()['totals']['payable'] == 0
        assert decide(worker, fee, 'approve', amount_cents=5000, reason='按实际核定').status_code == 403
        assert decide(owner, fee, 'approve', amount_cents=5000).status_code == 422
        approved = decide(owner, fee, 'approve', amount_cents=5000, reason='按实际核定')
        assert approved.status_code == 200, approved.text
        assert approved.json()['state'] == 'payable'
        assert approved.json()['confirmed_cents'] == 5000
        history = worker.get(BASE + '/' + fee['id']).json()
        assert history['claimed_cents'] == 6000
        assert history['events'][-1]['decision']['reason'] == '按实际核定'
        assert worker.get(BASE).json()['totals']['payable'] == 5000


def test_shared_work_is_separate_per_worker_and_settlement_is_correctable(application):
    with TestClient(application) as owner, TestClient(application) as first, TestClient(application) as second:
        login(owner)
        a = technician(owner, first, 'demo-worker-a')
        b = technician(owner, second, 'demo-worker-b')
        request = {'request_id': str(uuid4()), 'work': {**WORK, 'kind': 'installation'},
                   'worker_ids': [a, b], 'confirmed': True}
        response = post(owner, '/jobs', **request)
        assert response.status_code == 201, response.text
        assert post(owner, '/jobs', **request).json() == response.json()
        fees = {row['worker_id']: row for row in response.json()['fees']}
        assert first.get(BASE + '/' + fees[b]['id']).status_code == 404
        assert first.get(BASE, params={'worker_id': b}).status_code == 403
        for client, worker_id, amount in ((first, a, 10000), (second, b, 5000)):
            fee = fees[worker_id]
            submitted = client.put(BASE + '/' + fee['id'] + '/report', headers=csrf(client),
                                   json={'operation_id': str(uuid4()), 'version': fee['version'],
                                         'report': {**REPORT, 'items': [{'name': '安装', 'quantity': 1,
                                                                        'amount_cents': amount}]}})
            assert submitted.status_code == 200, submitted.text
            approved = decide(owner, submitted.json(), 'approve', amount_cents=amount)
            assert approved.status_code == 200, approved.text
            fees[worker_id] = approved.json()
        assert decide(first, fees[a], 'paid', occurred_on='2026-11-12', note='样例自记结算').status_code == 403
        assert [row['id'] for row in first.get(BASE).json()['items']] == [fees[a]['id']]
        assert {row['id'] for row in owner.get(BASE).json()['items']} == {fees[a]['id'], fees[b]['id']}
        before = fees[a]
        operation = str(uuid4())
        settled = decide(owner, before, 'deducted', operation_id=operation,
                         occurred_on='2026-11-12', note='老板已核实扣款')
        assert settled.status_code == 200, settled.text
        assert decide(owner, before, 'deducted', operation_id=operation,
                      occurred_on='2026-11-12', note='老板已核实扣款').json() == settled.json()
        assert decide(owner, settled.json(), 'paid', occurred_on='2026-11-12', note='再付一次').status_code == 409
        assert owner.get(BASE).json()['totals'] == {'payable': 5000, 'deducted': 10000, 'paid': 0}
        reopened = decide(owner, settled.json(), 'reopen', reason='确认师傅已全额交回')
        assert reopened.status_code == 200, reopened.text
        assert owner.get(BASE).json()['totals'] == {'payable': 15000, 'deducted': 0, 'paid': 0}
        paid = decide(owner, reopened.json(), 'paid', occurred_on='2026-11-12', note='线下已付')
        assert paid.status_code == 200, paid.text
        history = first.get(BASE + '/' + before['id']).json()
        assert [event['decision']['action'] for event in history['events']][-3:] == ['deducted', 'reopen', 'paid']
        assert history['events'][-2]['decision']['reason'] == '确认师傅已全额交回'
        assert owner.get(BASE).json()['totals'] == {'payable': 5000, 'deducted': 0, 'paid': 10000}
        assert first.get(BASE).json()['items'][0]['work']['id'] == second.get(BASE).json()['items'][0]['work']['id']


def test_concurrent_settlement_has_one_effect(application):
    with TestClient(application) as owner, TestClient(application) as other, TestClient(application) as worker:
        login(owner)
        login(other)
        technician(owner, worker, 'demo-worker')
        approved = decide(owner, report(worker), 'approve', amount_cents=6000).json()
        headers = [csrf(owner), csrf(other)]
        barrier = Barrier(2)

        def settle(client, token, action):
            barrier.wait(timeout=5)
            return client.post(BASE + '/' + approved['id'] + '/decisions', headers=token,
                               json={'operation_id': str(uuid4()), 'version': approved['version'], 'confirmed': True,
                                     'decision': {'action': action, 'occurred_on': '2026-11-12', 'note': '虚构已结'}})

        with ThreadPoolExecutor(max_workers=2) as pool:
            one = pool.submit(settle, owner, headers[0], 'paid')
            two = pool.submit(settle, other, headers[1], 'deducted')
            assert sorted([one.result(timeout=10).status_code, two.result(timeout=10).status_code]) == [200, 409]
        totals = owner.get(BASE).json()['totals']
        assert totals['payable'] == 0 and totals['paid'] + totals['deducted'] == 6000


def test_backfill_uses_verified_boundary_and_preserves_unknown_collection(application):
    with TestClient(application) as owner, TestClient(application) as worker:
        login(owner)
        worker_id = technician(owner, worker, 'demo-worker')
        payload = {'work': WORK, 'worker_id': worker_id, 'cutoff_on': '2026-11-11',
                   'confirmed': True, 'reason': '老板核对旧单'}

        def backfill_input(day, amount, settlement=None):
            return {**payload, 'request_id': str(uuid4()), 'amount_cents': amount, 'settlement': settlement,
                    'report': {**REPORT, 'worked_on': day, 'items': [
                        {'name': '上门', 'quantity': 1, 'amount_cents': amount},
                    ]}}

        previous_day = backfill_input('2026-11-10', 6000)
        assert post(owner, '/backfill', **previous_day).status_code == 422
        assert owner.get(BASE).json()['items'] == []
        deducted = backfill_input('2026-11-11', 12000, {
            'action': 'deducted', 'occurred_on': '2026-11-11', 'note': '按原登记核对',
        })
        paid = backfill_input('2026-11-12', 8000, {
            'action': 'paid', 'occurred_on': '2026-11-12', 'note': '已核实线下付款',
        })
        payable = backfill_input('2026-11-13', 5000)
        for entry in (deducted, paid, payable):
            saved = post(owner, '/backfill', **entry)
            assert saved.status_code == 201, saved.text
            assert post(owner, '/backfill', **entry).json() == saved.json()

        ledger = owner.get(BASE).json()
        fees_by_state = {row['state']: row for row in ledger['items']}
        assert len(ledger['items']) == 3
        assert ledger['totals'] == {'payable': 5000, 'deducted': 12000, 'paid': 8000}
        fee = owner.get(f"{BASE}/{fees_by_state['deducted']['id']}").json()
        assert fee['work']['backfill_from'] == '2026-11-11'
        assert fee['settlement']['amount_cents'] == 12000
        assert fee['settlement']['note'] == '按原登记核对'
        assert fee['settlement']['collected_cents'] is None and fee['settlement']['returned_cents'] is None
        assert decide(owner, fee, 'paid', occurred_on='2026-11-13', note='重复结付').status_code == 409
        assert owner.get(BASE).json()['totals'] == ledger['totals']
        for status, amount in ledger['totals'].items():
            filtered = owner.get(BASE, params={'state': status, 'from_on': '2026-11-11'}).json()
            assert [row['id'] for row in filtered['items']] == [fees_by_state[status]['id']]
            assert filtered['totals'][status] == amount
