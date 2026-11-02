from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import event, text
from sqlalchemy.orm import Session

from tests.integration.test_auth import csrf, login, create_user
from tests.integration.test_inventory_opening import opening, draft, confirm, balance


@pytest.fixture
def opened(opening):
    client, params = opening
    assert confirm(client, draft(client, params)).status_code == 200
    return client, {'warehouse_id': params['warehouse_id'], 'model_id': params['model_id'],
        'quantity': 5, 'occurred': {'precision': 'date', 'date': '2026-10-02'}, 'basis_note': '虚构入库5台，仅供开发验证'}


def inbound(client, params):
    response = client.post('/api/drafts', headers=csrf(client), json={'kind': 'inventory_inbound', 'parameters': params})
    assert response.status_code == 201, response.text
    return response.json()


def test_inbound_updates_balance_once_and_other_session_reads_latest(application, opened):
    client, params = opened
    item = inbound(client, params)
    assert item['preview']['after'] == {'on_hand': 15, 'reserved': 3, 'available': 12}
    result = confirm(client, item)
    assert result.status_code == 200, result.text
    receipt = result.json()
    assert receipt['kind'] == 'inventory_inbound' and receipt['quantity'] == 5
    assert receipt['occurred']['precision'] == 'date' and receipt['occurred']['date'] == '2026-10-02'
    assert confirm(client, item).json() == receipt
    with TestClient(application) as other:
        login(other)
        actual = balance(other, params)
        assert (actual['on_hand'], actual['reserved'], actual['available'], actual['version']) == (15,3,12,2)
    with application.state.sessions() as db:
        row = db.execute(text("SELECT count(*),sum(effective_quantity) FROM inventory_documents WHERE kind='inbound'")).one()
        assert tuple(row) == (1,5)
        occurrence=db.execute(text("SELECT occurred_precision,occurred_date,occurred_at FROM inventory_documents WHERE kind='inbound'")).one()
        assert occurrence.occurred_precision=='date' and str(occurrence.occurred_date)=='2026-10-02' and occurrence.occurred_at is None
        assert db.scalar(text('SELECT count(*) FROM inventory_ledger')) == 2


@pytest.mark.parametrize('change', [{'quantity':0},{'quantity':-1},{'quantity':1.5},{'quantity':True},
    {'occurred':{'precision':'datetime','at':'2026-10-02T10:00:00'}},{'unknown':'ignored?'}])
def test_invalid_inbound_cannot_change_stock(opened, change):
    client, params = opened
    response = client.post('/api/drafts', headers=csrf(client), json={
        'kind':'inventory_inbound','parameters':{**params,**change}})
    assert response.status_code == 422
    assert balance(client, params)['on_hand'] == 10


@pytest.mark.parametrize('occurred', [
    {'precision':'date','date':'2026-09-30'},
    {'precision':'datetime','at':'2026-10-01T00:00:00+08:00'},
    {'precision':'datetime','at':'2026-09-30T23:59:59+08:00'},
    {'precision':'date','date':'2026-10-01','t0_relation':'at_or_before','boundary_note':'已核实属于期初'}])
def test_t0_events_are_not_recounted(opened, occurred):
    client, params = opened
    response = client.post('/api/drafts', headers=csrf(client), json={
        'kind':'inventory_inbound','parameters':{**params,'occurred':occurred}})
    assert response.status_code == 422
    assert balance(client, params)['on_hand'] == 10


def test_t0_date_unknown_is_pending_until_human_checks_boundary(opened):
    client, params = opened
    params['occurred'] = {'precision':'date','date':'2026-10-01','t0_relation':'unknown'}
    item = inbound(client, params)
    assert item['state'] == 'missing' and item['operation_id'] is None
    assert 'occurred.t0_relation' in item['missing_fields']
    params['occurred'].update(t0_relation='after',boundary_note='虚构样例：人员已核实在T0之后到货')
    response=client.patch('/api/drafts/'+item['id'],headers=csrf(client),json={
        'expected_version':1,'parameters':params})
    assert response.status_code == 200
    assert confirm(client,response.json()).status_code == 200


def test_unopened_and_missing_inbound_have_no_executable_effect(opening):
    client, params = opening
    blank=inbound(client,{})
    assert blank['state']=='missing' and blank['operation_id'] is None
    response=client.post('/api/drafts',headers=csrf(client),json={
        'kind':'inventory_inbound','parameters':{'warehouse_id':params['warehouse_id'],'model_id':params['model_id'],
            'quantity':5,'occurred':{'precision':'date','date':'2026-10-02'},'basis_note':'样例'}})
    assert response.status_code==422


def test_parameter_and_old_draft_conflicts_do_not_add_stock(opened):
    client, params = opened
    first=inbound(client,params)
    assert confirm(client,first,parameters={**first['parameters'],'quantity':6}).status_code==409
    response=client.patch('/api/drafts/'+first['id'],headers=csrf(client),json={
        'expected_version':1,'parameters':{**params,'quantity':6}})
    assert response.status_code==200
    assert confirm(client,first).status_code==409
    assert confirm(client,response.json()).json()['balance']['on_hand']==16


def test_stale_target_conflicts_but_original_success_replays_after_new_inbound(opened):
    client, params = opened
    original, stale = inbound(client,params), inbound(client,{**params,'quantity':2})
    receipt=confirm(client,original).json()
    assert confirm(client,stale).status_code==409
    newer=inbound(client,{**params,'quantity':1})
    assert confirm(client,newer).json()['balance']['on_hand']==16
    assert confirm(client,original).json()==receipt
    assert balance(client,params)['on_hand']==16


