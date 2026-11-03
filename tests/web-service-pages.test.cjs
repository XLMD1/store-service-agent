'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {ServiceMockStore}=require('../app/web/service-pages.js');

function ready(store) {
  const row=store.createDraft('虚构手工来源：示例街道，无法启动');
  store.updateDraft(row.id,{address:'虚构街道',problem:'无法启动',association:'new'});
  return row;
}
test('ambiguous phone retains both addresses and unrecognized queries have no match',()=>{
  const store=new ServiceMockStore();
  assert.equal(store.search('13800000000').length,2);
  assert.equal(store.search('1号楼101').length,1);
  assert.equal(store.search('不存在的地址').length,0);
});
test('incomplete draft stays pending; unknown date, name and model are not fabricated',()=>{
  const store=new ServiceMockStore(),row=store.createDraft('虚构来源');
  assert.throws(()=>store.confirm(row.id,row.version),/请核对/);
  store.updateDraft(row.id,{address:'虚构地址',problem:'无法启动',association:'new'});
  assert.deepEqual(store.issues(row),[]);
  const record=store.confirm(row.id,row.version);
  assert.equal(record.date,'');assert.equal(record.name,'');assert.equal(record.model,'');
  assert.equal(store.pending().some(item=>item.id===row.id),false);
});
test('unclear phone blocks archive even when address is present; unknown is explicit',()=>{
  const store=new ServiceMockStore(),row=ready(store);
  store.updateDraft(row.id,{phone:'1380000000?'});
  assert.match(store.issues(row).join(','),/手机号不清/);
  store.updateDraft(row.id,{phone:''});assert.deepEqual(store.issues(row),[]);
});
test('identity edits invalidate candidate association and stale previews cannot archive',()=>{
  const store=new ServiceMockStore(),customer=store.customers[0],row=store.createDraft('虚构来源');
  store.updateDraft(row.id,{...customer,association:customer.id,problem:'故障'});
  const version=row.version;
  store.updateDraft(row.id,{address:'另一个虚构地址'});
  assert.equal(row.association,'');
  assert.throws(()=>store.confirm(row.id,version),/已变化/);
});
test('archive repeat uses same receipt; result supplements append source and preserve history',()=>{
  const store=new ServiceMockStore(),row=ready(store),record=store.confirm(row.id,row.version);
  const count=store.records.length;
  assert.equal(store.confirm(row.id,row.version).id,record.id);assert.equal(store.records.length,count);
  const original=record.source,supplement=store.supplement(record.id);
  assert.equal(store.supplement(record.id).id,supplement.id);
  store.updateDraft(supplement.id,{result:'演示：现场检查后已恢复',source:'虚构师傅原文'});
  store.confirm(supplement.id,supplement.version);
  assert.equal(record.source,original);assert.equal(record.version,2);
  assert.equal(record.revisions[0].source,'虚构师傅原文');
  assert.equal(record.revisions[0].previous,'');
});
test('supplement checks target revision; missing result and source remain pending',()=>{
  const store=new ServiceMockStore(),record=store.records[0],row=store.supplement(record.id);
  assert.equal(store.issues(row).length,2);
  store.updateDraft(row.id,{result:'演示补充',source:'虚构来源'});record.version++;
  assert.throws(()=>store.confirm(row.id,row.version),/新修订/);
});
test('last enabled owner cannot be disabled or demoted; another owner permits change',()=>{
  const store=new ServiceMockStore();
  assert.throws(()=>store.saveAccount('demo-owner',{enabled:false}),/至少一位/);
  assert.throws(()=>store.saveAccount('demo-owner',{roles:['service']}),/至少一位/);
  assert.throws(()=>store.saveAccount('demo-clerk',{roles:[]}),/至少选择/);
  store.saveAccount('demo-clerk',{roles:['owner','service']});
  store.saveAccount('demo-owner',{enabled:false});assert.equal(store.accounts[0].enabled,false);
});
test('manual requires separate review and publication, disabled versions keep old citations',()=>{
  const store=new ServiceMockStore();
  const manual=store.addManual({name:'虚构B手册',model:'示例型号B',version:'v2',source:'虚构资料',pages:'12、13'});
  const query={model:'示例型号B',problem:'故障',condition:'现场待核对'};
  assert.equal(store.repairQuery(query),null);
  assert.throws(()=>store.manualTransition(manual.id,'published'),/状态已变化/);
  store.manualTransition(manual.id,'reviewed');store.manualTransition(manual.id,'published');
  const answer=store.repairQuery(query);assert.equal(answer.manual.version,'v2');
  store.manualTransition(manual.id,'disabled');assert.equal(store.repair.answer,null);
  assert.equal(answer.manual.status,'published');assert.equal(store.repairQuery(query),null);
});
test('repair exact model and nonempty problem are required; feedback clears for new queries',()=>{
  const store=new ServiceMockStore();
  assert.equal(store.repairQuery({model:'示例型号A相似型',problem:'故障'}),null);
  assert.equal(store.repairQuery({model:'示例型号A',problem:''}),null);
  assert.ok(store.repairQuery({model:'示例型号A',problem:'无法启动',condition:'待检查'}));
  store.repair.feedback='有用';store.repairQuery({model:'示例型号A',problem:'新条件'});
  assert.equal(store.repair.feedback,'');
});

