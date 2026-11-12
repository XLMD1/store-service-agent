'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const mock=require('../app/web/mock-api.js');
assert.equal(global.FrontendMock,undefined,'CommonJS import must not enable mock mode in unrelated API tests');
const occurred={precision:'date',date:'2026-11-02'};
async function fixture(scenario='normal') {
  mock.setScenario(scenario);mock.reset();
  const [warehouses,models,customers]=await Promise.all(['/catalog/warehouses','/catalog/models','/catalog/customers'].map(p=>mock.request(p)));
  const base={warehouse_id:warehouses[0].id,model_id:models[0].id,occurred,basis_note:'虚构测试依据'};
  return {warehouses,models,customers,base};
}
const save=(kind,parameters)=>mock.request('/drafts','POST',{kind,parameters});
const confirm=draft=>mock.request('/operations/'+draft.operation_id+'/confirm','POST',{draft_id:draft.id,draft_version:draft.version,parameters:draft.parameters});
const commit=async(kind,parameters)=>confirm(await save(kind,parameters));
const readBalance=base=>mock.request('/inventory/balance?'+new URLSearchParams({warehouse_id:base.warehouse_id,model_id:base.model_id}));
const error=status=>e=>e.status===status&&e.message.includes('演示');

test('isolated adapter rejects unknown endpoints and never uses network',async()=>{
  const oldFetch=global.fetch;let calls=0;global.fetch=()=>{calls++;throw Error('network forbidden');};
  try {await fixture();await assert.rejects(mock.request('/missing','POST',{}),error(404));assert.equal(calls,0);}finally{global.fetch=oldFetch;}
});
test('query snapshots are detached; uninitialized balance remains unknown',async()=>{
  const {warehouses,models,base}=await fixture();warehouses[0].name='mutated';assert.equal((await mock.request('/catalog/warehouses'))[0].name,'样例一号库');
  const empty=await readBalance({...base,model_id:models[1].id});assert.equal(empty.on_hand,null);assert.equal(empty.status,'uninitialized');assert.equal((await readBalance(base)).available,10);
});
test('inbound / reserve / pickup / cancel / outbound preserve all stock invariants',async()=>{
  const {base,customers}=await fixture();
  const draft=await save('inventory_inbound',{...base,quantity:5});assert.equal((await readBalance(base)).on_hand,12);assert.equal(draft.preview.after.on_hand,17);await confirm(draft);
  const reserveDraft=await save('reservation_create',{...base,quantity:4,customer_id:customers[0].id,basis_kind:'deposit',basis_note:''});assert.equal(reserveDraft.preview.customer.id,customers[0].id);assert.equal(reserveDraft.preview.customer.display_name,customers[0].display_name);const reserve=await confirm(reserveDraft);const rid=reserve.reservation.id;
  assert.equal(reserve.balance.reserved,6);assert.equal(reserve.balance.available,11);
  const pickup=await commit('reservation_pickup',{reservation_id:rid,quantity:2,occurred,basis_note:'样例提货'});assert.equal(pickup.balance.on_hand,15);assert.equal(pickup.balance.reserved,4);assert.equal(pickup.balance.available,11);
  await commit('reservation_cancel',{reservation_id:rid,quantity:2,occurred,basis_note:'样例取消'});
  const outbound=await commit('inventory_outbound',{...base,quantity:3});assert.equal(outbound.balance.on_hand,12);assert.equal(outbound.balance.available,10);
  const rows=await mock.request('/inventory/reservations?active_only=false&q='+rid);assert.equal(rows[0].remaining_quantity,0);assert.equal(rows[0].picked_quantity,2);assert.equal(rows[0].cancelled_quantity,2);
  assert.equal((await mock.request('/inventory/reconciliation')).consistent,true);
});
test('confirmation is idempotent and binds parameters, version and actor',async()=>{
  const {base}=await fixture();const draft=await save('inventory_inbound',{...base,quantity:3}),receipt=await confirm(draft);assert.deepEqual(await confirm(draft),receipt);assert.equal((await readBalance(base)).on_hand,15);
  await assert.rejects(mock.request('/operations/'+draft.operation_id+'/confirm','POST',{draft_id:draft.id,draft_version:draft.version,parameters:{...draft.parameters,quantity:4}}),error(409));
  await mock.request('/auth/login','POST',{username:'demo-stock_operator',password:'demo'});await assert.rejects(confirm(draft),error(403));
});
test('draft revisions invalidate old operation; concurrent account versions conflict',async()=>{
  const {base}=await fixture();const first=await save('inventory_inbound',{...base,quantity:1}),second=await save('inventory_inbound',{...base,quantity:2});
  await confirm(second);await assert.rejects(confirm(first),error(409));
  const revised=await mock.request('/drafts/'+first.id,'PATCH',{expected_version:1,parameters:{...base,quantity:4}});
  assert.equal((await mock.request('/operations/'+first.operation_id)).state,'invalidated');await assert.rejects(confirm(first),error(409));await confirm(revised);assert.equal((await readBalance(base)).on_hand,18);
  await assert.rejects(mock.request('/drafts/'+first.id,'PATCH',{expected_version:1,parameters:first.parameters}),error(409));
});
test('pending preserves committed receipt and supports recovery and replay',async()=>{
  const {base}=await fixture();const draft=await save('inventory_inbound',{...base,quantity:7});mock.setScenario('pending');await assert.rejects(confirm(draft),error(0));
  const operation=await mock.request('/operations/'+draft.operation_id);assert.equal(operation.state,'succeeded');assert.equal(operation.result.balance.on_hand,19);assert.deepEqual(await confirm(draft),operation.result);assert.equal((await readBalance(base)).on_hand,19);
});
test('empty/error/conflict scenarios are explicit and do not silently write',async()=>{
  const {base}=await fixture('empty');assert.equal((await readBalance(base)).status,'uninitialized');assert.equal((await mock.request('/inventory/reconciliation')).consistent,null);
  mock.setScenario('error');await assert.rejects(mock.request('/catalog/models'),error(503));mock.setScenario('normal');mock.reset();
  const draft=await save('inventory_inbound',{...base,quantity:2});mock.setScenario('conflict');await assert.rejects(confirm(draft),error(409));assert.equal((await readBalance(base)).on_hand,12);mock.setScenario('normal');await confirm(draft);
});
test('opening supports customer pre-reservations and prevents duplicate opening',async()=>{
  const {base,customers,models}=await fixture();const params={warehouse_id:base.warehouse_id,model_id:models[1].id,t0:'2026-11-01T08:00:00+08:00',on_hand:8,basis_note:'样例盘点',opening_reservations:[{customer_id:customers[0].id,remaining_quantity:3,basis_note:'样例旧留货'}]};
  const receipt=await commit('inventory_opening',params);assert.equal(receipt.balance.available,5);assert.equal(receipt.balance.reservations[0].is_opening,true);await assert.rejects(save('inventory_opening',params),error(409));assert.equal((await mock.request('/inventory/reconciliation')).consistent,true);
});
test('T0 date boundaries remain missing until resolved; old events and fractional quantities rejected',async()=>{
  const {base}=await fixture();const partial=await save('inventory_inbound',{...base,quantity:1,occurred:{precision:'date',date:'2026-11-01'}});assert.equal(partial.state,'missing');assert.ok(partial.missing_fields.includes('occurred.t0_relation'));assert.equal(partial.operation_id,null);
  await assert.rejects(save('inventory_inbound',{...base,quantity:1,occurred:{precision:'datetime',at:'2026-11-01T00:00:00Z'}}),error(422));
  await assert.rejects(save('inventory_inbound',{...base,quantity:1,occurred:{precision:'date',date:'2026-11-01',t0_relation:'at_or_before'}}),error(422));
  await assert.rejects(save('inventory_inbound',{...base,quantity:1.5}),error(422));
  await assert.rejects(save('inventory_outbound',{...base,quantity:11}),error(422));
  await assert.rejects(save('inventory_adjustment',{warehouse_id:base.warehouse_id,model_id:base.model_id,on_hand:1,occurred,basis_note:'样例盘点'}),error(422));
});
test('statistics use effective inbound originals only, retain corrections, and exclude adjustment',async()=>{
  const {base}=await fixture();const inbound=await commit('inventory_inbound',{...base,quantity:5});
  await commit('inventory_correction',{document_id:inbound.business_id,new_quantity:3,basis_note:'样例原单核实'});
  await commit('inventory_adjustment',{warehouse_id:base.warehouse_id,model_id:base.model_id,on_hand:20,occurred,basis_note:'样例实物盘点'});
  const result=await mock.request('/inventory/statistics?start=2026-11-01&end=2026-11-03&group_by=model');assert.equal(result.total_quantity,7);assert.equal(result.documents.length,2);const corrected=result.documents.find(row=>row.id===inbound.business_id);assert.equal(corrected.original_quantity,5);assert.equal(corrected.effective_quantity,3);assert.equal(corrected.corrections.length,1);assert.equal(result.groups[0].quantity,7);
  const ledger=await mock.request('/inventory/ledger?'+new URLSearchParams({warehouse_id:base.warehouse_id,model_id:base.model_id}));const originalLedger=ledger.find(row=>row.business_id===inbound.business_id);assert.equal(originalLedger.quantity,3);assert.equal(originalLedger.on_hand_delta,5);const correctionLedger=ledger.find(row=>row.original_document_id===inbound.business_id);assert.equal(correctionLedger.quantity,-2);assert.equal(correctionLedger.on_hand_delta,-2);
  assert.equal((await mock.request('/inventory/reconciliation')).consistent,true);
});
test('pickup correction restores reserved and physical quantities together',async()=>{
  const {base}=await fixture();const r=(await mock.request('/inventory/reservations'))[0];const pickup=await commit('reservation_pickup',{reservation_id:r.id,quantity:2,occurred,basis_note:'样例提货'});
  await commit('inventory_correction',{document_id:pickup.business_id,new_quantity:1,basis_note:'核实只提一台'});const b=await readBalance(base);assert.equal(b.on_hand,11);assert.equal(b.reserved,1);assert.equal(b.available,10);assert.equal(b.reservations[0].picked_quantity,1);assert.equal((await mock.request('/inventory/reconciliation')).consistent,true);
});
test('catalog confirmation and version controls, demo authentication and role permissions',async()=>{
  await fixture();await assert.rejects(mock.request('/catalog/models','POST',{name:'虚构型号'}),error(422));
  const row=await mock.request('/catalog/models','POST',{name:'虚构型号',confirmed:true});await mock.request('/catalog/models/'+row.id,'PATCH',{name:'虚构型号第二版',expected_version:1,confirmed:true});await assert.rejects(mock.request('/catalog/models/'+row.id,'PATCH',{name:'stale',expected_version:1,confirmed:true}),error(409));
  await mock.request('/auth/logout','POST');await assert.rejects(mock.request('/auth/me'),error(401));await assert.rejects(mock.request('/auth/login','POST',{username:'real-user',password:'real-secret'}),error(401));
  await mock.request('/auth/login','POST',{username:'demo-technician',password:'演示'});await assert.rejects(mock.request('/inventory/reconciliation'),error(403));await assert.rejects(save('inventory_inbound',{}),error(403));
});
