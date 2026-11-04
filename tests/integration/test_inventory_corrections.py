from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import event, text
from sqlalchemy.orm import Session

from tests.integration.test_auth import csrf, login, create_user
from tests.integration.test_inventory_opening import opening, draft, confirm, balance
from tests.integration.test_inventory_reservations import stock, change, reservation_action, numbers


def correction(client, document_id, quantity):
    response=client.post('/api/drafts',headers=csrf(client),json={'kind':'inventory_correction','parameters':{
        'document_id':document_id,'new_quantity':quantity,'basis_note':'M1-05虚构录入错误核实'}})
    assert response.status_code==201,response.text
    return response.json()


def adjustment(client,params,on_hand,**extra):
    response=client.post('/api/drafts',headers=csrf(client),json={'kind':'inventory_adjustment','parameters':{
        'warehouse_id':params['warehouse_id'],'model_id':params['model_id'],'on_hand':on_hand,
        'occurred':{'precision':'date','date':'2026-10-04'},'basis_note':'M1-05虚构实物盘点',**extra}})
    assert response.status_code==201,response.text
    return response.json()


def original_inbound(client,params):
    item=change(client,'inventory_inbound',params,quantity=5)
    response=confirm(client,item)
    assert response.status_code==200,response.text
    return response.json()


def invalid_correction(client,document_id,quantity):
    return client.post('/api/drafts',headers=csrf(client),json={'kind':'inventory_correction','parameters':{
        'document_id':document_id,'new_quantity':quantity,'basis_note':'虚构非法更正'}})


def test_ac26_inbound_correction_preserves_original_and_history_and_idempotency(application,stock):
    client,params=stock;original=original_inbound(client,params)
    item=correction(client,original['business_id'],4)
    assert numbers(client,params)==(15,3,12)
    assert item['preview']['after']=={'on_hand':14,'reserved':3,'available':11}
    response=confirm(client,item)
    assert response.status_code==200,response.text
    receipt=response.json()
    assert receipt['original_document_id']==original['business_id']
    assert numbers(client,params)==(14,3,11)
    assert confirm(client,item).json()==receipt
    with application.state.sessions() as db:
        row=db.execute(text('SELECT original_quantity,effective_quantity FROM inventory_documents WHERE id=:id'),
                       {'id':original['business_id']}).one()
        assert tuple(row)==(5,4)
        assert db.scalar(text('SELECT count(*) FROM inventory_documents WHERE original_document_id=:id'),
                         {'id':original['business_id']})==1
        assert db.scalar(text('SELECT sum(on_hand_delta) FROM inventory_ledger'))==14
        assert db.scalar(text('SELECT count(*) FROM inventory_ledger'))==3
    again=correction(client,original['business_id'],0)
    assert confirm(client,again).status_code==200
    assert numbers(client,params)==(10,3,7)
    assert confirm(client,item).json()==receipt
    with application.state.sessions() as db:
        assert db.scalar(text('SELECT effective_quantity FROM inventory_documents WHERE id=:id'),
                         {'id':original['business_id']})==0
        assert db.scalar(text('SELECT count(*) FROM inventory_documents WHERE original_document_id=:id'),
                         {'id':original['business_id']})==2


def test_ac27_adjustment_below_reserved_is_refused_and_valid_target_applies_once(stock):
    client,params=stock
    response=client.post('/api/drafts',headers=csrf(client),json={'kind':'inventory_adjustment','parameters':{
        'warehouse_id':params['warehouse_id'],'model_id':params['model_id'],'on_hand':2,
        'occurred':{'precision':'date','date':'2026-10-04'},'basis_note':'目标低于留货'}})
    assert response.status_code==422 and numbers(client,params)==(10,3,7)
    item=adjustment(client,params,8);result=confirm(client,item)
    assert result.status_code==200,result.text
    assert numbers(client,params)==(8,3,5)
    assert confirm(client,item).json()==result.json()


def test_ac36_outbound_reduction_restores_stock_without_changing_reserved(opening):
    client,params=opening
    params={**params,'opening_reservations':[{**params['opening_reservations'][0],'remaining_quantity':1}]}
    assert confirm(client,draft(client,params)).status_code==200
    original=confirm(client,change(client,'inventory_outbound',params,quantity=2)).json()
    assert numbers(client,params)==(8,1,7)
    item=correction(client,original['business_id'],1);receipt=confirm(client,item)
    assert receipt.status_code==200,receipt.text
    assert numbers(client,params)==(9,1,8)
    assert confirm(client,item).json()==receipt.json()


