const {test}=require('node:test');
const assert=require('node:assert/strict');
global.inboundParameters=require('../app/web/inbound.js').inboundParameters;
const {correctionParameters}=require('../app/web/reconciliation.js');
function parameters(kind,fields,selected,original){
  const previous=global.FormData;
  global.FormData=class{constructor(){return new Map(Object.entries(fields));}};
  try{return correctionParameters({},kind,selected,original);}finally{global.FormData=previous;}
}
test('原单更正只提交选定原单和目标有效量，不接受表单覆盖对象或日期',()=>{
  const result=parameters('inventory_correction',{document_id:'wrong',warehouse_id:'wrong',new_quantity:'0',basis_note:'核实误录',date:'2026-10-05'},{id:'original'});
  assert.deepEqual(result,{document_id:'original',new_quantity:0,basis_note:'核实误录'});
  assert.equal(parameters('inventory_correction',{new_quantity:'',basis_note:''},null).document_id,null);
});
test('盘点目标支持0，未填保持未知；恢复精确时刻不丢微秒',()=>{
  const fields={warehouse_id:'w',model_id:'m',quantity:'0',basis_note:'实物盘点',precision:'datetime',at:'2026-10-03T08:00:30'};
  const result=parameters('inventory_adjustment',fields,null,{displayed:fields.at,raw:'2026-10-03T00:00:30.123456Z'});
  assert.equal(result.on_hand,0);assert.equal(result.occurred.at,'2026-10-03T00:00:30.123456Z');assert.equal('quantity' in result,false);
  assert.equal(parameters('inventory_adjustment',{...fields,quantity:''}).on_hand,null);
});
