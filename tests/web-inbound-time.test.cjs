const {test} = require('node:test');
const assert = require('node:assert/strict');
const {inboundParameters} = require('../app/web/inbound.js');

function parameters(values, original) {
  const previous = global.FormData;
  global.FormData = class { constructor(){return new Map(Object.entries(values));} };
  try { return inboundParameters({}, original); }
  finally {global.FormData=previous;}
}
const values = {warehouse_id:'w',model_id:'m',quantity:'5',precision:'datetime',at:'2026-10-01T00:00:30',basis_note:'样例'};

test('恢复后仅修改数量，必须保留原发生时刻的秒和微秒',()=>{
  const result=parameters(values,{displayed:'2026-10-01T00:00:30',raw:'2026-09-30T16:00:30.123456Z'});
  assert.equal(result.occurred.at,'2026-09-30T16:00:30.123456Z');
});
test('人工修改精确时刻后保留所填秒数，不再附加一组00秒',()=>{
  assert.equal(parameters(values).occurred.at,'2026-10-01T00:00:30+08:00');
});
