from uuid import uuid4

from fastapi.testclient import TestClient
from tests.integration.test_auth import csrf,login,create_user
from tests.integration.test_inventory_opening import opening,add,draft,confirm


def test_warehouse_single_name_generates_code_and_rename_preserves_identity(application):
    with TestClient(application) as client:
        login(client)
        one=add(client,'warehouses',{'name':'单字段示例库'})
        two=add(client,'warehouses',{'name':'另一个示例库'})
        assert one['code'] and len(one['code'])<=32 and one['code']!=two['code']
        renamed=client.patch('/api/catalog/warehouses/'+one['id'],headers=csrf(client),json={
            'expected_version':1,'name':'单字段示例库改名','confirmed':True})
        assert renamed.status_code==200
        assert renamed.json()['id']==one['id'] and renamed.json()['code']==one['code']
        assert client.post('/api/catalog/warehouses',headers=csrf(client),json={'name':'缺少人工确认'}).status_code==422
        assert client.post('/api/catalog/warehouses',headers=csrf(client),json={'name':'不允许显式空编号','code':None,'confirmed':True}).status_code==422


def test_warehouse_overview_lists_multiple_models_zero_and_unknown_without_cross_warehouse_totals(opening):
    client,params=opening
    assert confirm(client,draft(client,params)).status_code==200
    zero=add(client,'models',{'name':'示例型号B零库存'})
    unknown=add(client,'models',{'name':'示例型号C未建账'})
    another=add(client,'warehouses',{'code':'OTHER','name':'另一个库'})
    assert confirm(client,draft(client,{**params,'model_id':zero['id'],'on_hand':0,'opening_reservations':[]})).status_code==200
    assert confirm(client,draft(client,{**params,'warehouse_id':another['id'],'on_hand':50,'opening_reservations':[]})).status_code==200
    response=client.get('/api/inventory/overview',params={'warehouse_id':params['warehouse_id']})
    assert response.status_code==200
    result=response.json();rows={row['model']['id']:row for row in result['items']}
    assert result['warehouse']['id']==params['warehouse_id'] and result['queried_at']
    assert result['totals']=={'on_hand':10,'reserved':3,'available':7,'opened_model_count':2,'uninitialized_model_count':1}
    assert len(rows)==3 and rows[zero['id']]['status']=='opened' and rows[zero['id']]['on_hand']==0
    assert rows[unknown['id']]['status']=='uninitialized' and rows[unknown['id']]['on_hand'] is None
    single=client.get('/api/inventory/overview',params={'warehouse_id':params['warehouse_id'],'model_id':zero['id']}).json()
    assert len(single['items'])==1 and single['totals']['on_hand']==0
    single=client.get('/api/inventory/overview',params={'warehouse_id':params['warehouse_id'],'model_id':unknown['id']}).json()
    assert single['totals']['on_hand'] is None and single['totals']['opened_model_count']==0


def test_overview_empty_unknown_targets_permissions_and_disabled_history(application,opening):
    client,params=opening
    response=client.get('/api/inventory/overview',params={'warehouse_id':params['warehouse_id']})
    assert response.status_code==200 and response.json()['totals']['on_hand'] is None
    assert client.get('/api/inventory/overview',params={'warehouse_id':str(uuid4())}).status_code==404
    assert client.get('/api/inventory/overview',params={'warehouse_id':params['warehouse_id'],'model_id':str(uuid4())}).status_code==404
    assert client.get('/api/inventory/overview').status_code==422
    assert confirm(client,draft(client,params)).status_code==200
    assert client.patch('/api/catalog/warehouses/'+params['warehouse_id'],headers=csrf(client),json={
        'expected_version':1,'enabled':False,'confirmed':True}).status_code==200
    assert client.get('/api/inventory/overview',params={'warehouse_id':params['warehouse_id']}).json()['totals']['on_hand']==10
    create_user(client,roles=['technician'])
    with TestClient(application) as worker:
        assert worker.get('/api/inventory/overview',params={'warehouse_id':params['warehouse_id']}).status_code==401
        login(worker,{'username':'demo-stock','password':'Sample-Stock-Password-123'})
        assert worker.get('/api/inventory/overview',params={'warehouse_id':params['warehouse_id']}).status_code==200
        assert worker.post('/api/catalog/warehouses',headers=csrf(worker),json={'name':'不能新建','confirmed':True}).status_code==403
