const {test} = require('node:test');
const assert = require('node:assert/strict');
const {freezeWhile} = require('../app/web/form-state.js');

test('保存等待响应期间冻结全部输入，完成后恢复原有禁用状态', async () => {
  const controls = [{disabled:false}, {disabled:false}, {disabled:true}];
  const form = {querySelectorAll: () => controls};
  let resolve;
  const pending = freezeWhile(form, () => new Promise(done => {resolve=done;}));
  assert.deepEqual(controls.map(x=>x.disabled), [true,true,true]);
  resolve('saved');
  assert.equal(await pending, 'saved');
  assert.deepEqual(controls.map(x=>x.disabled), [false,false,true]);
});

test('保存失败也恢复表单，使用户可以修正并重新预览', async () => {
  const controls = [{disabled:false}];
  const form = {querySelectorAll: () => controls};
  await assert.rejects(freezeWhile(form, async () => {throw new Error('offline');}), /offline/);
  assert.equal(controls[0].disabled, false);
});