def test_ac37_pickup_reduction_reopens_ended_reservation_and_restores_h_and_r(application,stock):
    client,params=stock;selected=balance(client,params)['reservations'][0]['id']
    original=confirm(client,reservation_action(client,'reservation_pickup',selected,3)).json()
    assert numbers(client,params)==(7,0,7)
    assert original['reservation']['status']=='ended'
    item=correction(client,original['business_id'],2);receipt=confirm(client,item)
    assert receipt.status_code==200,receipt.text
    assert numbers(client,params)==(8,1,7)
    row=balance(client,params)['reservations'][0]
    assert (row['picked_quantity'],row['remaining_quantity'],row['status'])==(2,1,'active')
    assert confirm(client,item).json()==receipt.json()
    with application.state.sessions() as db:
        assert db.scalar(text('SELECT sum(reserved_delta) FROM inventory_ledger'))==1
        assert db.scalar(text('SELECT sum(registered_quantity-picked_quantity-cancelled_quantity) FROM inventory_reservations'))==1


def test_ac38_pickup_increase_cannot_consume_already_cancelled_quantity(application,stock):
    client,params=stock;selected=balance(client,params)['reservations'][0]['id']
    original=confirm(client,reservation_action(client,'reservation_pickup',selected,2)).json()
    assert confirm(client,reservation_action(client,'reservation_cancel',selected,1)).status_code==200
    assert invalid_correction(client,original['business_id'],3).status_code==422
    assert numbers(client,params)==(8,0,8)
    row=balance(client,params)['reservations'][0]
    assert (row['picked_quantity'],row['cancelled_quantity'],row['remaining_quantity'])==(2,1,0)
    with application.state.sessions() as db:
        assert db.scalar(text('SELECT effective_quantity FROM inventory_documents WHERE id=:id'),
                         {'id':original['business_id']})==2
        assert db.scalar(text('SELECT count(*) FROM inventory_documents WHERE original_document_id IS NOT NULL'))==0


def test_inbound_reduction_cannot_remove_stock_already_needed_for_reservations(stock):
    client,params=stock;original=original_inbound(client,params)
    assert confirm(client,change(client,'inventory_outbound',params,quantity=12)).status_code==200
    assert invalid_correction(client,original['business_id'],4).status_code==422
    assert numbers(client,params)==(3,3,0)


def test_outbound_increase_cannot_exceed_current_available_stock(stock):
    client,params=stock;original=confirm(client,change(client,'inventory_outbound',params,quantity=2)).json()
    assert invalid_correction(client,original['business_id'],8).status_code==422
    assert numbers(client,params)==(8,3,5)


@pytest.mark.parametrize('quantity',[-1,True,1.5,2147483648])
def test_invalid_correction_quantity_never_mutates_balance(stock,quantity):
    client,params=stock;original=original_inbound(client,params)
    assert invalid_correction(client,original['business_id'],quantity).status_code==422
    assert numbers(client,params)==(15,3,12)


@pytest.mark.parametrize('kind',['inventory_adjustment','inventory_correction'])
def test_non_owner_cannot_preview_or_confirm_corrections(application,stock,kind):
    owner,params=stock;original=original_inbound(owner,params);create_user(owner)
    item=correction(owner,original['business_id'],4) if kind=='inventory_correction' else adjustment(owner,params,9)
    with TestClient(application) as worker:
        login(worker,{'username':'demo-stock','password':'Sample-Stock-Password-123'})
        assert worker.post('/api/drafts',headers=csrf(worker),json={'kind':kind,'parameters':{}}).status_code==403
        assert confirm(worker,item).status_code==403
        assert worker.get('/api/operations/'+item['operation_id']).status_code==403
    assert numbers(owner,params)==(15,3,12)


def test_new_correction_rejects_old_preview_and_changed_confirmation(stock):
    client,params=stock;original=original_inbound(client,params)
    old=correction(client,original['business_id'],4);new=correction(client,original['business_id'],3)
    assert confirm(client,old,parameters={**old['parameters'],'new_quantity':2}).status_code==409
    assert confirm(client,new).status_code==200
    assert confirm(client,old).status_code==409
    assert numbers(client,params)==(13,3,10)


