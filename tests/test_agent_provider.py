import json
from urllib.error import HTTPError
from http.client import IncompleteRead

import pytest

from app.agent.provider import DeepSeekPlanner, ProviderUnavailable


class Response:
    def __init__(self, payload):self.payload=payload
    def __enter__(self):return self
    def __exit__(self,*args):pass
    def read(self,limit):return json.dumps(self.payload).encode()[:limit]


def envelope(content='{"steps":[],"question":"请补库房"}', **extra):
    return {'choices':[{'finish_reason':'stop','message':{'content':content}}],
            'usage':{'total_tokens':17}, **extra}


def test_deepseek_contract_uses_server_key_json_mode_and_bounded_output(monkeypatch):
    monkeypatch.setenv('DEEPSEEK_API_KEY','synthetic-unit-key')
    monkeypatch.delenv('DEEPSEEK_MODEL',raising=False)
    seen=[]
    def send(request,timeout):
        seen.append((request,timeout));return Response(envelope())
    monkeypatch.setattr('app.agent.provider.urlopen',send)
    plan, usage=DeepSeekPlanner().parse('查样例库存',{'today':'2026-11-03'},[])
    request,timeout=seen[0];body=json.loads(request.data)
    assert request.full_url=='https://api.deepseek.com/chat/completions'
    assert request.headers['Authorization']=='Bearer synthetic-unit-key'
    assert body['model']=='deepseek-flash' and body['response_format']=={'type':'json_object'}
    assert body['max_tokens']==2048 and not body['stream'] and timeout==30
    assert 'json' in body['messages'][0]['content'] and 'synthetic-unit-key' not in str(body)
    assert plan['question']=='请补库房' and usage['total_tokens']==17


@pytest.mark.parametrize('payload',[
    envelope('  '),envelope('{'),envelope('{"steps":[{"action":"confirm","confirmed":true}]}'),
    {'choices':[]},{'choices':None},envelope(usage={'total_tokens':True}),
    {'choices':[{'finish_reason':'length','message':{'content':'{}'}}]},
])
def test_malformed_or_truncated_model_response_fails_closed(monkeypatch,payload):
    monkeypatch.setenv('DEEPSEEK_API_KEY','synthetic-unit-key')
    monkeypatch.setattr('app.agent.provider.urlopen',lambda *a,**kw:Response(payload))
    with pytest.raises(ProviderUnavailable):DeepSeekPlanner().parse('测试',{},[])


def test_missing_key_never_attempts_network(monkeypatch):
    monkeypatch.delenv('DEEPSEEK_API_KEY',raising=False)
    monkeypatch.setattr('app.agent.provider.urlopen',lambda *a,**kw:pytest.fail('Unexpected network'))
    assert not DeepSeekPlanner().available
    with pytest.raises(ProviderUnavailable,match='尚未配置'):DeepSeekPlanner().parse('测试',{},[])


@pytest.mark.parametrize('error',[TimeoutError('sensitive'),HTTPError('https://api.deepseek.com',401,'sensitive',{},None),IncompleteRead(b'partial'),ConnectionResetError('sensitive')])
def test_network_errors_do_not_echo_sensitive_external_content(monkeypatch,capsys,error):
    monkeypatch.setenv('DEEPSEEK_API_KEY','synthetic-unit-key')
    def fail(*args,**kw):raise error
    monkeypatch.setattr('app.agent.provider.urlopen',fail)
    with pytest.raises(ProviderUnavailable) as caught:DeepSeekPlanner().parse('手机号原文',{},[])
    assert 'sensitive' not in str(caught.value) and 'synthetic-unit-key' not in str(caught.value)
    assert capsys.readouterr().out==''


