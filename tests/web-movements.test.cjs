const {test}=require('node:test');
const assert=require('node:assert/strict');
global.inboundParameters=require('../app/web/inbound.js').inboundParameters;
const {movementParameters}=require('../app/web/movements.js');
const values={warehouse_id:'w',model_id:'m',quantity:'2',precision:'date',date:'2026-10-03',t0_relation:'unknown',boundary_note:'',basis_note:'虚构依据',customer_id:'customer-b',basis_kind:'deposit'};
function parameters(kind,selected,extra={},original){
  const previous=global.FormData;
  global.FormData=class{constructor(){return new Map(Object.entries({...values,...extra}));}};
  try{return movementParameters({},kind,selected,original);}finally{global.FormData=previous;}
}
test('取消和提货只提交明确预留，不从表单覆盖库房型号或客户',()=>{
  for(const kind of ['reservation_cancel','reservation_pickup']){
    const result=parameters(kind,{id:'reservation-a'});
    assert.equal(result.reservation_id,'reservation-a');
    assert.deepEqual(Object.keys(result).sort(),['basis_note','occurred','quantity','reservation_id']);
    assert.equal(result.quantity,2);
  }
});
test('新留货提交人工选择的独立客户与依据标签，未知预留不自动匹配',()=>{
  const result=parameters('reservation_create');
  assert.equal(result.customer_id,'customer-b');assert.equal(result.basis_kind,'deposit');
  assert.equal(parameters('reservation_pickup',null).reservation_id,null);
});
test('提货草稿恢复后只改数量仍保留原时刻微秒',()=>{
  const result=parameters('reservation_pickup',{id:'a'},{precision:'datetime',at:'2026-10-03T08:00:30'},
    {displayed:'2026-10-03T08:00:30',raw:'2026-10-03T00:00:30.123456Z'});
  assert.equal(result.occurred.at,'2026-10-03T00:00:30.123456Z');
});
