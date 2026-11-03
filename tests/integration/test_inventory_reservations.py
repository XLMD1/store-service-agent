from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import event, text
from sqlalchemy.orm import Session

from tests.integration.test_auth import csrf, login, create_user
from tests.integration.test_inventory_opening import opening, draft, confirm, balance, add


@pytest.fixture
def stock(opening):
    client,params=opening
    assert confirm(client,draft(client,params)).status_code==200
    return client,params


def change(client,kind,params,**extra):
    payload={'warehouse_id':params['warehouse_id'],'model_id':params['model_id'],'quantity':2,
        'occurred':{'precision':'date','date':'2026-10-02'},'basis_note':'M1-04虚构测试',**extra}
    response=client.post('/api/drafts',headers=csrf(client),json={'kind':kind,'parameters':payload})
    assert response.status_code==201,response.text
    return response.json()


def reservation_action(client,kind,reservation_id,quantity=1,**extra):
    response=client.post('/api/drafts',headers=csrf(client),json={'kind':kind,'parameters':{
        'reservation_id':reservation_id,'quantity':quantity,'occurred':{'precision':'date','date':'2026-10-03'},
        'basis_note':'M1-04虚构办理依据',**extra}})
    assert response.status_code==201,response.text
    return response.json()


def reservation(client,params,quantity=4,basis_kind='oral'):
    item=change(client,'reservation_create',params,quantity=quantity,
                customer_id=params['opening_reservations'][0]['customer_id'],basis_kind=basis_kind)
    response=confirm(client,item)
    assert response.status_code==200,response.text
    return response.json()


def numbers(client,params):
    result=balance(client,params)
    return result['on_hand'],result['reserved'],result['available']


def test_outbound_only_uses_available_and_does_not_consume_reservation(stock):
    client,params=stock
    response=client.post('/api/drafts',headers=csrf(client),json={'kind':'inventory_outbound','parameters':{
        'warehouse_id':params['warehouse_id'],'model_id':params['model_id'],'quantity':8,
        'occurred':{'precision':'date','date':'2026-10-02'},'basis_note':'超出可售'}})
    assert response.status_code==422
    item=change(client,'inventory_outbound',params,quantity=7)
    receipt=confirm(client,item)
    assert receipt.status_code==200 and numbers(client,params)==(3,3,0)
    assert confirm(client,item).json()==receipt.json()


@pytest.mark.parametrize('basis_kind',['oral','deposit','paid'])
def test_reserve_partial_pickup_and_cancel_keep_hra_and_counts_consistent(application,stock,basis_kind):
    client,params=stock
    created=reservation(client,params,basis_kind=basis_kind)
    selected=created['reservation']['id']
    assert numbers(client,params)==(10,7,3)
    assert created['reservation']['remaining_quantity']==4
    pickup=reservation_action(client,'reservation_pickup',selected,2)
    receipt=confirm(client,pickup)
    assert receipt.status_code==200 and numbers(client,params)==(8,5,3)
    assert confirm(client,pickup).json()==receipt.json()
    cancel=reservation_action(client,'reservation_cancel',selected,2)
    final=confirm(client,cancel).json()
    assert numbers(client,params)==(8,3,5)
    assert (final['reservation']['picked_quantity'],final['reservation']['cancelled_quantity'],
            final['reservation']['remaining_quantity'],final['reservation']['status'])==(2,2,0,'ended')
    with application.state.sessions() as db:
        assert db.scalar(text('SELECT sum(registered_quantity-picked_quantity-cancelled_quantity) FROM inventory_reservations'))==3
        assert db.scalar(text("SELECT count(*) FROM inventory_documents WHERE kind='inbound'"))==0
        assert db.scalar(text("SELECT count(*) FROM inventory_documents WHERE reservation_id=:id"),{'id':selected})==3


def test_cannot_cancel_or_pick_other_reservations_quantity(stock):
    client,params=stock
    created=reservation(client,params,quantity=2)
    for kind in ['reservation_cancel','reservation_pickup']:
        response=client.post('/api/drafts',headers=csrf(client),json={'kind':kind,'parameters':{
            'reservation_id':created['reservation']['id'],'quantity':3,
            'occurred':{'precision':'date','date':'2026-10-03'},'basis_note':'不能借其他预留'}})
        assert response.status_code==422
    assert numbers(client,params)==(10,5,5)


