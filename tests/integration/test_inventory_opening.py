from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import text

from tests.integration.test_auth import csrf, login, create_user


def add(client, path, payload):
    response = client.post('/api/catalog/' + path, headers=csrf(client), json={**payload, 'confirmed': True})
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture
def opening(application):
    with TestClient(application) as client:
        login(client)
        warehouse = add(client, 'warehouses', {'code': 'DEMO-02', 'name': '示例2号库'})
        model = add(client, 'models', {'name': '示例型号A', 'aliases': ['示例别名A']})
        customer = add(client, 'customers', {'display_name': '示例客户甲'})
        params = {'warehouse_id': warehouse['id'], 'model_id': model['id'],
                  't0': '2026-10-01T00:00:00+08:00', 'on_hand': 10,
                  'opening_reservations': [{'customer_id': customer['id'], 'remaining_quantity': 3,
                                             'basis_note': '虚构期初留货，仅登记T0剩余'}],
                  'basis_note': '虚构盘点样例，不代表真实库存'}
        yield client, params


def draft(client, params):
    response = client.post('/api/drafts', headers=csrf(client), json={
        'kind': 'inventory_opening', 'parameters': params})
    assert response.status_code == 201, response.text
    return response.json()


def confirm(client, item, **overrides):
    return client.post('/api/operations/' + item['operation_id'] + '/confirm', headers=csrf(client), json={
        'draft_id': item['id'], 'draft_version': item['version'], 'parameters': item['parameters'], **overrides})


def balance(client, params):
    response = client.get('/api/inventory/balance', params={k: params[k] for k in ('warehouse_id', 'model_id')})
    assert response.status_code == 200, response.text
    return response.json()


def test_opening_is_once_and_not_inbound(application, opening):
    client, params = opening
    before = balance(client, params)
    assert before['status'] == 'uninitialized' and before['on_hand'] is None
    item = draft(client, params)
    assert item['preview'] == {'on_hand': 10, 'reserved': 3, 'available': 7}
    assert balance(client, params)['status'] == 'uninitialized'
    response = confirm(client, item)
    assert response.status_code == 200, response.text
    receipt = response.json()
    assert (receipt['balance']['on_hand'], receipt['balance']['reserved'], receipt['balance']['available']) == (10, 3, 7)
    assert receipt['kind'] == 'inventory_opening'
    assert receipt['quantity'] == 10 and receipt['opening_reserved'] == 3
    assert confirm(client, item).json() == receipt
    assert client.get('/api/operations/' + item['operation_id']).json()['result'] == receipt
    actual = balance(client, params)
    assert actual['version'] == 1 and actual['t0'] is not None and actual['queried_at']
    assert actual['reservations'][0]['remaining_quantity'] == 3
    assert actual['reservations'][0]['picked_quantity'] == 0
    assert actual['reservations'][0]['customer_id'] == params['opening_reservations'][0]['customer_id']
    with application.state.sessions() as db:
        assert db.scalar(text('SELECT count(*) FROM inventory_accounts')) == 1
        assert db.scalar(text('SELECT count(*) FROM inventory_ledger')) == 1
        assert db.scalar(text("SELECT count(*) FROM inventory_documents WHERE kind='inbound'")) == 0


def test_opened_zero_is_different_from_uninitialized(opening):
    client, params = opening
    params.update(on_hand=0, opening_reservations=[])
    assert confirm(client, draft(client, params)).status_code == 200
    result = balance(client, params)
    assert result['status'] == 'opened'
    assert (result['on_hand'], result['reserved'], result['available']) == (0, 0, 0)


@pytest.mark.parametrize('change', [
    {'on_hand': -1}, {'on_hand': True}, {'on_hand': 1.5}, {'t0': '2026-10-01T00:00:00'},
    {'on_hand': 2}, {'unexpected': 'value'},
])
def test_invalid_opening_has_no_effect(opening, change):
    client, params = opening
    response = client.post('/api/drafts', headers=csrf(client), json={
        'kind': 'inventory_opening', 'parameters': {**params, **change}})
    assert response.status_code == 422
    assert balance(client, params)['status'] == 'uninitialized'


def test_missing_fields_can_be_saved_without_executable_operation(opening):
    client, params = opening
    item = draft(client, {})
    assert item['state'] == 'missing' and item['operation_id'] is None
    assert {'warehouse_id', 'model_id', 't0', 'on_hand', 'basis_note'} <= set(item['missing_fields'])
    response = client.patch('/api/drafts/' + item['id'], headers=csrf(client), json={
        'expected_version': 1, 'parameters': params})
    assert response.status_code == 200 and response.json()['version'] == 2
    assert response.json()['operation_id']


def test_old_draft_confirmation_and_parameter_mismatch_are_rejected(opening):
    client, params = opening
    first = draft(client, params)
    changed = {**params, 'on_hand': 11}
    assert confirm(client, first, parameters=changed).status_code == 409
    response = client.patch('/api/drafts/' + first['id'], headers=csrf(client), json={
        'expected_version': 1, 'parameters': changed})
    second = response.json()
    assert response.status_code == 200 and second['operation_id'] != first['operation_id']
    assert confirm(client, first).status_code == 409
    assert confirm(client, second).json()['balance']['on_hand'] == 11
    assert client.patch('/api/drafts/' + first['id'], headers=csrf(client), json={
        'expected_version': 2, 'parameters': params}).status_code == 409


def test_catalog_version_change_requires_new_preview(opening):
    client, params = opening
    item = draft(client, params)
    response = client.patch('/api/catalog/models/' + params['model_id'], headers=csrf(client), json={
        'expected_version': 1, 'name': '示例型号A修订', 'confirmed': True})
    assert response.status_code == 200
    assert confirm(client, item).status_code == 409
    assert balance(client, params)['status'] == 'uninitialized'