@pytest.mark.parametrize('text,step,quantity',[
    ('今天型号A入库一台', {'quantity':1,'evidence':{'quantity':'一台'}}, 1),
    ('今天型号A入库十二台', {'quantity':12,'evidence':{'quantity':'十二台'}}, 12),
    ('今天型号A入库两台', {'quantity':2,'evidence':{'quantity':'两台'}}, 2),
    ('今天型号A入库１台', {'quantity':1,'evidence':{'quantity':'１台'}}, 1),
    ('今天型号A入库2台', {'quantity':20,'evidence':{'quantity':'2台'}}, None),
    ('今天型号A入库2台', {'quantity':2,'evidence':{'quantity':'3台'}}, None),
    ('今天型号A入库', {'quantity':1}, None),
    ('2026年11月4日型号A2入库', {'quantity':2,'evidence':{'quantity':'A2'}}, None),
    ('数量不是2台，尚未核实', {'quantity':2,'evidence':{'quantity':'不是2台'}}, None),
    ('数量不是2台，尚未核实', {'quantity':2,'evidence':{'quantity':'2台'}}, None),
    ('入库12台', {'quantity':2,'evidence':{'quantity':'2台'}}, None),
    ('入库2.5台', {'quantity':5,'evidence':{'quantity':'5台'}}, None),
    ('型号A2入库', {'quantity':2,'evidence':{'quantity':'2'}}, None),
    ('从二号库出库型号A2一台', {'quantity':1,'evidence':{'quantity':'一台'}}, 1),
    ('大概两三台', {'quantity':23,'evidence':{'quantity':'两三台'}}, None),
    ('三四台待核实', {'quantity':34,'evidence':{'quantity':'三四台'}}, None),
    ('到货一百二台', {'quantity':102,'evidence':{'quantity':'一百二台'}}, None),
])
def test_model_quantity_requires_matching_literal_source(monkeypatch,text,step,quantity):
    monkeypatch.setenv('DEEPSEEK_API_KEY','synthetic-unit-key')
    content=json.dumps({'steps':[{'action':'inventory_inbound',**step}]},ensure_ascii=False)
    monkeypatch.setattr('app.agent.provider.urlopen',lambda *a,**kw:Response(envelope(content)))
    plan,usage=DeepSeekPlanner().parse(text,{},[])
    assert plan['steps'][0]['quantity']==quantity
    assert usage['total_tokens']==17


def test_inbound_discards_irrelevant_deposit_and_invented_basis(monkeypatch):
    monkeypatch.setenv('DEEPSEEK_API_KEY','synthetic-unit-key')
    content=json.dumps({'steps':[{'action':'inventory_inbound','basis_kind':'deposit',
        'on_hand':10,'customer':'编造客户','basis_note':'已经核实货款'}]},ensure_ascii=False)
    monkeypatch.setattr('app.agent.provider.urlopen',lambda *a,**kw:Response(envelope(content)))
    step=DeepSeekPlanner().parse('今天样例型号入库一台',{},[])[0]['steps'][0]
    assert step['basis_kind'] is None and step['on_hand'] is None
    assert step['customer']=='' and step['basis_note']==''


@pytest.mark.parametrize('quote,kind', [('已收定金','deposit'),('口头留货','oral'),('已付全款','paid'),
    ('未付定金',None),('定金',None)])
def test_reservation_basis_kind_requires_explicit_matching_source(monkeypatch,quote,kind):
    monkeypatch.setenv('DEEPSEEK_API_KEY','synthetic-unit-key')
    content=json.dumps({'steps':[{'action':'reservation_create','basis_kind':kind or 'deposit',
        'evidence':{'basis_kind':quote}}]},ensure_ascii=False)
    monkeypatch.setattr('app.agent.provider.urlopen',lambda *a,**kw:Response(envelope(content)))
    step=DeepSeekPlanner().parse('客户留货，'+quote,{},[])[0]['steps'][0]
    assert step['basis_kind']==kind


@pytest.mark.parametrize('field,value,quote', [('on_hand',10,'十台'),('opening_reserved',0,'0'),
    ('new_quantity',0,'零台')])
def test_other_numeric_fields_require_source_and_preserve_explicit_zero(monkeypatch,field,value,quote):
    monkeypatch.setenv('DEEPSEEK_API_KEY','synthetic-unit-key')
    action='inventory_correction' if field=='new_quantity' else 'inventory_opening'
    content=json.dumps({'steps':[{'action':action,field:value,'evidence':{field:quote}}]},ensure_ascii=False)
    monkeypatch.setattr('app.agent.provider.urlopen',lambda *a,**kw:Response(envelope(content)))
    assert DeepSeekPlanner().parse('确认数量为'+quote,{},[])[0]['steps'][0][field]==value
    assert DeepSeekPlanner().parse('数量未知',{},[])[0]['steps'][0][field] is None