def test_pickup_rejects_warehouse_or_model_override(stock):
    client,params=stock
    selected=balance(client,params)['reservations'][0]['id']
    response=client.post('/api/drafts',headers=csrf(client),json={'kind':'reservation_pickup','parameters':{
        'reservation_id':selected,'warehouse_id':params['warehouse_id'],'quantity':1,
        'occurred':{'precision':'date','date':'2026-10-03'},'basis_note':'不得变更对象'}})
    assert response.status_code==422
    item=reservation_action(client,'reservation_pickup',selected,2)
    assert confirm(client,item).status_code==200 and numbers(client,params)==(8,1,7)


def test_concurrent_last_available_stock_has_only_one_success(application,stock):
    client,params=stock
    assert confirm(client,change(client,'inventory_outbound',params,quantity=6)).status_code==200
    a=change(client,'reservation_create',params,quantity=1,customer_id=params['opening_reservations'][0]['customer_id'],basis_kind='oral')
    b=change(client,'reservation_create',params,quantity=1,customer_id=params['opening_reservations'][0]['customer_id'],basis_kind='oral')
    with TestClient(application) as other:
        login(other)
        with ThreadPoolExecutor(max_workers=2) as pool:
            one,two=pool.submit(confirm,client,a),pool.submit(confirm,other,b)
            assert sorted([one.result().status_code,two.result().status_code])==[200,409]
    assert numbers(client,params)==(4,4,0)


def test_roles_support_clerk_reservation_and_stock_pickup_without_owner_privilege(application,stock):
    owner,params=stock
    create_user(owner,username='demo-clerk',roles=['clerk'])
    create_user(owner,username='demo-stock',roles=['stock_operator'])
    with TestClient(application) as clerk,TestClient(application) as worker:
        login(clerk,{'username':'demo-clerk','password':'Sample-Stock-Password-123'})
        customer=add(clerk,'customers',{'display_name':'示例新客户','phone':None})
        item=change(clerk,'reservation_create',params,quantity=2,customer_id=customer['id'],basis_kind='deposit')
        receipt=confirm(clerk,item).json()
        login(worker,{'username':'demo-stock','password':'Sample-Stock-Password-123'})
        pickup=reservation_action(worker,'reservation_pickup',receipt['reservation']['id'])
        assert confirm(worker,pickup).status_code==200
        forbidden=worker.post('/api/drafts',headers=csrf(worker),json={'kind':'reservation_create','parameters':{}})
        assert forbidden.status_code==403
        forbidden=clerk.post('/api/drafts',headers=csrf(clerk),json={'kind':'inventory_outbound','parameters':{}})
        assert forbidden.status_code==403
        assert worker.get('/api/operations/'+item['operation_id']).status_code==403


@pytest.mark.parametrize('kind',['inventory_outbound','reservation_create','reservation_cancel','reservation_pickup'])
def test_business_write_without_csrf_is_refused(stock,kind):
    client,params=stock
    assert client.post('/api/drafts',headers={'Origin':'http://127.0.0.1:8000'},json={'kind':kind,'parameters':{}}).status_code==403


def test_old_reservation_preview_and_ended_reservation_cannot_be_used(stock):
    client,params=stock
    created=reservation(client,params,quantity=2);selected=created['reservation']['id']
    stale=reservation_action(client,'reservation_pickup',selected,1)
    cancelled=reservation_action(client,'reservation_cancel',selected,2)
    assert confirm(client,cancelled).status_code==200
    assert confirm(client,stale).status_code==409
    response=client.post('/api/drafts',headers=csrf(client),json={'kind':'reservation_pickup','parameters':{
        'reservation_id':selected,'quantity':1,'occurred':{'precision':'date','date':'2026-10-03'},'basis_note':'已结束'}})
    assert response.status_code==422


def test_pickup_failure_rolls_back_balance_reservation_document_ledger_and_result(application,stock):
    client,params=stock;selected=balance(client,params)['reservations'][0]['id']
    item=reservation_action(client,'reservation_pickup',selected,2);headers=csrf(client);observed=[]
    def fail(db):
        observed.append((db.scalar(text('SELECT on_hand FROM inventory_accounts')),
                         db.scalar(text('SELECT picked_quantity FROM inventory_reservations WHERE id=:id'),{'id':selected})))
        raise RuntimeError('pickup before commit')
    event.listen(Session,'before_commit',fail)
    try:
        with pytest.raises(RuntimeError,match='pickup before commit'):
            client.post('/api/operations/'+item['operation_id']+'/confirm',headers=headers,json={
                'draft_id':item['id'],'draft_version':item['version'],'parameters':item['parameters']})
    finally:event.remove(Session,'before_commit',fail)
    assert observed==[(8,2)]
    assert numbers(client,params)==(10,3,7)
    with application.state.sessions() as db:
        assert db.scalar(text('SELECT picked_quantity FROM inventory_reservations WHERE id=:id'),{'id':selected})==0
        assert db.scalar(text('SELECT count(*) FROM inventory_documents'))==1
        assert db.scalar(text('SELECT count(*) FROM inventory_ledger'))==1
    assert client.get('/api/operations/'+item['operation_id']).json()['result'] is None
    assert confirm(client,item).status_code==200


