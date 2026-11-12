'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require.resolve('../app/web/mock.html'),'utf8');
const scripts=[...html.matchAll(/<script defer src="\/web\/([^"]+)"/g)].map(match=>fs.readFileSync(require.resolve('../app/web/'+match[1]),'utf8')).join('\n');
async function harness(){
  const dom=new JSDOM(html,{url:'https://example.test/mock.html#home',runScripts:'outside-only'}),w=dom.window;let network=0;
  w.scrollTo=()=>{};w.matchMedia=()=>({matches:true});w.structuredClone=structuredClone;w.fetch=()=>{network++;throw Error('Mock must never call fetch');};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
  vm.runInContext(scripts+'\nwindow.testApp={render,state,serviceStore};',dom.getInternalVMContext());await new Promise(resolve=>setImmediate(resolve));
  return {dom,w,d:w.document,network:()=>network};
}
const routes=[['home','工作台'],['pending','待核对'],['service-draft','售后草稿核对'],['service-search','售后档案'],['service-detail?customer=demo-c1','售后档案详情'],['repair-assistant','维修辅助'],['settings','资料与设置'],['inventory','库存'],['opening','期初建账'],['inbound','入库登记'],['movement?kind=inventory_outbound','普通出库'],['movement?kind=reservation_create','办理留货'],['reservations','预留查询'],['ledger','库存流水'],['statistics','进货统计'],['correction','原单数量更正'],['correction?kind=inventory_adjustment','盘点调整'],['reconciliation','库存对账'],['catalog','库房与型号'],['customers','客户资料'],['reserved-pickup','预留查询'],['inbound-statistics','进货统计']];
test('all listed routes mount actual mock pages, shared selectors and no network calls',async()=>{
  const {dom,w,d,network}=await harness();
  try{for(const [route,title]of routes){w.history.replaceState(null,'','#'+route);await w.testApp.render();assert.equal(d.querySelector('h1')?.textContent,title,route);assert.equal(d.querySelector('#notice').hidden,true,route+': '+d.querySelector('#notice').textContent);assert.ok([...d.querySelectorAll('#app select')].every(select=>select.hidden),route);}
    assert.equal(network(),0);
  }finally{dom.window.close();}
});
test('outbound modes lead to explicit pickup selection and retain independent reservation lookup',async()=>{
  const {dom,w,d,network}=await harness();
  const go=async hash=>{w.history.replaceState(null,'',hash);await w.testApp.render();};
  const tick=()=>new Promise(resolve=>setImmediate(resolve));
  try{
    await go('#movement?kind=inventory_outbound');
    const pickup=d.querySelector('.outbound-modes a[href="#movement?kind=reservation_pickup"]');
    assert.ok(pickup);
    await go(pickup.hash);
    assert.equal(d.querySelector('.outbound-modes [aria-current=page]').textContent,'预留提货');
    assert.equal(d.querySelector('#movement-form'),null);
    assert.equal(d.querySelector('#reservation-results a'),null);
    const search=d.querySelector('#reservation-search');
    assert.equal(search.elements.active_only,undefined);
    search.requestSubmit();await tick();
    const choice=d.querySelector('#reservation-results a[href*="&reservation="]');
    assert.ok(choice);
    assert.equal(d.querySelector('#reservation-results a[href*="reservation_cancel"]'),null);
    await go(choice.hash);
    assert.ok(d.querySelector('#movement-form a[href="#movement?kind=reservation_pickup"]'));
    assert.match(d.querySelector('#movement-form').textContent,/剩余/);
    await go('#reservations');
    const lookup=d.querySelector('#reservation-search');
    assert.ok(lookup.elements.active_only.checked);
    lookup.requestSubmit();await tick();
    assert.ok(d.querySelector('#reservation-results a[href*="reservation_cancel"]'));
    assert.equal(network(),0);
  }finally{dom.window.close();}
});
test('reset clears both stores and toolbar values, normal scenario retains resumable operation',async()=>{
  const {dom,w,d}=await harness();
  try{w.testApp.serviceStore.createDraft('额外虚构草稿');
    const warehouses=await w.FrontendMock.request('/catalog/warehouses'),models=await w.FrontendMock.request('/catalog/models');
    const saved=await w.FrontendMock.request('/drafts','POST',{kind:'inventory_inbound',parameters:{warehouse_id:warehouses[0].id,model_id:models[0].id,quantity:1,basis_note:'虚构恢复验证',occurred:{precision:'date',date:'2026-11-03'}}});
    w.history.replaceState(null,'','#inbound?draft='+saved.id);w.FrontendMock.setScenario('conflict');
    const scenario=d.querySelector('#demo-scenario');scenario.value='normal';scenario.dispatchEvent(new w.Event('change',{bubbles:true}));await new Promise(resolve=>setImmediate(resolve));assert.equal(w.testApp.serviceStore.drafts.length,2);
    assert.equal((await w.FrontendMock.request('/drafts/'+saved.id)).operation_id,saved.operation_id);assert.equal(d.querySelector('h1').textContent,'入库登记');assert.match(d.querySelector('#inbound-preview').textContent,/尚未提交/);
    d.querySelector('#demo-reset').click();await new Promise(resolve=>setImmediate(resolve));assert.equal(w.testApp.serviceStore.drafts.length,1);assert.equal(d.querySelector('h1').textContent,'工作台');assert.equal(w.FrontendMock.getScenario(),'normal');assert.equal(d.querySelector('#demo-role').value,'owner');assert.match(d.querySelector('#notice').textContent,/已重置/);
  }finally{dom.window.close();}
});
test('role switch limits service confirmation and settings; old privileged handlers recheck permission',async()=>{
  const {dom,w,d}=await harness();
  const go=async route=>{w.history.replaceState(null,'','#'+route);await w.testApp.render();};
  const role=async value=>{w.testApp.state.user=await w.FrontendMock.request('/auth/login','POST',{username:'demo-'+value,password:'demo'});};
  try{
    await go('settings');const ownerForm=d.querySelector('[data-account="demo-owner"]');const name=ownerForm.elements.name.value;
    await role('stock_operator');ownerForm.elements.name.value='越权变更';ownerForm.dispatchEvent(new w.Event('submit',{cancelable:true}));assert.equal(w.testApp.serviceStore.accounts[0].name,name);assert.match(d.querySelector('#notice').textContent,/无权/);
    await go('service-draft');assert.equal(d.querySelector('#service-draft-form'),null);assert.match(d.querySelector('#main').textContent,/需要相应职责/);
    await go('settings');assert.equal(d.querySelector('[data-account]'),null);assert.equal(d.querySelector('[data-manual-state]'),null);
    const manual=w.testApp.serviceStore.addManual({name:'虚构角色验证手册',model:'B',version:'v2',source:'虚构资料',pages:'1'});
    await role('technician');await go('settings');assert.ok(d.querySelector('[data-manual-state="reviewed"]'));assert.equal(d.querySelector('#service-new-manual'),null);
    await go('service-draft');const form=d.querySelector('#service-draft-form');form.elements.association.value='demo-c1';form.elements.association.dispatchEvent(new w.Event('change',{bubbles:true}));form.dispatchEvent(new w.Event('submit',{cancelable:true}));assert.equal(d.querySelector('#service-confirm-form'),null);assert.match(d.querySelector('dialog').textContent,/须交由获授权/);assert.equal(manual.status,'review');assert.equal(w.testApp.serviceStore.drafts[0].status,'draft');
  }finally{dom.window.close();}
});
test('shared picker customer selection associates identity before validation and permits explicit archive',async()=>{
  const {dom,w,d}=await harness();
  try{
    w.history.replaceState(null,'','#service-draft');await w.testApp.render();
    const picker=d.querySelector('#service-draft-form .enhanced-picker');picker.querySelector('.picker-trigger').click();picker.querySelectorAll('[role=option]')[1].click();
    const form=d.querySelector('#service-draft-form');assert.equal(form.elements.association.value,'demo-c1');assert.equal(form.elements.phone.value,'13800000000');assert.equal(d.querySelector('#service-preview').disabled,false);assert.equal(form.elements.date.value,'');
    form.dispatchEvent(new w.Event('submit',{cancelable:true}));const confirm=d.querySelector('#service-confirm-form');assert.ok(confirm);confirm.elements.confirmed.checked=true;confirm.dispatchEvent(new w.Event('submit',{cancelable:true}));await new Promise(resolve=>setImmediate(resolve));assert.match(d.querySelector('h1').textContent,/模拟归档完成/);assert.equal(w.testApp.serviceStore.records.at(-1).date,'');
  }finally{dom.window.close();}
});
