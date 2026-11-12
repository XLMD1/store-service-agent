const {test}=require('node:test');
const assert=require('node:assert/strict');
const {warehouseCandidates}=require('../app/web/inventory.js');
const rows=[{id:'a',name:'2号库'},{id:'b',name:'3号库'},{id:'c',name:'2号库备用'}];
test('库房全名唯一时优先精确匹配，支持名称输入前后空格',()=>{
  assert.deepEqual(warehouseCandidates(rows,' 2号库 ').map(x=>x.id),['a']);
});
test('模糊和同名库房保留全部候选，不自动选择第一项',()=>{
  assert.deepEqual(warehouseCandidates(rows,'2号').map(x=>x.id),['a','c']);
  assert.equal(warehouseCandidates([...rows,{id:'d',name:'2号库'}],'2号库').length,2);
  assert.deepEqual(warehouseCandidates(rows,''),[]);
  assert.deepEqual(warehouseCandidates(rows,'不存在'),[]);
});
const fs=require('node:fs');
const vm=require('node:vm');
function inventoryHarness(){
  const calls=[],html=[],warnings=[];
  let autoSubmissions=0;
  const candidates=[{dataset:{warehouse:'w1'}},{dataset:{warehouse:'w2'}}];
  const listeners={};
  const toggle={expanded:'false',setAttribute(name,value){this.expanded=value;},focus(){}};
  const modelToggle={setAttribute(){},focus(){}};
  const modelButtons=[{dataset:{model:'all'}},{dataset:{model:'m1'}},{dataset:{model:'m2'}}];
  const modelChoices={hidden:true,innerHTML:'',querySelectorAll(){return modelButtons;}};
  const form={elements:{warehouse_name:{value:''},model_name:{value:''},model_id:{value:''}},addEventListener(name,handler){listeners[name]=handler;},isConnected:true,
    requestSubmit(){autoSubmissions++;}};
  const panel={innerHTML:''},choices={hidden:true,innerHTML:'',querySelectorAll(){return candidates;}};
  const context=vm.createContext({module:{exports:{}},URLSearchParams,
    document:{querySelector(selector){return {'#query-form':form,'#balance':panel,'#warehouse-choices':choices,'#warehouse-toggle':toggle,'#model-toggle':modelToggle,'#model-choices':modelChoices}[selector];}},
    FormState:{freezeWhile:async(form,action)=>action()},captureShell:(...args)=>html.push(args),warn:message=>warnings.push(message),
    request:async path=>{calls.push(path);return {warehouse:{id:'w1',name:'示例1号库',enabled:true},items:[],totals:{},queried_at:'2026-11-02T00:00:00Z'};}});
  vm.runInContext(fs.readFileSync(require.resolve('../app/web/app.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(require.resolve('../app/web/inventory.js'),'utf8'),context);
  vm.runInContext(`state.user={id:'owner',username:'demo-owner',permissions:[]};
    state.warehouses=[{id:'w1',name:'示例1号库'},{id:'w2',name:'示例2号库'}];state.models=[{id:'m1',name:'示例型号A'},{id:'m2',name:'示例型号B'}];
    state.inventorySearch={actor:'owner',warehouse_id:'w1',model_id:'m1'};
    loadCatalog=async()=>{};shell=captureShell;notify=warn;api=request;
    canInbound=()=>false;hasPermission=()=>false;outboundEntry=()=>'';`,context);
  return {form,panel,choices,toggle,modelToggle,modelChoices,modelButtons,listeners,candidates,calls,html,warnings,autoSubmissions:()=>autoSubmissions,
    enter:()=>vm.runInContext('inventoryPage()',context),submit:()=>form.onsubmit({preventDefault(){}})};
}
test('进入库存页忽略上次查询，不选中库房或型号，不自动提交',async()=>{
  const h=inventoryHarness();await h.enter();
  assert.equal(h.autoSubmissions(),0);assert.equal(h.calls.length,0);
  const markup=h.html[0][2];
  assert.match(markup,/name="warehouse_name"[^>]*value=""/);
  assert.match(markup,/<input name="model_name"[^>]*required/);
});
test('明确选择全部型号时，overview不带model_id，不把all作为UUID提交',async()=>{
  const h=inventoryHarness();await h.enter();
  h.form.elements.warehouse_name.value='示例1号库';h.form.elements.model_id.value='all';
  await h.submit();assert.equal(h.calls.length,1);
  const params=new URLSearchParams(h.calls[0].split('?')[1]);
  assert.equal(params.get('warehouse_id'),'w1');assert.equal(params.has('model_id'),false);
});
test('已填库房时完整下拉仍可切换其他库房，清除旧结果且不自动查询',async()=>{
  const h=inventoryHarness();await h.enter();
  h.form.elements.warehouse_name.value='示例1号库';h.form.elements.model_id.value='m1';
  await h.submit();assert.equal(h.calls.length,1);
  h.toggle.onclick();assert.equal(h.choices.hidden,false);assert.match(h.choices.innerHTML,/示例2号库/);
  h.candidates[1].onclick();assert.equal(h.form.elements.warehouse_name.value,'示例2号库');
  assert.equal(h.calls.length,1);assert.equal(h.choices.hidden,true);assert.doesNotMatch(h.panel.innerHTML,/stock-card/);
  await h.submit();assert.equal(new URLSearchParams(h.calls[1].split('?')[1]).get('warehouse_id'),'w2');
  h.toggle.onclick();h.listeners.keydown({key:'Escape'});assert.equal(h.choices.hidden,true);
});
test('缺型号不能查询，选择模糊库房候选也不会自动查询，明确提交才请求',async()=>{
  const h=inventoryHarness();await h.enter();h.form.elements.warehouse_name.value='示例1号库';
  await h.submit();assert.equal(h.calls.length,0);
  h.form.elements.warehouse_name.value='示例';h.form.elements.model_id.value='m1';
  await h.submit();assert.equal(h.calls.length,0);assert.equal(h.choices.hidden,false);
  h.candidates[0].onclick();assert.equal(h.autoSubmissions(),0);assert.equal(h.calls.length,0);
  await h.submit();assert.equal(h.calls.length,1);
  const params=new URLSearchParams(h.calls[0].split('?')[1]);assert.equal(params.get('warehouse_id'),'w1');assert.equal(params.get('model_id'),'m1');
});
test('选定后手动更改库房名称，查询不能沿用旧库房ID',async()=>{
  const h=inventoryHarness();await h.enter();h.toggle.onclick();h.candidates[0].onclick();
  h.form.elements.warehouse_name.value='示例2号库';h.form.elements.model_id.value='all';
  h.listeners.input({target:h.form.elements.warehouse_name});await h.submit();
  assert.equal(new URLSearchParams(h.calls[0].split('?')[1]).get('warehouse_id'),'w2');
});
test('型号完整列表与库房互斥展开，选择全部型号不自动查询',async()=>{
  const h=inventoryHarness();await h.enter();h.toggle.onclick();h.modelToggle.onclick();
  assert.equal(h.choices.hidden,true);assert.equal(h.modelChoices.hidden,false);assert.match(h.modelChoices.innerHTML,/全部型号/);
  h.modelButtons[0].onclick();assert.equal(h.form.elements.model_name.value,'全部型号');assert.equal(h.form.elements.model_id.value,'all');
  assert.equal(h.calls.length,0);assert.equal(h.modelChoices.hidden,true);
  h.form.elements.warehouse_name.value='示例1号库';await h.submit();
  assert.equal(new URLSearchParams(h.calls[0].split('?')[1]).has('model_id'),false);
  h.modelToggle.onclick();h.listeners.keydown({key:'Escape'});assert.equal(h.modelChoices.hidden,true);
});
test('修改型号名称后不沿用旧ID，未知型号不发查询，精确型号查询新ID',async()=>{
  const h=inventoryHarness();await h.enter();h.form.elements.warehouse_name.value='示例1号库';
  h.modelToggle.onclick();h.modelButtons[1].onclick();
  h.form.elements.model_name.value='不存在';h.listeners.input({target:h.form.elements.model_name});
  assert.equal(h.form.elements.model_id.value,'');await h.submit();assert.equal(h.calls.length,0);
  h.form.elements.model_name.value='示例型号B';h.listeners.input({target:h.form.elements.model_name});
  await h.submit();assert.equal(new URLSearchParams(h.calls[0].split('?')[1]).get('model_id'),'m2');
});