def test_reservation_query_and_ledger_show_real_customer_and_related_records(stock):
    client,params=stock
    created=reservation(client,params,quantity=2)
    rows=client.get('/api/inventory/reservations',params={'q':'示例客户甲'}).json()
    assert len(rows)==2 and any(row['id']==created['reservation']['id'] for row in rows)
    assert all(row['customer']['display_name']=='示例客户甲' for row in rows)
    ledger=client.get('/api/inventory/ledger',params={k:params[k] for k in ['warehouse_id','model_id']})
    assert ledger.status_code==200 and len(ledger.json())==2
    assert any(row['kind']=='reserve' and row['reservation_id']==created['reservation']['id'] for row in ledger.json())


KINDS=['inventory_outbound','reservation_create','reservation_cancel','reservation_pickup']


def valid_movement(client,params,kind):
    if kind in ['reservation_cancel','reservation_pickup']:
        return reservation_action(client,kind,balance(client,params)['reservations'][0]['id'])
    extra={'customer_id':params['opening_reservations'][0]['customer_id'],'basis_kind':'oral'} if kind=='reservation_create' else {}
    return change(client,kind,params,**extra)


@pytest.mark.parametrize('kind',KINDS)
def test_each_movement_rejects_invalid_quantity_and_t0_and_can_save_missing(stock,kind):
    client,params=stock;item=valid_movement(client,params,kind)
    payload=item['parameters']
    for quantity in [0,-1,True,1.5]:
        r=client.post('/api/drafts',headers=csrf(client),json={'kind':kind,'parameters':{**payload,'quantity':quantity}})
        assert r.status_code==422
    r=client.post('/api/drafts',headers=csrf(client),json={'kind':kind,'parameters':{
        **payload,'occurred':{'precision':'date','date':'2026-09-30'}}})
    assert r.status_code==422
    pending=client.post('/api/drafts',headers=csrf(client),json={'kind':kind,'parameters':{
        **payload,'occurred':{'precision':'date','date':'2026-10-01'}}}).json()
    assert pending['state']=='missing' and pending['operation_id'] is None
    assert 'occurred.t0_relation' in pending['missing_fields']
    assert numbers(client,params)==(10,3,7)


@pytest.mark.parametrize('kind',KINDS)
def test_each_movement_binds_parameters_old_draft_and_current_permission(application,stock,kind):
    owner,params=stock
    role='clerk' if kind in ['reservation_create','reservation_cancel'] else 'stock_operator'
    user=create_user(owner,roles=[role])
    with TestClient(application) as worker:
        login(worker,{'username':user['username'],'password':'Sample-Stock-Password-123'})
        item=valid_movement(worker,params,kind)
        assert confirm(worker,item,parameters={**item['parameters'],'quantity':2 if item['parameters']['quantity']==1 else 1}).status_code==409
        saved=worker.patch('/api/drafts/'+item['id'],headers=csrf(worker),json={
            'expected_version':item['version'],'parameters':item['parameters']}).json()
        assert confirm(worker,item).status_code==409
        assert owner.patch('/api/accounts/'+user['id'],headers=csrf(owner),json={
            'roles':['technician'],'confirmed':True}).status_code==200
        assert confirm(worker,saved).status_code==403
        assert worker.get('/api/drafts/'+saved['id']).status_code==403
    assert numbers(owner,params)==(10,3,7)


def test_concurrent_replay_of_pickup_and_same_draft_other_operation_only_write_once(application,stock):
    from app.operations.models import Operation
    client,params=stock;item=valid_movement(client,params,'reservation_pickup')
    with application.state.sessions.begin() as db:
        old=db.get(Operation,item['operation_id'])
        duplicate=Operation(draft_id=old.draft_id,draft_version=old.draft_version,actor_id=old.actor_id,
            parameters_digest=old.parameters_digest,target_versions=old.target_versions,state='pending')
        db.add(duplicate);db.flush();duplicate_id=duplicate.id
    with TestClient(application) as other:
        login(other)
        with ThreadPoolExecutor(max_workers=2) as pool:
            a,b=pool.submit(confirm,client,item),pool.submit(confirm,other,item)
            one,two=a.result(),b.result()
    assert one.status_code==two.status_code==200 and one.json()==two.json()
    assert confirm(client,{**item,'operation_id':duplicate_id}).status_code==409
    assert numbers(client,params)==(9,2,7)
    with application.state.sessions() as db:
        assert db.scalar(text("SELECT count(*) FROM inventory_documents WHERE kind='pickup'"))==1


