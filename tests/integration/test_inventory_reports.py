from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import text

from tests.integration.test_auth import csrf, login, create_user
from tests.integration.test_inventory_opening import opening, draft, confirm, add
from tests.integration.test_inventory_operations import opened, inbound
from tests.integration.test_inventory_reservations import reservation_action
from tests.integration.test_inventory_opening import balance


def statistics(client, params, **extra):
    return client.get('/api/inventory/statistics', params={
        'start': '2026-10-02', 'end': '2026-10-02',
        'warehouse_id': params['warehouse_id'], 'model_id': params['model_id'], **extra})


def test_statistics_uses_effective_inbound_only_and_beijing_inclusive_dates(opened):
    client, params = opened
    first = confirm(client, inbound(client, params)).json()
    second = {**params, 'quantity': 8, 'occurred': {'precision': 'datetime', 'at': '2026-10-02T15:59:59+00:00'}}
    assert confirm(client, inbound(client, second)).status_code == 200
    outside = {**params, 'quantity': 9, 'occurred': {'precision': 'datetime', 'at': '2026-10-02T16:00:00+00:00'}}
    assert confirm(client, inbound(client, outside)).status_code == 200
    for group in ['date', 'warehouse', 'model']:
        response = statistics(client, params, group_by=group)
        assert response.status_code == 200, response.text
        result = response.json()
        assert result['total_quantity'] == 13
        assert len(result['documents']) == 2 and sum(x['quantity'] for x in result['groups']) == 13
        assert len(result['groups']) == 1
        assert result['coverage'][0]['coverage_status'] == 'covered'
        assert result['queried_at']
    result = statistics(client, params, start='2026-10-03', end='2026-10-03').json()
    assert result['total_quantity'] == 9
    docs = client.get('/api/inventory/documents', params={'warehouse_id': params['warehouse_id']}).json()
    assert len(docs) == 3 and first['business_id'] in [row['id'] for row in docs]
    assert all(row['kind'] == 'inbound' and row['corrections'] == [] for row in docs)


def test_statistics_distinguishes_before_t0_zero_and_uninitialized(opened):
    client, params = opened
    before = statistics(client, params, start='2026-09-01', end='2026-09-30').json()
    assert before['total_quantity'] == 0 and before['coverage'][0]['coverage_status'] == 'before_t0'
    same_day = statistics(client, params, start='2026-10-01', end='2026-10-01').json()
    assert same_day['coverage'][0]['coverage_status'] == 'partial'
    zero = statistics(client, params).json()
    assert zero['total_quantity'] == 0 and zero['coverage'][0]['status'] == 'opened'
    model = add(client, 'models', {'name': '未建账统计示例型号'})
    unknown = statistics(client, params, model_id=model['id']).json()
    assert unknown['total_quantity'] == 0 and unknown['coverage'][0]['coverage_status'] == 'uninitialized'
    assert unknown['coverage'][0]['t0'] is None


def test_report_validation_and_reconciliation_permission(application, opened):
    client, params = opened
    assert statistics(client, params, start='2026-10-03', end='2026-10-02').status_code == 422
    assert statistics(client, params, group_by='invalid').status_code == 422
    assert statistics(client, params, warehouse_id=str(uuid4())).status_code == 404
    assert client.get('/api/inventory/documents', params={'model_id': str(uuid4())}).status_code == 404
    create_user(client, roles=['technician'])
    with TestClient(application) as worker:
        assert worker.get('/api/inventory/statistics', params={'start': '2026-10-01', 'end': '2026-10-02'}).status_code == 401
        login(worker, {'username': 'demo-stock', 'password': 'Sample-Stock-Password-123'})
        assert statistics(worker, params).status_code == 200
        assert worker.get('/api/inventory/documents').status_code == 200
        assert worker.get('/api/inventory/reconciliation').status_code == 403