def test_concurrent_corrections_to_same_original_allow_only_one_commit(application,stock):
    client,params=stock;original=original_inbound(client,params)
    a=correction(client,original['business_id'],4);b=correction(client,original['business_id'],3)
    with TestClient(application) as other:
        login(other)
        with ThreadPoolExecutor(max_workers=2) as pool:
            one,two=pool.submit(confirm,client,a),pool.submit(confirm,other,b)
            results=[one.result(),two.result()]
    assert sorted(r.status_code for r in results)==[200,409]
    assert numbers(client,params) in [(14,3,11),(13,3,10)]
    with application.state.sessions() as db:
        assert db.scalar(text('SELECT count(*) FROM inventory_documents WHERE original_document_id=:id'),
                         {'id':original['business_id']})==1


def test_correction_commit_failure_rolls_back_original_ledger_balance_and_receipt(application,stock):
    client,params=stock;original=original_inbound(client,params);item=correction(client,original['business_id'],4)
    headers=csrf(client);observed=[]
    def fail(db):
        observed.append((db.scalar(text('SELECT on_hand FROM inventory_accounts')),
            db.scalar(text('SELECT effective_quantity FROM inventory_documents WHERE id=:id'),{'id':original['business_id']})))
        raise RuntimeError('correction before commit')
    event.listen(Session,'before_commit',fail)
    try:
        with pytest.raises(RuntimeError,match='correction before commit'):
            client.post('/api/operations/'+item['operation_id']+'/confirm',headers=headers,json={
                'draft_id':item['id'],'draft_version':item['version'],'parameters':item['parameters']})
    finally:event.remove(Session,'before_commit',fail)
    assert observed==[(14,4)]
    assert numbers(client,params)==(15,3,12)
    with application.state.sessions() as db:
        assert db.scalar(text('SELECT effective_quantity FROM inventory_documents WHERE id=:id'),
                         {'id':original['business_id']})==5
        assert db.scalar(text('SELECT count(*) FROM inventory_documents'))==2
        assert db.scalar(text('SELECT count(*) FROM inventory_ledger'))==2
    assert client.get('/api/operations/'+item['operation_id']).json()['result'] is None
    assert confirm(client,item).status_code==200


def test_correction_cannot_target_opening_or_another_correction(application,stock):
    client,params=stock;original=original_inbound(client,params)
    corrected=confirm(client,correction(client,original['business_id'],4)).json()
    with application.state.sessions() as db:
        opening_id=db.scalar(text("SELECT id FROM inventory_documents WHERE kind='opening'"))
    assert invalid_correction(client,opening_id,0).status_code==422
    assert invalid_correction(client,corrected['business_id'],0).status_code==422
    assert numbers(client,params)==(14,3,11)


@pytest.mark.parametrize('kind',['inventory_adjustment','inventory_correction'])
def test_missing_correction_details_are_saved_without_executable_operation(stock,kind):
    client,params=stock
    response=client.post('/api/drafts',headers=csrf(client),json={'kind':kind,'parameters':{}})
    assert response.status_code==201,response.text
    item=response.json()
    assert item['state']=='missing' and item['operation_id'] is None and item['missing_fields']
    assert numbers(client,params)==(10,3,7)


@pytest.mark.parametrize('on_hand',[-1,True,1.5,2147483648])
def test_invalid_adjustment_target_is_rejected_before_stock_changes(stock,on_hand):
    client,params=stock
    response=client.post('/api/drafts',headers=csrf(client),json={'kind':'inventory_adjustment','parameters':{
        'warehouse_id':params['warehouse_id'],'model_id':params['model_id'],'on_hand':on_hand,
        'occurred':{'precision':'date','date':'2026-10-04'},'basis_note':'非法盘点目标'}})
    assert response.status_code==422 and numbers(client,params)==(10,3,7)


def test_adjustment_obeys_t0_and_does_not_invent_same_day_precision(stock):
    client,params=stock
    response=client.post('/api/drafts',headers=csrf(client),json={'kind':'inventory_adjustment','parameters':{
        'warehouse_id':params['warehouse_id'],'model_id':params['model_id'],'on_hand':8,
        'occurred':{'precision':'date','date':'2026-09-30'},'basis_note':'T0之前盘点已包含在起点'}})
    assert response.status_code==422
    item=adjustment(client,params,8,occurred={'precision':'date','date':'2026-10-01'})
    assert item['state']=='missing' and item['operation_id'] is None
    assert 'occurred.t0_relation' in item['missing_fields']
    assert numbers(client,params)==(10,3,7)