def test_ledger_date_type_reservation_filters_and_ended_lookup(stock):
    client,params=stock;receipt=reservation(client,params,quantity=2);selected=receipt['reservation']['id']
    assert confirm(client,reservation_action(client,'reservation_pickup',selected,1)).status_code==200
    assert confirm(client,reservation_action(client,'reservation_cancel',selected,1)).status_code==200
    filters={k:params[k] for k in ['warehouse_id','model_id']}
    rows=client.get('/api/inventory/ledger',params={**filters,'start':'2026-10-03','end':'2026-10-03'}).json()
    assert {r['kind'] for r in rows}=={'pickup','cancel'}
    rows=client.get('/api/inventory/ledger',params={**filters,'kind':'pickup','reservation_id':selected}).json()
    assert len(rows)==1 and rows[0]['on_hand_delta']==rows[0]['reserved_delta']==-1
    assert client.get('/api/inventory/ledger',params={**filters,'start':'2026-10-04','end':'2026-10-03'}).status_code==422
    assert client.get('/api/inventory/reservations',params={'q':selected}).json()==[]
    rows=client.get('/api/inventory/reservations',params={'q':selected,'active_only':False,**filters}).json()
    assert len(rows)==1 and rows[0]['status']=='ended'
    all_rows=client.get('/api/inventory/ledger',params=filters).json()
    assert sum(r['on_hand_delta'] for r in all_rows)==9
    assert sum(r['reserved_delta'] for r in all_rows)==3


def test_migration_refuses_to_drop_new_reservation_history(application,settings,stock):
    from alembic import command
    from alembic.config import Config
    client,params=stock;reservation(client,params)
    cfg=Config('alembic.ini');cfg.attributes['database_url']=settings.database_url
    with pytest.raises(RuntimeError,match='Cannot downgrade recorded reservation/outbound'):
        command.downgrade(cfg,'0004_document_occurrence')
    with application.state.sessions() as db:
        assert db.scalar(text('SELECT version_num FROM alembic_version'))=='0006_inventory_corrections'
        assert db.scalar(text("SELECT count(*) FROM inventory_documents WHERE kind='reserve' AND reservation_id IS NOT NULL"))==1


def test_pending_movement_also_prevents_incompatible_downgrade(application,settings,stock):
    from alembic import command
    from alembic.config import Config
    client,params=stock;item=valid_movement(client,params,'reservation_pickup')
    cfg=Config('alembic.ini');cfg.attributes['database_url']=settings.database_url
    with pytest.raises(RuntimeError,match='Cannot downgrade recorded reservation/outbound'):
        command.downgrade(cfg,'0004_document_occurrence')
    assert confirm(client,item).status_code==200


def test_pickup_lost_response_survives_restart_and_original_receipt_replay(settings,stock):
    from app.main import create_app
    from starlette.responses import Response
    client,params=stock;item=valid_movement(client,params,'reservation_pickup')
    path='/api/operations/'+item['operation_id']+'/confirm'
    broken_app=create_app(settings)
    @broken_app.middleware('http')
    async def lose_response(request,call_next):
        response=await call_next(request)
        return Response(status_code=503) if request.url.path==path and response.status_code==200 else response
    try:
        with TestClient(broken_app) as broken:
            login(broken)
            assert confirm(broken,item).status_code==503
    finally:broken_app.state.engine.dispose()
    restarted=create_app(settings)
    try:
        with TestClient(restarted) as other:
            login(other)
            original=other.get('/api/operations/'+item['operation_id']).json()
            assert original['state']=='succeeded'
            assert confirm(other,item).json()==original['result']
            assert numbers(other,params)==(9,2,7)
            assert other.get('/api/drafts/'+item['id']).json()['state']=='succeeded'
    finally:restarted.state.engine.dispose()


@pytest.fixture
def staff(application,stock):
    owner,params=stock
    create_user(owner,username='demo-clerk',roles=['clerk'])
    create_user(owner,username='demo-stock',roles=['stock_operator'])
    with TestClient(application) as clerk,TestClient(application) as worker:
        login(clerk,{'username':'demo-clerk','password':'Sample-Stock-Password-123'})
        login(worker,{'username':'demo-stock','password':'Sample-Stock-Password-123'})
        yield owner,params,clerk,worker