def test_disabled_catalog_cannot_be_used_for_new_opening(opening):
    client, params = opening
    assert client.patch('/api/catalog/models/' + params['model_id'], headers=csrf(client), json={
        'expected_version': 1, 'enabled': False, 'confirmed': True}).status_code == 200
    response = client.post('/api/drafts', headers=csrf(client), json={'kind': 'inventory_opening', 'parameters': params})
    assert response.status_code == 422
    assert balance(client, params)['status'] == 'uninitialized'


def test_current_permissions_and_actor_binding_are_enforced(application, opening):
    client, params = opening
    item = draft(client, params)
    user = create_user(client, roles=['technician'])
    with TestClient(application) as worker:
        login(worker, {'username': 'demo-stock', 'password': 'Sample-Stock-Password-123'})
        assert balance(worker, params)['status'] == 'uninitialized'
        assert confirm(worker, item).status_code == 403
        assert worker.get('/api/operations/' + item['operation_id']).status_code == 403
        assert worker.post('/api/drafts', headers=csrf(worker), json={
            'kind': 'inventory_opening', 'parameters': params}).status_code == 403
        assert client.patch('/api/accounts/' + user['id'], headers=csrf(client), json={
            'roles': ['owner'], 'confirmed': True}).status_code == 200
        assert confirm(worker, item).status_code == 403


def test_concurrent_opening_has_exactly_one_account(application, opening):
    first, params = opening
    a, b = draft(first, params), draft(first, params)
    with TestClient(application) as second:
        login(second)
        with ThreadPoolExecutor(max_workers=2) as pool:
            one, two = pool.submit(confirm, first, a), pool.submit(confirm, second, b)
            assert sorted([one.result().status_code, two.result().status_code]) == [200, 409]
    with application.state.sessions() as db:
        assert db.scalar(text('SELECT count(*) FROM inventory_accounts')) == 1
        assert db.scalar(text('SELECT count(*) FROM inventory_ledger')) == 1


def test_transaction_failure_rolls_back_all_opening_effects(application, opening):
    from sqlalchemy import event
    from sqlalchemy.orm import Session
    client, params = opening
    item = draft(client, params)
    headers = csrf(client)
    observed = []
    def fail_commit(db):
        observed.append(db.scalar(text('SELECT count(*) FROM inventory_accounts')))
        raise RuntimeError('Injected pre-commit failure')
    event.listen(Session, 'before_commit', fail_commit)
    try:
        with pytest.raises(RuntimeError, match='Injected'):
            client.post('/api/operations/' + item['operation_id'] + '/confirm', headers=headers, json={
                'draft_id': item['id'], 'draft_version': item['version'], 'parameters': item['parameters']})
    finally:
        event.remove(Session, 'before_commit', fail_commit)
    assert observed == [1], 'The failure must occur after the account was written in the confirmation transaction'
    assert balance(client, params)['status'] == 'uninitialized'
    with application.state.sessions() as db:
        for table in ['inventory_accounts', 'inventory_reservations', 'inventory_documents', 'inventory_ledger']:
            assert db.scalar(text(f'SELECT count(*) FROM {table}')) == 0
    operation = client.get('/api/operations/' + item['operation_id']).json()
    assert operation['state'] == 'pending' and operation['result'] is None
    assert confirm(client, item).status_code == 200


def test_pending_and_committed_operation_survive_application_restart(application, settings, opening):
    from app.main import create_app
    original, params = opening
    item = draft(original, params)
    restarted = create_app(settings)
    try:
        with TestClient(restarted) as client:
            login(client)
            assert client.get('/api/drafts/' + item['id']).json()['operation_id'] == item['operation_id']
            receipt = confirm(client, item).json()
        restarted.state.engine.dispose()
        restarted = create_app(settings)
        with TestClient(restarted) as client:
            login(client)
            assert confirm(client, item).json() == receipt
    finally:
        restarted.state.engine.dispose()


def test_same_draft_different_operation_id_cannot_write_twice(application, opening):
    from app.operations.models import Operation
    client, params = opening
    item = draft(client, params)
    with application.state.sessions.begin() as db:
        original = db.get(Operation, item['operation_id'])
        extra = Operation(draft_id=original.draft_id, draft_version=original.draft_version,
                          id='00000000-0000-0000-0000-000000000001',
                          actor_id=original.actor_id, parameters_digest=original.parameters_digest,
                          target_versions=original.target_versions, state='pending')
        db.add(extra); db.flush(); extra_id = extra.id
    assert confirm(client, item).status_code == 200
    assert client.get('/api/drafts/' + item['id']).json()['operation_id'] == item['operation_id']
    assert confirm(client, {**item, 'operation_id': extra_id}).status_code == 409
    assert balance(client, params)['on_hand'] == 10


def test_draft_author_loses_confirmation_and_receipt_access_after_revocation(application, opening):
    client, params = opening
    user = create_user(client, roles=['owner'])
    with TestClient(application) as author:
        login(author, {'username': 'demo-stock', 'password': 'Sample-Stock-Password-123'})
        item = draft(author, params)
        assert client.patch('/api/accounts/' + user['id'], headers=csrf(client), json={
            'roles': ['technician'], 'confirmed': True}).status_code == 200
        assert confirm(author, item).status_code == 403
        assert author.get('/api/drafts/' + item['id']).status_code == 403
        assert author.get('/api/operations/' + item['operation_id']).status_code == 403
        assert balance(client, params)['status'] == 'uninitialized'