def test_same_correction_operation_concurrent_replay_writes_once(application,stock):
    client,params=stock;original=original_inbound(client,params)
    item=correction(client,original['business_id'],4)
    with TestClient(application) as other:
        login(other)
        with ThreadPoolExecutor(max_workers=2) as pool:
            first,second=pool.submit(confirm,client,item),pool.submit(confirm,other,item)
            a,b=first.result(),second.result()
    assert a.status_code==b.status_code==200
    assert a.json()==b.json() and numbers(client,params)==(14,3,11)
    with application.state.sessions() as db:
        assert db.scalar(text('SELECT count(*) FROM inventory_documents WHERE original_document_id=:id'),
                         {'id':original['business_id']})==1
        assert db.scalar(text('SELECT count(*) FROM inventory_ledger'))==3


def test_correction_lost_response_recovers_after_restart_without_second_effect(settings,stock):
    from app.main import create_app
    from starlette.responses import Response
    client,params=stock;original=original_inbound(client,params)
    item=correction(client,original['business_id'],4)
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
            saved=other.get('/api/operations/'+item['operation_id']).json()
            assert saved['state']=='succeeded'
            assert confirm(other,item).json()==saved['result']
            assert numbers(other,params)==(14,3,11)
            assert other.get('/api/drafts/'+item['id']).json()['state']=='succeeded'
        with restarted.state.sessions() as db:
            assert db.scalar(text('SELECT count(*) FROM inventory_documents WHERE original_document_id=:id'),
                             {'id':original['business_id']})==1
    finally:restarted.state.engine.dispose()


def test_correction_preserves_original_microseconds_and_statistics_occurrence_day(application,stock):
    client,params=stock
    precise='2026-10-01T23:59:59.123456+00:00'
    item=change(client,'inventory_inbound',params,quantity=5,occurred={'precision':'datetime','at':precise})
    original=confirm(client,item).json()
    assert confirm(client,correction(client,original['business_id'],4)).status_code==200
    with application.state.sessions() as db:
        row=db.execute(text('SELECT occurred_precision,occurred_at,occurred_date FROM inventory_documents WHERE id=:id'),
                       {'id':original['business_id']}).one()
        assert row.occurred_precision=='datetime' and row.occurred_date is None
        from datetime import datetime
        assert row.occurred_at==datetime.fromisoformat(precise)
        assert row.occurred_at.microsecond==123456
    filters={key:params[key] for key in ['warehouse_id','model_id']}
    correct_day=client.get('/api/inventory/statistics',params={**filters,'start':'2026-10-02','end':'2026-10-02'})
    assert correct_day.status_code==200,correct_day.text
    assert correct_day.json()['total_quantity']==4
    assert len(correct_day.json()['documents'])==1
    assert correct_day.json()['documents'][0]['id']==original['business_id']
    utc_day=client.get('/api/inventory/statistics',params={**filters,'start':'2026-10-01','end':'2026-10-01'})
    assert utc_day.status_code==200 and utc_day.json()['total_quantity']==0


@pytest.mark.parametrize('recorded',[False,True])
def test_migration_0006_refuses_to_drop_correction_draft_or_recorded_history(application,settings,stock,recorded):
    from alembic import command
    from alembic.config import Config
    client,params=stock;original=original_inbound(client,params)
    item=correction(client,original['business_id'],4)
    if recorded:
        assert confirm(client,item).status_code==200
    cfg=Config('alembic.ini');cfg.attributes['database_url']=settings.database_url
    with application.state.sessions() as db:
        original_revision=db.scalar(text('SELECT version_num FROM alembic_version'))
    with pytest.raises(RuntimeError,match='Cannot discard correction history'):
        command.downgrade(cfg,'0005_reservation_operations')
    with application.state.sessions() as db:
        assert db.scalar(text('SELECT version_num FROM alembic_version'))==original_revision
        assert db.scalar(text('SELECT count(*) FROM drafts WHERE id=:id'),{'id':item['id']})==1
        assert db.scalar(text('SELECT count(*) FROM inventory_documents WHERE original_document_id=:id'),
                         {'id':original['business_id']})==int(recorded)
    assert confirm(client,item).status_code==200
    assert numbers(client,params)==(14,3,11)


def test_empty_migration_roundtrip_and_metadata(application,settings):
    from alembic import command
    from alembic.config import Config
    cfg=Config('alembic.ini');cfg.attributes['database_url']=settings.database_url
    command.downgrade(cfg,'0005_reservation_operations')
    command.upgrade(cfg,'head')
    command.check(cfg)