def test_ac17_stock_operator_cannot_outbound_eight_when_available_seven(staff):
    owner,params,clerk,worker=staff
    response=worker.post('/api/drafts',headers=csrf(worker),json={'kind':'inventory_outbound','parameters':{
        'warehouse_id':params['warehouse_id'],'model_id':params['model_id'],'quantity':8,
        'occurred':{'precision':'date','date':'2026-10-02'},'basis_note':'AC17虚构超额出库'}})
    assert response.status_code==422 and numbers(owner,params)==(10,3,7)


def test_ac18_clerk_reserves_two_for_independent_customer(staff):
    owner,params,clerk,worker=staff
    customer=add(clerk,'customers',{'display_name':'AC18示例客户乙','phone':None})
    item=change(clerk,'reservation_create',params,quantity=2,customer_id=customer['id'],basis_kind='oral')
    receipt=confirm(clerk,item)
    assert receipt.status_code==200 and numbers(owner,params)==(10,5,5)
    assert receipt.json()['reservation']['customer_id']==customer['id']


def test_ac19_clerk_cannot_cancel_three_from_reservation_remaining_two(staff):
    owner,params,clerk,worker=staff;created=reservation(owner,params,quantity=2)
    r=clerk.post('/api/drafts',headers=csrf(clerk),json={'kind':'reservation_cancel','parameters':{
        'reservation_id':created['reservation']['id'],'quantity':3,
        'occurred':{'precision':'date','date':'2026-10-03'},'basis_note':'AC19不能挪用他单'}})
    assert r.status_code==422 and numbers(owner,params)==(10,5,5)


def test_ac20_stock_operator_pickup_two_from_opening_reservation(staff):
    owner,params,clerk,worker=staff;selected=balance(owner,params)['reservations'][0]['id']
    item=reservation_action(worker,'reservation_pickup',selected,2)
    receipt=confirm(worker,item)
    assert receipt.status_code==200 and numbers(owner,params)==(8,1,7)
    assert receipt.json()['reservation']['remaining_quantity']==1
    assert confirm(worker,item).json()==receipt.json()


def test_ac23_two_clerks_compete_for_exactly_last_on_hand_unit(application,opening):
    owner,params=opening;params={**params,'on_hand':1,'opening_reservations':[]}
    assert confirm(owner,draft(owner,params)).status_code==200
    for name in ['clerk-a','clerk-b']:create_user(owner,username=name,roles=['clerk'])
    with TestClient(application) as a,TestClient(application) as b:
        items=[]
        for client,name in [(a,'clerk-a'),(b,'clerk-b')]:
            login(client,{'username':name,'password':'Sample-Stock-Password-123'})
            customer=add(client,'customers',{'display_name':'示例'+name,'phone':None})
            items.append(change(client,'reservation_create',params,quantity=1,customer_id=customer['id'],basis_kind='oral'))
        with ThreadPoolExecutor(max_workers=2) as pool:
            one,two=pool.submit(confirm,a,items[0]),pool.submit(confirm,b,items[1])
            assert sorted([one.result().status_code,two.result().status_code])==[200,409]
    assert numbers(owner,params)==(1,1,0)
    with application.state.sessions() as db:
        assert db.scalar(text('SELECT sum(registered_quantity-picked_quantity-cancelled_quantity) FROM inventory_reservations'))==1
        assert db.scalar(text("SELECT count(*) FROM inventory_documents WHERE kind='reserve'"))==1
        assert db.scalar(text('SELECT count(*) FROM inventory_ledger'))==2


def test_ac24_old_seven_reservation_fails_after_other_actor_outbounds_one(staff):
    owner,params,clerk,worker=staff
    item=change(clerk,'reservation_create',params,quantity=7,
        customer_id=params['opening_reservations'][0]['customer_id'],basis_kind='oral')
    assert confirm(worker,change(worker,'inventory_outbound',params,quantity=1)).status_code==200
    assert confirm(clerk,item).status_code==409 and numbers(owner,params)==(9,3,6)
    assert clerk.patch('/api/drafts/'+item['id'],headers=csrf(clerk),json={
        'expected_version':item['version'],'parameters':item['parameters']}).status_code==422
    refreshed=clerk.patch('/api/drafts/'+item['id'],headers=csrf(clerk),json={
        'expected_version':item['version'],'parameters':{**item['parameters'],'quantity':6}}).json()
    assert refreshed['preview']['before']=={'on_hand':9,'reserved':3,'available':6}
    assert confirm(clerk,refreshed).status_code==200 and numbers(owner,params)==(9,9,0)