const {JSDOM}=require('jsdom');
const fs=require('node:fs');
const vm=require('node:vm');
function pageHarness(mock=true, permissions=['service.read','service.draft','service.confirm','repair.query','inventory.read','inventory.opening','inventory.correct','catalog.manage','reservation.confirm','account.manage','knowledge.review','knowledge.publish']) {
  const dom=new JSDOM('<main id="app"></main><div id="notice"></div>',{url:'https://example.test/#home',runScripts:'outside-only'});
  const window=dom.window;
  window.state={user:{permissions}};
  const fixtures=`
    const $=selector=>document.querySelector(selector);
    const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const icon=()=>'';
    const stamp=value=>value||'未知';
    const api=async()=>[];
    const shell=(title,subtitle,content)=>$('#app').innerHTML=content;
    const notify=message=>$('#notice').textContent=message;
    const field=(label,name,value='',attrs='',type='text')=>'<label>'+label+'<input name="'+name+'" type="'+type+'" value="'+esc(value)+'" '+attrs+'></label>';
    const select=(label,name,rows,value='')=>'<label>'+label+'<select name="'+name+'"><option value="">请选择</option>'+rows.map(row=>'<option value="'+row.id+'" '+(row.id===value?'selected':'')+'>'+esc(row.name)+'</option>').join('')+'</select></label>';
    const check=text=>'<label><input type="checkbox" name="confirmed" required>'+text+'</label>';
    const FormState={freezeWhile:async(form,action)=>action()};
  `;
  if(mock)window.FrontendMock={};
  window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new window.Event('close'));};
  vm.runInContext(fixtures+fs.readFileSync(require.resolve('../app/web/service-pages.js'),'utf8')+'\nObject.assign(window,{homePage,serviceDraftPage,serviceSearchPage,serviceDetailPage,repairPage,settingsPage,servicePendingItems});',dom.getInternalVMContext());
  return {dom,window,doc:window.document};
}
test('DOM: source dialog close restores focus; search lists human choices and preserves empty result',async()=>{
  const {dom,window,doc}=pageHarness();
  await window.serviceDraftPage();
  const source=doc.querySelector('[data-service-source]');source.focus();source.click();
  assert.ok(doc.querySelector('dialog').open);doc.querySelector('dialog').close();
  assert.equal(doc.activeElement,source);
  await window.serviceSearchPage();
  const form=doc.querySelector('form');form.elements.query.value='13800000000';
  form.dispatchEvent(new window.Event('submit',{cancelable:true}));
  assert.equal(doc.querySelectorAll('#service-candidates a').length,2);
  form.elements.query.value='不存在的地址';form.dispatchEvent(new window.Event('submit',{cancelable:true}));
  assert.match(doc.querySelector('#service-candidates').textContent,/当前已归档范围内未找到/);
  assert.equal(form.elements.query.value,'不存在的地址');dom.window.close();
});
test('DOM: home task becomes draft; manually verified fields preview and confirm a simulated archive',async()=>{
  const {dom,window,doc}=pageHarness();await window.homePage();
  const task=doc.querySelector('#service-task');task.elements.task.value='虚构来源：示例地址，设备无法启动';
  task.dispatchEvent(new window.Event('submit',{cancelable:true}));
  doc.querySelector('#service-task-draft').click();
  await window.serviceDraftPage(new window.URLSearchParams(window.location.hash.split('?')[1]));
  const form=doc.querySelector('#service-draft-form');
  form.elements.address.value='示例新地址';form.elements.problem.value='无法启动';form.elements.association.value='new';
  form.dispatchEvent(new window.Event('input',{bubbles:true}));
  assert.equal(doc.querySelector('#service-preview').disabled,false);
  form.dispatchEvent(new window.Event('submit',{cancelable:true}));
  const confirm=doc.querySelector('#service-confirm-form');confirm.elements.confirmed.checked=true;
  confirm.dispatchEvent(new window.Event('submit',{cancelable:true}));
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(doc.querySelector('#app').textContent,/演示编号 DEMO-SH/);
  assert.match(doc.querySelector('#notice').textContent,/演示归档完成/);dom.window.close();
});
test('DOM: changing repair conditions immediately removes old citations and feedback',async()=>{
  const {dom,window,doc}=pageHarness();await window.repairPage();
  const form=doc.querySelector('#service-repair-form');form.dispatchEvent(new window.Event('submit',{cancelable:true}));
  assert.equal(doc.querySelectorAll('[data-manual-page]').length,3);
  doc.querySelector('[data-repair-feedback]').click();
  form.elements.model.value='不覆盖型号';form.dispatchEvent(new window.Event('input',{bubbles:true}));
  assert.equal(doc.querySelectorAll('[data-manual-page]').length,0);
  assert.equal(doc.querySelectorAll('[data-repair-feedback]').length,0);dom.window.close();
});
test('DOM: nonmock direct routes render a read-only explanation without network',async()=>{
  const {dom,window,doc}=pageHarness(false);window.fetch=()=>{throw new Error('Network forbidden');};
  for(const name of ['homePage','serviceDraftPage','serviceSearchPage','serviceDetailPage','repairPage','settingsPage']){
    await window[name]();assert.match(doc.querySelector('#app').textContent,/尚未接入正式业务/);
    assert.equal(doc.querySelectorAll('form').length,0);
  }
  assert.equal(window.servicePendingItems().length,0);dom.window.close();
});
test('DOM: account form protects last owner and manual approval is separate from publish confirmation',async()=>{
  const {dom,window,doc}=pageHarness();await window.settingsPage();
  const owner=doc.querySelector('[data-account="demo-owner"]');
  owner.elements.enabled.checked=false;owner.dispatchEvent(new window.Event('submit',{cancelable:true}));
  assert.match(doc.querySelector('#notice').textContent,/至少一位启用的负责人/);
  const manual=doc.querySelector('#service-new-manual');
  for(const [key,value] of Object.entries({name:'虚构新手册',model:'示例型号B',version:'v2',source:'虚构来源',pages:'22、23'}))manual.elements[key].value=value;
  manual.dispatchEvent(new window.Event('submit',{cancelable:true}));
  assert.match(doc.querySelector('#settings-manuals').textContent,/待审核/);
  doc.querySelector('[data-manual-state="reviewed"]').click();
  let form=doc.querySelector('dialog form');form.elements.confirmed.checked=true;form.dispatchEvent(new window.Event('submit',{cancelable:true}));
  assert.match(doc.querySelector('#settings-manuals').textContent,/已审核待发布/);
  doc.querySelector('[data-manual-state="published"]').click();
  form=doc.querySelector('dialog form');form.elements.confirmed.checked=true;form.dispatchEvent(new window.Event('submit',{cancelable:true}));
  await window.repairPage(new window.URLSearchParams({model:'示例型号B'}));
  doc.querySelector('#service-repair-form').dispatchEvent(new window.Event('submit',{cancelable:true}));
  assert.equal(doc.querySelector('[data-manual-page]').dataset.manualPage,'22');
  assert.equal(doc.querySelectorAll('[data-manual-page]')[2].dataset.manualPage,'23');dom.window.close();
});


test('new archive identifiers never collide with seeded records',()=>{
  const store=new ServiceMockStore();const draft=store.drafts[0];
  store.updateDraft(draft.id,{phone:'13800000000',association:'demo-c1'});
  const result=store.confirm(draft.id,draft.version);
  assert.equal(new Set(store.records.map(row=>row.id)).size,store.records.length);
  assert.equal(store.records.find(row=>row.id===result.id),result);
});