def test_reconciliation_checks_ledger_and_reservation_sums_and_unknown(application, opened):
    client, params = opened
    model = add(client, 'models', {'name': '未建账对账示例型号'})
    response = client.get('/api/inventory/reconciliation', params={'warehouse_id': params['warehouse_id']})
    assert response.status_code == 200, response.text
    result = response.json()
    rows = {row['model']['id']: row for row in result['items']}
    item = rows[params['model_id']]
    assert item['consistent'] and result['consistent']
    assert (item['on_hand'], item['ledger_on_hand'], item['reserved'], item['ledger_reserved'], item['reservation_remaining']) == (10, 10, 3, 3, 3)
    assert rows[model['id']]['status'] == 'uninitialized' and rows[model['id']]['consistent'] is None
    with application.state.sessions.begin() as db:
        db.execute(text('UPDATE inventory_accounts SET on_hand=11'))
    broken = client.get('/api/inventory/reconciliation').json()
    assert broken['consistent'] is False
    assert any(row['on_hand'] == 11 and row['consistent'] is False for row in broken['items'])


def test_statistics_corrections_retain_original_date_and_do_not_count_adjustments(application, opened):
    client, params = opened
    receipt = confirm(client, inbound(client, params)).json()
    body = {'kind': 'inventory_adjustment', 'parameters': {
        'warehouse_id': params['warehouse_id'], 'model_id': params['model_id'], 'on_hand': 18,
        'occurred': {'precision': 'date', 'date': '2026-10-03'}, 'basis_note': '虚构盘点核对'}}
    response = client.post('/api/drafts', headers=csrf(client), json=body)
    assert response.status_code == 201, response.text
    assert confirm(client, response.json()).status_code == 200
    selected=balance(client,params)['reservations'][0]['id']
    assert confirm(client,reservation_action(client,'reservation_pickup',selected,2)).status_code==200
    correction = client.post('/api/drafts', headers=csrf(client), json={
        'kind': 'inventory_correction', 'parameters': {'document_id': receipt['business_id'],
            'new_quantity': 4, 'basis_note': '虚构原入库5更正4'}})
    assert correction.status_code == 201, correction.text
    assert confirm(client, correction.json()).status_code == 200
    result = statistics(client, params).json()
    assert result['total_quantity'] == 4 and len(result['documents']) == 1
    doc = result['documents'][0]
    assert (doc['original_quantity'], doc['effective_quantity'], doc['version']) == (5, 4, 2)
    assert [(x['old_quantity'], x['new_quantity']) for x in doc['corrections']] == [(5, 4)]
    assert statistics(client, params, start='2026-10-03', end='2026-10-03').json()['total_quantity'] == 0
    assert client.get('/api/inventory/reconciliation').json()['consistent']
    with application.state.sessions.begin() as db:
        db.execute(text("UPDATE inventory_documents SET effective_quantity=3 WHERE id=:id"), {'id': receipt['business_id']})
    assert client.get('/api/inventory/reconciliation').json()['consistent'] is False


def test_zeroed_inbound_remains_traceable_without_counting_as_new_inbound(opened):
    client, params = opened
    receipt = confirm(client, inbound(client, params)).json()
    correction = client.post('/api/drafts', headers=csrf(client), json={
        'kind': 'inventory_correction', 'parameters': {'document_id': receipt['business_id'],
            'new_quantity': 0, 'basis_note': '虚构有效入库归零核实'}})
    assert correction.status_code == 201, correction.text
    assert confirm(client, correction.json()).status_code == 200
    result = statistics(client, params).json()
    assert result['total_quantity'] == 0 and result['groups'][0]['quantity'] == 0
    docs = client.get('/api/inventory/documents', params={'warehouse_id': params['warehouse_id']}).json()
    assert len(docs) == 1 and docs[0]['id'] == receipt['business_id']
    assert docs[0]['original_quantity'] == 5 and docs[0]['effective_quantity'] == 0
    assert docs[0]['corrections'][0]['new_quantity'] == 0