def test_concurrent_duplicate_confirmation_only_adds_once(application, opened):
    first,params=opened
    item=inbound(first,params)
    with TestClient(application) as second:
        login(second)
        with ThreadPoolExecutor(max_workers=2) as pool:
            a,b=pool.submit(confirm,first,item),pool.submit(confirm,second,item)
            assert a.result().status_code==b.result().status_code==200
            assert a.result().json()==b.result().json()
    assert balance(first,params)['on_hand']==15


def test_stock_operator_can_inbound_but_cannot_open_or_view_anothers_receipt(application, opened):
    owner,params=opened
    create_user(owner)
    item=inbound(owner,params)
    with TestClient(application) as worker:
        login(worker,{'username':'demo-stock','password':'Sample-Stock-Password-123'})
        own=inbound(worker,params)
        assert confirm(worker,own).status_code==200
        assert worker.get('/api/operations/'+item['operation_id']).status_code==403
        assert confirm(worker,item).status_code==403
        assert worker.post('/api/drafts',headers=csrf(worker),json={'kind':'inventory_opening','parameters':{}}).status_code==403
        pending=worker.get('/api/drafts').json()
        assert all(row['kind']=='inventory_inbound' for row in pending)


def test_revocation_blocks_inbound_confirmation_and_receipt_access(application, opened):
    owner,params=opened
    user=create_user(owner)
    with TestClient(application) as worker:
        login(worker,{'username':'demo-stock','password':'Sample-Stock-Password-123'})
        item=inbound(worker,params)
        assert owner.patch('/api/accounts/'+user['id'],headers=csrf(owner),json={
            'roles':['technician'],'confirmed':True}).status_code==200
        assert confirm(worker,item).status_code==403
        assert worker.get('/api/operations/'+item['operation_id']).status_code==403
        assert balance(owner,params)['on_hand']==10


def test_inbound_transaction_rolls_back_updated_balance_document_ledger_and_result(application, opened):
    client,params=opened
    item=inbound(client,params); headers=csrf(client); observed=[]
    def fail(db):
        observed.append(db.scalar(text('SELECT on_hand FROM inventory_accounts')))
        raise RuntimeError('inbound commit failure')
    event.listen(Session,'before_commit',fail)
    try:
        with pytest.raises(RuntimeError,match='inbound commit failure'):
            client.post('/api/operations/'+item['operation_id']+'/confirm',headers=headers,json={
                'draft_id':item['id'],'draft_version':item['version'],'parameters':item['parameters']})
    finally:event.remove(Session,'before_commit',fail)
    assert observed==[15]
    assert balance(client,params)['on_hand']==10
    with application.state.sessions() as db:
        assert db.scalar(text("SELECT count(*) FROM inventory_documents WHERE kind='inbound'"))==0
        assert db.scalar(text('SELECT count(*) FROM inventory_ledger'))==1
    assert client.get('/api/operations/'+item['operation_id']).json()['result'] is None
    assert confirm(client,item).status_code==200


def test_pending_and_submitted_inbound_recover_after_application_restart(application, settings, opened):
    from app.main import create_app
    client,params=opened; item=inbound(client,params)
    restarted=create_app(settings)
    try:
        with TestClient(restarted) as other:
            login(other)
            assert any(row['id']==item['id'] for row in other.get('/api/drafts').json())
            receipt=confirm(other,item).json()
        with TestClient(application) as other:
            login(other)
            assert other.get('/api/operations/'+item['operation_id']).json()['result']==receipt
            assert confirm(other,item).json()==receipt
    finally:restarted.state.engine.dispose()


def test_same_inbound_draft_with_two_operation_ids_cannot_double_write(application, opened):
    from app.operations.models import Operation
    client,params=opened; item=inbound(client,params)
    with application.state.sessions.begin() as db:
        old=db.get(Operation,item['operation_id'])
        duplicate=Operation(draft_id=old.draft_id,draft_version=old.draft_version,actor_id=old.actor_id,
            parameters_digest=old.parameters_digest,target_versions=old.target_versions,state='pending')
        db.add(duplicate);db.flush();duplicate_id=duplicate.id
    assert confirm(client,item).status_code==200
    assert confirm(client,{**item,'operation_id':duplicate_id}).status_code==409
    assert balance(client,params)['on_hand']==15


def test_migration_refuses_to_destroy_date_only_event_precision(application, settings, opened):
    from alembic import command
    from alembic.config import Config
    client,params=opened
    assert confirm(client,inbound(client,params)).status_code==200
    cfg=Config('alembic.ini');cfg.attributes['database_url']=settings.database_url
    with pytest.raises(RuntimeError,match='Cannot downgrade date-only events'):
        command.downgrade(cfg,'f803b23a24b7')
    with application.state.sessions() as db:
        assert db.scalar(text('SELECT version_num FROM alembic_version'))=='0004_document_occurrence'
        assert db.scalar(text("SELECT count(*) FROM inventory_documents WHERE occurred_precision='date'"))==1


def test_lost_http_response_after_commit_is_recovered_by_original_operation(application, settings, opened):
    from starlette.responses import Response
    from app.main import create_app
    client,params=opened;item=inbound(client,params)
    path='/api/operations/'+item['operation_id']+'/confirm'
    broken_app=create_app(settings)
    @broken_app.middleware('http')
    async def lose_response(request,call_next):
        response=await call_next(request)
        if request.url.path==path and response.status_code==200:
            return Response(status_code=503)
        return response
    with TestClient(broken_app) as broken:
        login(broken)
        assert confirm(broken,item).status_code==503
        result=broken.get('/api/operations/'+item['operation_id']).json()
        assert result['state']=='succeeded' and result['result']['balance']['on_hand']==15
        assert balance(broken,params)['on_hand']==15
    broken_app.state.engine.dispose()
    with application.state.sessions() as db:
        assert db.scalar(text("SELECT count(*) FROM inventory_documents WHERE kind='inbound'"))==1
