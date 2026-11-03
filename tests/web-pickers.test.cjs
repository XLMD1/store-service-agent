'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const fs=require('node:fs');
const pickerSource=fs.readFileSync(require.resolve('../app/web/pickers.js'),'utf8');
async function harness(){
  const dom=new JSDOM('<div id="app"><form><label class="field"><span>库房</span><select name="warehouse" required><option value="">请选择库房</option><option value="a">样例一号库</option><option value="b">样例二号库</option><option value="x" disabled>停用库</option></select></label><label class="field"><span>型号</span><select name="model"><option value="">全部型号</option><option value="m">样例A</option></select></label></form></div>',{url:'https://example.test',runScripts:'outside-only'});
  dom.window.eval(pickerSource);await new Promise(resolve=>setImmediate(resolve));return dom;
}
test('shared picker preserves FormData, required validity and full-list replacement without clearing text',async()=>{
  const dom=await harness(),w=dom.window,d=w.document,select=d.querySelector('select'),input=d.querySelector('[role=combobox]'),trigger=d.querySelector('.picker-trigger');
  assert.ok(select.hidden);assert.equal(input.required,true);assert.equal(d.querySelector('form').checkValidity(),false);
  trigger.click();const choices=d.querySelector('.picker-choices');assert.equal(choices.querySelectorAll('button').length,3);
  choices.querySelectorAll('button')[1].click();assert.equal(input.value,'样例一号库');assert.equal(new w.FormData(select.form).get('warehouse'),'a');assert.equal(select.form.checkValidity(),true);
  trigger.click();choices.querySelectorAll('button')[2].click();assert.equal(input.value,'样例二号库');assert.equal(select.value,'b');
  input.value='不存在';input.dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(select.value,'');assert.equal(input.validity.valid,false);assert.match(choices.textContent,/没有匹配选项/);
  trigger.click();trigger.click();assert.equal(choices.querySelectorAll('button').length,3);dom.window.close();
});
test('search, keyboard, Escape focus, mutual exclusion, optional clear and change callbacks',async()=>{
  const dom=await harness(),w=dom.window,d=w.document,inputs=d.querySelectorAll('[role=combobox]'),triggers=d.querySelectorAll('.picker-trigger');let changed=0;
  d.querySelector('select').addEventListener('change',()=>changed++);
  inputs[0].value='二号';inputs[0].dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(d.querySelectorAll('.picker-choices:not([hidden]) [role=option]').length,1);
  inputs[0].dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));assert.equal(d.querySelector('select').value,'b');assert.equal(changed,2);
  triggers[0].click();triggers[1].click();assert.equal(d.querySelectorAll('.picker-choices:not([hidden])').length,1);
  inputs[1].dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));assert.equal(d.activeElement.getAttribute('role'),'option');
  d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(d.activeElement,triggers[1]);assert.equal(triggers[1].getAttribute('aria-expanded'),'false');
  triggers[1].click();triggers[1].dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(triggers[1].getAttribute('aria-expanded'),'false');assert.equal(d.activeElement,triggers[1]);
  triggers[1].click();const menu=d.querySelectorAll('.picker-choices')[1];menu.querySelectorAll('button')[1].click();assert.equal(d.querySelector('[name=model]').value,'m');triggers[1].click();menu.querySelector('button').click();assert.equal(d.querySelector('[name=model]').value,'');dom.window.close();
});
test('dynamic selects, disabled state, explicit programmatic refresh and reset stay synchronized',async()=>{
  const dom=await harness(),w=dom.window,d=w.document,select=d.querySelector('select');
  select.value='a';w.FrontendPickers.refresh();assert.equal(d.querySelector('[role=combobox]').value,'样例一号库');
  select.disabled=true;await new Promise(resolve=>setImmediate(resolve));assert.ok(d.querySelector('.picker-trigger').disabled);assert.ok(d.querySelector('[role=combobox]').disabled);
  select.disabled=false;select.form.insertAdjacentHTML('beforeend','<label class="field"><span>时间精度</span><select name="precision"><option value="date">日期</option><option value="datetime">精确时刻</option></select></label>');await new Promise(resolve=>setImmediate(resolve));assert.equal(d.querySelectorAll('[role=combobox]').length,3);
  let precision='';const native=d.querySelector('[name=precision]');native.onchange=()=>precision=native.value;const last=d.querySelectorAll('.picker-trigger')[2];last.click();d.querySelectorAll('.picker-choices')[2].querySelectorAll('button')[1].click();assert.equal(precision,'datetime');
  select.form.reset();await new Promise(resolve=>setImmediate(resolve));assert.equal(d.querySelector('[role=combobox]').value,'');assert.equal(d.querySelectorAll('[role=combobox]')[2].value,'日期');dom.window.close();
});
