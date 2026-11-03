'use strict';

// This module never calls an API. All records and files belong to this page session.
class ServiceMockStore {
  constructor() {
    this.sequence = 2;
    this.customers = [
      {id:'demo-c1', name:'示例客户甲', phone:'13800000000', address:'示例小区1号楼101', model:'示例型号A'},
      {id:'demo-c2', name:'示例客户甲', phone:'13800000000', address:'示例小区2号楼202', model:'示例型号A'}
    ];
    this.records = this.customers.map((customer,index) => ({...customer,id:'DEMO-SH-'+(index+1),customerId:customer.id, date:index?'':'2026-10-26', problem:'设备无法正常启动', method:'已完成现场检查', parts:'', result:'', code:'', source:'虚构群原文：'+customer.name+'，'+customer.address+'，设备无法正常启动；已完成现场检查，结果未提供。', revisions:[], version:1}));
    this.drafts = [{id:'demo-d1', version:1, status:'draft',savedAt:new Date().toISOString(), name:'示例客户甲', phone:'1380000000?', address:'示例小区1号楼101', model:'示例型号A', date:'', code:'', problem:'设备无法正常启动', method:'', parts:'', result:'', association:'', source:'虚构纸本原文 · 第3页\n示例客户甲 1380000000?\n示例小区1号楼101；设备无法正常启动；日期未记。', photoUrl:''}];
    this.accounts = [{id:'demo-owner',name:'示例负责人',roles:['owner'],enabled:true,version:1},{id:'demo-clerk',name:'示例接单员',roles:['service'],enabled:true,version:1}];
    this.manuals = [{id:'demo-manual',name:'虚构示例手册',model:'示例型号A',version:'v1',status:'published',source:'虚构教学材料，仅演示引用关系',pages:'12、13'}];
    this.repair = {model:'示例型号A',problem:'设备无法正常启动',code:'',condition:'',answer:null,feedback:''};
    this.task = ''; this.photo = null; this.query = ''; this.queried = false;
  }
  draft(id) { return this.drafts.find(row=>row.id===id); }
  createDraft(source, photoUrl='') {
    const row={id:'demo-d'+(++this.sequence),version:1,status:'draft',savedAt:new Date().toISOString(),name:'',phone:'',address:'',model:'',date:'',code:'',problem:'',method:'',parts:'',result:'',association:'',source,photoUrl};
    this.drafts.push(row); return row;
  }
  updateDraft(id, patch) {
    const row=this.draft(id);
    if(!row || row.status!=='draft') throw new Error('演示草稿已归档或不存在。');
    for(const key of ['name','phone','address','model','date','code','problem','method','parts','result','association','source']) if(Object.hasOwn(patch,key)) row[key]=String(patch[key]);
    const customer=this.customers.find(item=>item.id===row.association);
    if(customer && (customer.address!==row.address || customer.phone!==row.phone || customer.name!==row.name)) row.association='';
    row.savedAt=new Date().toISOString();row.version++; return row;
  }
  issues(row) {
    if(row.targetId) return [!row.result.trim()?'实际处理结果':'',!row.source.trim()?'新增来源':''].filter(Boolean);
    return [!row.phone.trim()&&!row.address.trim()?'手机号或服务地址':'',row.phone&&!/^1\d{10}$/.test(row.phone)?'手机号不清，请修正或标为未知':'',!row.problem.trim()?'问题描述':'',!row.source.trim()&&!row.photoUrl?'保存的来源':'',!row.association?'人工客户/地址关联':''].filter(Boolean);
  }
  confirm(id, version) {
    const row=this.draft(id);
    if(!row) throw new Error('演示草稿不存在。');
    if(row.status==='archived') return this.records.find(record=>record.id===row.recordId);
    if(row.version!==version) throw new Error('演示草稿已变化，请重新预览。');
    const issues=this.issues(row); if(issues.length) throw new Error('请核对：'+issues.join('、'));
    let record;
    if(row.targetId) {
      record=this.records.find(item=>item.id===row.targetId);
      if(record.version!==row.targetVersion) throw new Error('演示档案已有新修订，请重新建立补充草稿。');
      record.revisions.push({version:record.version+1,previous:record.result,result:row.result,source:row.source});
      record.result=row.result; record.version++;
    } else {
      let customer=this.customers.find(item=>item.id===row.association);
      if(!customer) { customer={id:'demo-c'+(++this.sequence),name:row.name,phone:row.phone,address:row.address,model:row.model};this.customers.push(customer); }
      record={...row,id:'DEMO-SH-'+(++this.sequence),customerId:customer.id,revisions:[],version:1}; this.records.push(record);
    }
    row.status='archived'; row.recordId=record.id; return record;
  }
  supplement(recordId) {
    const record=this.records.find(row=>row.id===recordId); if(!record) throw new Error('演示档案不存在。');
    const existing=this.drafts.find(row=>row.targetId===recordId&&row.status==='draft');
    if(existing&&existing.targetVersion===record.version)return existing;
    if(existing)existing.status='stale';
    const row=this.createDraft(''); Object.assign(row,{targetId:recordId,targetVersion:record.version,name:record.name,address:record.address}); return row;
  }
  search(query) { const value=query.trim().replace(/\s/g,''); return this.customers.filter(row=>this.records.some(record=>record.customerId===row.id)&&(row.name+row.phone+row.address).replace(/\s/g,'').includes(value)); }
  pending() { return this.drafts.filter(row=>row.status==='draft').map(row=>({id:row.id,type:'service',savedAt:row.savedAt,title:(row.targetId?'补充结果 · ':'售后草稿 · ')+(row.name||'称呼未知'),hint:this.issues(row).join('、')||'最低条件已满足，待预览确认',href:'#service-draft?draft='+encodeURIComponent(row.id)})); }
  saveAccount(id, patch) {
    const account=this.accounts.find(row=>row.id===id); if(!account) throw new Error('演示账号不存在。');
    const next={...account,...patch};
    if(!next.roles.length) throw new Error('请至少选择一项职责。');
    if(account.enabled&&account.roles.includes('owner')&&(!next.enabled||!next.roles.includes('owner'))&&!this.accounts.some(row=>row.id!==id&&row.enabled&&row.roles.includes('owner')))throw new Error('演示保护：必须保留至少一位启用的负责人。');
    Object.assign(account,next,{version:account.version+1}); return account;
  }
  addManual(values) {
    if(!String(values.pages||'').match(/\d+/))throw new Error('请填写已核对的数字页码，章节引用尚未提供。');
    const row={...values,id:'demo-manual-'+(++this.sequence),status:'review'}; this.manuals.push(row);return row;
  }
  manualTransition(id,status) {
    const row=this.manuals.find(item=>item.id===id);
    const transitions={review:['reviewed'],reviewed:['published'],published:['disabled'],disabled:['review']};
    if(!row||!transitions[row.status]?.includes(status))throw new Error('演示资料状态已变化，请重新核对。');
    row.status=status;this.repair.answer=null; return row;
  }
  repairQuery(values) {
    Object.assign(this.repair,values,{feedback:''});
    const manual=this.manuals.find(row=>row.model===values.model&&row.status==='published');
    this.repair.answer=manual&&values.problem.trim()?{manual:{...manual},pages:manual.pages.match(/\d+/g),condition:values.condition,model:values.model}:null;
    return this.repair.answer;
  }
}
const serviceStore = new ServiceMockStore();
function resetServiceMock(){
  const urls=new Set([serviceStore.photo?.url,...serviceStore.drafts.map(row=>row.photoUrl),...serviceStore.records.map(row=>row.photoUrl)].filter(Boolean));
  urls.forEach(url=>URL.revokeObjectURL(url));
  Object.assign(serviceStore,new ServiceMockStore());
}
const serviceAllowed=permission=>typeof state!=='undefined'&&!!state.user?.permissions?.includes(permission);
function serviceRequire(permission){if(serviceIsMock()&&serviceAllowed(permission))return true;notify('当前账号无权执行此演示操作，请交由相应职责人员处理。');return false;}
function serviceDenied(title){shell(title,'当前账号无权访问',`<section class="panel"><p>此演示页面需要相应职责授权，请交由有权人员处理。</p><a class="button" href="#home">返回工作台</a></section>`,'',true);}
const serviceIsMock=()=>typeof FrontendMock!=='undefined';
function servicePendingItems(){return serviceIsMock()&&serviceAllowed('service.draft')?serviceStore.pending():[];}
function serviceReadonly(title){shell(title,'当前服务尚未接入',`<section class="panel"><h2>此页尚未接入正式业务</h2><p>售后、维修和账号资料当前仅提供独立演示。这里不读取资料或提交业务。</p><a class="button" href="#inventory">返回库存</a></section>`,'',true);}
const serviceText=(label,name,value='',attrs='')=>`<label class="field"><span>${label}</span><textarea name="${name}" rows="3" ${attrs}>${esc(value)}</textarea></label>`;
const serviceNote='<p class="muted">演示 · 全部为虚构样例，仅保留当前页面会话，刷新即重置。未接入AI、正式档案或真实手册。</p>';
function serviceDialog(title,content){
  const previous=document.activeElement;
  const dialog=document.createElement('dialog');dialog.className='service-reader';dialog.setAttribute('aria-labelledby','service-reader-title');
  dialog.innerHTML=`<div class="section-head"><h2 id="service-reader-title">${esc(title)}</h2><button type="button" data-reader-close aria-label="关闭阅读层">关闭</button></div>${content}`;
  document.body.append(dialog);dialog.querySelector('[data-reader-close]').onclick=()=>dialog.close();
  const routeClose=()=>dialog.close();window.addEventListener('hashchange',routeClose,{once:true});
  dialog.addEventListener('close',()=>{window.removeEventListener('hashchange',routeClose);dialog.remove();if(previous?.isConnected)previous.focus();},{once:true});
  dialog.showModal();return dialog;
}
function serviceSource(row){return `<p class="muted">来源：${row.photoUrl?'本次本地照片':'保存的虚构原文'} · 不跳转微信群</p><pre class="service-source">${esc(row.source||'照片未识别，请对照原件手工填写。')}</pre>${row.photoUrl?`<img class="service-photo" src="${esc(row.photoUrl)}" alt="本次选择的来源照片，仅本地预览">`:''}`;}
function serviceBindSources(root=document){root.querySelectorAll('[data-service-source]').forEach(button=>button.onclick=()=>{const row=serviceStore.draft(button.dataset.serviceSource)||serviceStore.records.find(item=>item.id===button.dataset.serviceSource);if(row&&serviceRequire(serviceStore.draft(row.id)?'service.draft':'service.read'))serviceDialog('来源原件 · 演示',serviceSource(row));});}

async function homePage(){
  if(!serviceIsMock())return serviceReadonly('工作台');
  const stockDrafts=await api('/drafts');
  const pending=[...servicePendingItems(),...stockDrafts.map(row=>({title:(correctionNames[row.kind]||movementTypes[row.kind]?.name||(row.kind==='inventory_inbound'?'入库登记':'期初建账'))+' · 第'+row.version+'版',hint:row.missing_fields.length?'待补：'+row.missing_fields.map(inboundMissing).join('、'):'待预览确认',savedAt:row.updated_at,href:'#'+(correctionNames[row.kind]?'correction':movementTypes[row.kind]?'movement':row.kind==='inventory_inbound'?'inbound':'opening')+'?draft='+row.id}))];
  shell('工作台','示例门店 · 先整理，再核对',`<div class="service-home"><section class="panel material-ink service-task"><h2>今天要处理什么？</h2><form id="service-task" class="fields">${serviceText('任务文字','task',serviceStore.task,'maxlength="10000" placeholder="粘贴原文，或描述要查找的内容"')}<div class="actions"><button type="button" id="service-paste">${icon('clipboard')}粘贴文字</button>${serviceAllowed('service.draft')?`<label class="button service-file">${icon('photo')}选择照片<input type="file" id="service-photo" accept="image/jpeg,image/png,image/webp"></label>`:''}<button class="primary">开始整理</button></div><div id="service-attachment"></div><p class="muted">照片仅在本地预览，不上传、不自动识别。支持10MB以内 JPG/PNG/WebP，请仅使用虚构材料。</p></form></section><nav class="service-shortcuts" aria-label="常用功能">${[['service-draft','clipboard','整理售后'],['service-search','history','查上次记录'],['repair-assistant','wrench','维修辅助'],['inventory','box','查库存']].filter(([route])=>serviceAllowed(({'service-draft':'service.draft','service-search':'service.read','repair-assistant':'repair.query',inventory:'inventory.read'})[route])).map(([route,symbol,label])=>`<a href="#${route}">${icon(symbol)}${label}</a>`).join('')}</nav><aside class="panel service-pending"><div class="section-head"><h2>待核对 ${pending.length}</h2><a href="#pending">查看全部</a></div>${pending.map(item=>`<article class="service-row"><h3>${esc(item.title)}</h3><p>${esc(item.hint)}</p><small>保存：${stamp(item.savedAt)}</small><a class="button" href="${item.href}">继续核对</a></article>`).join('')||'<p>当前没有待核对草稿。</p>'}</aside><section class="panel service-recent"><h2>最近任务 · 演示</h2>${(serviceAllowed('service.read')?serviceStore.records:[]).slice(-3).reverse().map(row=>`<a class="service-row" href="#service-detail?id=${esc(row.id)}">${esc(row.name||'称呼未知')} · ${esc(row.address||'地址未知')}<small>演示档案 ${esc(row.id)}</small></a>`).join('')}<a class="button" href="#settings">资料与设置</a>${serviceNote}</section></div>`);
  const form=$('#service-task');form.elements.task.oninput=()=>serviceStore.task=form.elements.task.value;
  const showPhoto=()=>{$('#service-attachment').innerHTML=serviceStore.photo?`<img class="service-photo" src="${serviceStore.photo.url}" alt="本次选择的照片，仅本地预览"><p>${esc(serviceStore.photo.name)}</p><button id="service-remove-photo" type="button">移除照片</button>`:'';if(serviceStore.photo)$('#service-remove-photo').onclick=()=>{URL.revokeObjectURL(serviceStore.photo.url);serviceStore.photo=null;$('#service-photo').value='';showPhoto();};};showPhoto();
  if($('#service-photo'))$('#service-photo').onchange=event=>{if(!serviceRequire('service.draft'))return;const file=event.target.files[0];if(!file)return;if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024){event.target.value='';return notify('请选择10MB以内的 JPG/PNG/WebP 照片。');}if(serviceStore.photo)URL.revokeObjectURL(serviceStore.photo.url);serviceStore.photo={name:file.name,url:URL.createObjectURL(file)};showPhoto();};
  $('#service-paste').onclick=async()=>{try{const text=await navigator.clipboard.readText();form.elements.task.value=text;serviceStore.task=text;}catch{notify('请直接在任务框中粘贴文字。');}form.elements.task.focus();};
  form.onsubmit=event=>{event.preventDefault();const source=form.elements.task.value.trim();if(!source&&!serviceStore.photo)return notify('请先输入任务文字或选择一张照片。');const reader=serviceDialog('任务预览 · 未自动识别',`<pre class="service-source">${esc(source)}</pre><p>请选择下一步，原输入会保留；字段由人手工核对。</p><div class="actions">${serviceAllowed('service.draft')?'<button id="service-task-draft" class="primary">继续整理售后</button>':''}${serviceAllowed('service.read')?'<a class="button" href="#service-search">查档案</a>':''}${serviceAllowed('inventory.read')?'<a class="button" href="#inventory">查库存</a>':''}</div>`);if(reader.querySelector('#service-task-draft'))reader.querySelector('#service-task-draft').onclick=()=>{if(!serviceRequire('service.draft'))return;const row=serviceStore.createDraft(source,serviceStore.photo?.url||'');serviceStore.photo=null;reader.close();location.hash='service-draft?draft='+row.id;};};
}

async function serviceDraftPage(params=new URLSearchParams()){
  if(!serviceIsMock())return serviceReadonly('售后草稿核对');
  if(!serviceAllowed('service.draft'))return serviceDenied('售后草稿核对');
  const id=params.get('draft')||serviceStore.drafts.find(row=>row.status==='draft')?.id;
  const row=serviceStore.draft(id)||serviceStore.createDraft('');
  if(row.status==='archived'){shell('模拟归档完成','未写入正式档案',`<section class="panel"><h2>演示编号 ${esc(row.recordId)}</h2><a class="button primary" href="#service-detail?id=${esc(row.recordId)}">查看模拟档案</a><a class="button" href="#pending">返回待核对</a>${serviceNote}</section>`,'',true);return;}
  const association=[...serviceStore.customers.map(customer=>({...customer,name:customer.name||'称呼未知'})),{id:'new',name:'明确新建客户与地址档案'}];
  shell(row.targetId?'补充处理结果':'售后草稿核对','演示草稿 · 原件与修订保留',`<div class="grid service-compare"><section class="panel"><h2>来源原件</h2>${serviceSource(row)}<button data-service-source="${row.id}">展开阅读原件</button><p class="state warning">${row.targetId?'结果补充将作为新修订保留，原记录不覆盖。':'手机号不清不补位；未知日期、型号可留空。候选由人选择。'}</p>${serviceNote}</section><section class="panel"><form id="service-draft-form" class="fields">${row.targetId?`<h2>${esc(row.name||'称呼未知')} · ${esc(row.address||'地址未知')}</h2>${serviceText('实际处理与结果','result',row.result,'maxlength="5000"')}${serviceText('新增来源原文','source',row.source,'maxlength="10000"')}`:`<h2>逐项核对</h2>${!row.source&&!row.photoUrl?serviceText('本次手工录入来源原文','source','','maxlength="10000"'):''}${select('客户与地址关联','association',association,row.association)}<p class="muted">相同号码可有多个地址，选择候选会带入身份字段；修改身份后需重新核对关联。</p>${field('姓名 / 称呼（可未知）','name',row.name,'maxlength="100"')}${field('手机号（可未知）','phone',row.phone,'maxlength="30" inputmode="tel" aria-describedby="service-phone-help"','tel')}<div id="service-phone-help" class="muted">模糊号码请对照原文，或明确标为未知。</div><button type="button" id="service-phone-unknown">手机号标为未知</button>${serviceText('服务地址（与手机号至少一项）','address',row.address,'maxlength="1000"')}${serviceText('问题描述','problem',row.problem,'maxlength="5000"')}${field('设备准确型号（可未知）','model',row.model,'maxlength="100"')}${field('故障码（可未知）','code',row.code,'maxlength="100"')}${field('维修日期（留空为未知）','date',row.date,'','date')}<details><summary>处理方法、配件与实际结果</summary>${serviceText('处理方法','method',row.method,'maxlength="5000"')}${field('更换配件','parts',row.parts,'maxlength="1000"')}${serviceText('实际维修结果','result',row.result,'maxlength="5000"')}</details>`}<div id="service-issues" role="status"></div><div class="actions"><a class="button" href="#pending">稍后核对</a><button class="primary" id="service-preview">${serviceAllowed('service.confirm')?'预览归档内容':'保存草稿并预览'}</button></div></form></section></div>`,'',true);
  const form=$('#service-draft-form');serviceBindSources();
  const update=()=>{if(!serviceRequire('service.draft'))return;const patch=Object.fromEntries(new FormData(form));serviceStore.updateDraft(row.id,patch);if(form.elements.association)form.elements.association.value=row.association;const issues=serviceStore.issues(row);$('#service-issues').innerHTML=issues.length?`<div class="state warning">待核对：${esc(issues.join('、'))}</div>`:'<div class="state success">最低条件已满足，确认前请预览。</div>';$('#service-preview').disabled=!!issues.length;if(form.elements.phone)form.elements.phone.setAttribute('aria-invalid',String(!!row.phone&&!/^1\d{10}$/.test(row.phone)));};
  form.oninput=event=>{if(event.target.name!=='association')update();};form.onchange=event=>{if(event.target.name==='association'){const customer=serviceStore.customers.find(item=>item.id===event.target.value);if(customer)for(const key of ['name','phone','address'])form.elements[key].value=customer[key];}update();};
  if($('#service-phone-unknown'))$('#service-phone-unknown').onclick=()=>{form.elements.phone.value='';update();form.elements.phone.focus();};update();
  form.onsubmit=event=>{event.preventDefault();if(!serviceRequire('service.draft'))return;update();if(serviceStore.issues(row).length)return;const version=row.version;const reader=serviceDialog('归档内容预览 · 演示',`<dl class="service-facts">${(row.targetId?['result','source']:['name','phone','address','problem','model','code','date','method','parts','result']).map(key=>`<div><dt>${esc(({name:'称呼',phone:'手机号',address:'地址',problem:'问题',model:'型号',code:'故障码',date:'维修日期',method:'处理',parts:'配件',result:'实际结果',source:'新增来源'})[key])}</dt><dd>${esc(row[key]||'未知 / 未记录')}</dd></div>`).join('')}</dl>${serviceSource(row)}<p>关联：${row.targetId?'补充原档案':row.association==='new'?'明确新建客户地址':esc(serviceStore.customers.find(item=>item.id===row.association)?.address)}</p>${serviceAllowed('service.confirm')?`<form id="service-confirm-form">${check('我已核对字段、来源与关联，确认本次模拟归档。')}<button class="primary">确认归档（演示）</button></form>`:'<p class="state">演示草稿已保存，确认归档须交由获授权确认归档的人员核对。</p>'}`);if(reader.querySelector('form'))reader.querySelector('form').onsubmit=async confirmEvent=>{confirmEvent.preventDefault();if(!serviceRequire('service.confirm')||!serviceRequire('service.draft'))return;try{await FormState.freezeWhile(confirmEvent.target,async()=>serviceStore.confirm(row.id,version));reader.close();await serviceDraftPage(new URLSearchParams({draft:row.id}));notify('演示归档完成，未写入正式档案。');}catch(error){notify(error.message);}};};
}

async function serviceSearchPage(params=new URLSearchParams()){
  if(!serviceIsMock())return serviceReadonly('售后档案');
  if(!serviceAllowed('service.read'))return serviceDenied('售后档案');
  if(params.has('q')){serviceStore.query=params.get('q');serviceStore.queried=true;}
  shell('售后档案','按手机号、地址查上次记录',`<section class="panel"><form id="service-search-form" class="fields">${field('手机号 / 地址关键词','query',serviceStore.query,'maxlength="200"')}<button class="primary">查找</button></form><div id="service-candidates" aria-live="polite"></div><p class="muted">仅查询当前演示已归档范围；未找到不代表没有维修历史。</p></section>`);
  const show=()=>{const rows=serviceStore.search(serviceStore.query);$('#service-candidates').innerHTML=!serviceStore.queried?'<p class="state">请输入条件后查找，不自动选择客户。</p>':rows.length?`<h2>找到 ${rows.length} 个服务地址</h2><p>请核对并选择本次地址。</p>${rows.map(row=>`<article class="service-row"><h3>${esc(row.name||'称呼未知')}</h3><p>${esc(row.phone||'手机号未知')}</p><p>${esc(row.address||'地址未知')}</p><p>型号：${esc(row.model||'未知')}</p><a class="button" href="#service-detail?customer=${row.id}">查看该地址档案</a></article>`).join('')}`:`<div class="state"><h2>当前已归档范围内未找到</h2><p>可修改查询条件。</p>${serviceAllowed('service.draft')?'<button id="service-new-draft">新建草稿（演示）</button>':''}</div>`;if($('#service-new-draft'))$('#service-new-draft').onclick=()=>{if(!serviceRequire('service.draft'))return;const row=serviceStore.createDraft('手工新建来源：'+serviceStore.query);location.hash='service-draft?draft='+row.id;};};show();
  $('#service-search-form').onsubmit=event=>{event.preventDefault();if(!serviceRequire('service.read'))return;serviceStore.query=event.target.elements.query.value.trim();serviceStore.queried=true;show();};
}
async function serviceDetailPage(params=new URLSearchParams()){
  if(!serviceIsMock())return serviceReadonly('售后档案详情');
  if(!serviceAllowed('service.read'))return serviceDenied('售后档案详情');
  const record=serviceStore.records.find(row=>params.get('id')?row.id===params.get('id'):row.customerId===params.get('customer'));
  if(!record){shell('档案未找到','演示范围',`<section class="panel"><p>请从检索结果选择具体地址，不自动替你选择。</p><a class="button" href="#service-search">查上次记录</a></section>`,'',true);return;}
  const records=serviceStore.records.filter(row=>row.customerId===record.customerId);
  shell('售后档案详情','演示 · 已归档样例',`<section class="panel"><h2>${esc(record.name||'称呼未知')}</h2><p>${esc(record.phone||'手机号未知')}</p><p>${esc(record.address||'地址未知')}</p><p>设备型号：${esc(record.model||'未知')}</p><a class="button" href="#service-search">返回检索（保留条件）</a></section><section class="panel"><h2>历史记录</h2><p class="muted">日期未知单独标记，不按登记时间假定维修先后。</p>${records.map(row=>`<article class="service-row"><h3>${esc(row.date||'日期未知')} · ${esc(row.problem)}</h3><p class="muted">${esc(row.id)} · 第${row.version}版 · 演示档案</p><dl class="service-facts">${[['故障码',row.code],['处理方法',row.method],['更换配件',row.parts],['实际结果',row.result||'待师傅补充']].map(([label,value])=>`<div><dt>${label}</dt><dd>${esc(value||'未记录')}</dd></div>`).join('')}</dl><div class="actions"><button data-service-source="${row.id}">查看对应原文</button><button data-revisions="${row.id}">查看修订</button>${serviceAllowed('service.draft')?`<button class="primary" data-supplement="${row.id}">补充处理结果</button>`:''}</div></article>`).join('')}${serviceAllowed('repair.query')?`<a class="button" href="#repair-assistant?model=${encodeURIComponent(record.model)}">查维修依据</a>`:''}${serviceNote}</section>`,'',true);serviceBindSources();
  document.querySelectorAll('[data-revisions]').forEach(button=>button.onclick=()=>{if(!serviceRequire('service.read'))return;const row=records.find(item=>item.id===button.dataset.revisions);serviceDialog('来源与修订 · 演示',`<h3>第1版 · 原始归档保留</h3>${serviceSource(row)}${row.revisions.map(item=>`<article class="service-row"><h3>第${item.version}版 · 模拟补充</h3><p>原结果：${esc(item.previous||'待补充')}</p><p>新增结果：${esc(item.result)}</p><pre class="service-source">新增来源：${esc(item.source)}</pre></article>`).join('')||'<p>尚无后续修订。</p>'}`);});
  document.querySelectorAll('[data-supplement]').forEach(button=>button.onclick=()=>{if(!serviceRequire('service.draft')||!serviceRequire('service.read'))return;const row=serviceStore.supplement(button.dataset.supplement);location.hash='service-draft?draft='+row.id;});
}

async function repairPage(params=new URLSearchParams()){
  if(!serviceIsMock())return serviceReadonly('维修辅助');
  if(!serviceAllowed('repair.query'))return serviceDenied('维修辅助');
  if(params.has('model')&&params.get('model')!==serviceStore.repair.model){serviceStore.repair.model=params.get('model');serviceStore.repair.answer=null;}
  const repair=serviceStore.repair;
  shell('维修辅助','虚构资料 · 非实际维修指引',`<div class="grid service-compare"><section class="panel"><h2>确认查询条件</h2><form id="service-repair-form" class="fields">${field('设备准确型号','model',repair.model,'maxlength="100"')}${field('故障码（可未知）','code',repair.code,'maxlength="100"')}${serviceText('故障表现','problem',repair.problem,'maxlength="5000"')}${serviceText('现场检查条件与结果','condition',repair.condition,'maxlength="5000"')}<button class="primary">查维修依据（演示）</button><p class="muted">型号精确匹配；修改条件后清除旧建议和反馈，需重新查询。</p></form></section><section class="panel" id="service-repair-answer" aria-live="polite"></section></div>`,'',true);
  const show=()=>{const answer=repair.answer;$('#service-repair-answer').innerHTML=answer?`<h2>依据：${esc(answer.manual.name)} ${esc(answer.manual.version)}</h2><p class="state warning">虚构手册，仅适用 ${esc(answer.model)}，不提供真实维修步骤。</p>${[['故障说明','当前现象需结合现场检查进一步判断。',answer.pages[0]],['检查前提',answer.condition||'待补充现场检查结果，先确认具体型号与现场条件。',answer.pages[0]],['条件化建议','若检查结果符合对应手册条件，再由师傅核对处理步骤；此演示不生成实际维修结论。',answer.pages[1]||answer.pages[0]]].map(([title,text,page])=>`<article class="service-row"><h3>${title}</h3><p>${esc(text)}</p><button data-manual-page="${page}">${esc(answer.manual.name)} ${esc(answer.manual.version)} · 第${page}页 · 查看原文</button></article>`).join('')}<h3>本次演示是否有帮助？</h3><div class="actions">${['有用','不适用 / 出处错误'].map(label=>`<button data-repair-feedback="${label}" aria-pressed="${repair.feedback===label}">${label}</button>`).join('')}</div>`:'<h2>资料不足 / 尚未查询</h2><p>请补准确型号、故障表现及现场条件。目前只有已发布且适用型号的虚构手册可演示引用。</p><a class="button" href="#settings">查看资料覆盖</a>';
    document.querySelectorAll('[data-manual-page]').forEach(button=>button.onclick=()=>serviceRequire('repair.query')&&serviceDialog('手册原文 · 虚构示例',`<p>${esc(answer.manual.name)} ${esc(answer.manual.version)} · 第${button.dataset.manualPage}页</p><p>适用：${esc(answer.model)}</p><pre class="service-source">${button.dataset.manualPage===answer.pages[0]?'先核对准确型号及现场条件；当前现象仍需检查。':'若现场条件符合资料适用范围，再由师傅核对处理步骤。'}</pre><p class="state warning">全部为虚构文字，不是实际维修依据。</p>`));
    document.querySelectorAll('[data-repair-feedback]').forEach(button=>button.onclick=()=>{if(!serviceRequire('repair.query'))return;repair.feedback=button.dataset.repairFeedback;show();notify('演示反馈已记录：'+repair.feedback);});};show();
  const form=$('#service-repair-form');form.oninput=()=>{if(!serviceRequire('repair.query'))return;Object.assign(repair,Object.fromEntries(new FormData(form)),{answer:null,feedback:''});show();};form.onsubmit=event=>{event.preventDefault();if(!serviceRequire('repair.query'))return;serviceStore.repairQuery(Object.fromEntries(new FormData(form)));show();};
}

async function settingsPage(){
  if(!serviceIsMock())return serviceReadonly('资料与设置');
  const roles=[['owner','负责人'],['service','接单人员'],['repair','维修师傅'],['inventory','进出货人员']];
  const labels={review:'待审核',reviewed:'已审核待发布',published:'已发布',disabled:'已停用'};
  shell('资料与设置','四组资料 · 全部为本地模拟',`<nav class="actions" aria-label="设置分组"><a class="button" href="#settings-accounts" data-setting-jump="accounts">账号权限</a><a class="button" href="#settings-manuals" data-setting-jump="manuals">手册资料</a><a class="button" href="#settings-catalog" data-setting-jump="catalog">基础资料</a><a class="button" href="#settings-opening" data-setting-jump="opening">建账与更正</a></nav><div class="grid service-settings"><section class="panel" id="settings-accounts"><h2>账号与职责</h2><p>账号管理按当前职责开放。至少保留一位启用的负责人；真实权限仍须后端校验。</p>${serviceStore.accounts.map(account=>`<details><summary>${esc(account.name)} · ${account.enabled?'启用':'停用'}</summary><form data-account="${account.id}" class="fields">${field('显示名称','name',account.name,'required maxlength="100"')}<fieldset><legend>可兼任多个职责</legend>${roles.map(([value,label])=>`<label class="check"><input type="checkbox" name="roles" value="${value}" ${account.roles.includes(value)?'checked':''}><span>${label}</span></label>`).join('')}</fieldset><label class="check"><input type="checkbox" name="enabled" ${account.enabled?'checked':''}><span>启用账号</span></label>${check('我已核对账号与职责，确认模拟保存。')}<button>保存账号（演示）</button></form></details>`).join('')}<details><summary>新增演示账号</summary><form id="service-new-account" class="fields">${field('显示名称','name','','required maxlength="100"')}${select('初始职责','role',roles.map(([id,name])=>({id,name})))}${check('确认新增虚构演示账号。')}<button>新增账号（演示）</button></form></details></section><section class="panel" id="settings-manuals"><h2>手册与版本</h2><p>精确机型、来源、版本、审核与发布分别核对；停用后不再默认用于新查询。</p>${serviceStore.manuals.map(row=>`<article class="service-row"><h3>${esc(row.name)} ${esc(row.version)}</h3><p>${esc(row.model)} · ${labels[row.status]}</p><p>来源：${esc(row.source)} · 页码：${esc(row.pages)}</p>${row.status==='review'?'<button data-manual-id="'+row.id+'" data-manual-state="reviewed">审核通过（演示）</button>':row.status==='reviewed'?'<button data-manual-id="'+row.id+'" data-manual-state="published">确认发布（演示）</button>':row.status==='published'?'<button data-manual-id="'+row.id+'" data-manual-state="disabled">确认停用（演示）</button>':'<button data-manual-id="'+row.id+'" data-manual-state="review">重新送审（演示）</button>'}</article>`).join('')}<details><summary>登记手册新版本</summary><form id="service-new-manual" class="fields">${field('文档名称','name','','required maxlength="100"')}${field('适用准确型号','model','','required maxlength="100"')}${field('版本或日期','version','','required maxlength="100"')}${serviceText('资料来源（虚构）','source','','required maxlength="2000"')}${field('已核对数字页码（如12、13）','pages','','required maxlength="100"')}${check('确认仅登记虚构资料元信息，提交待审核。')}<button>提交审核（演示）</button></form></details></section><section class="panel" id="settings-catalog"><h2>基础资料</h2><p>维护库房、准确型号与独立客户引用。</p><div class="actions"><a class="button" href="#catalog">库房与型号</a><a class="button" href="#customers">客户资料</a></div></section><section class="panel" id="settings-opening"><h2>期初建账与库存更正</h2><p>核对T0、实物与留货；更正先定位原单，保留原因与依据。</p><div class="actions"><a class="button" href="#opening">期初建账</a><a class="button" href="#correction">原单更正</a><a class="button" href="#correction?kind=inventory_adjustment">盘点调整</a><a class="button" href="#reconciliation">只读对账</a></div>${serviceNote}</section></div>`,'',true);
  if(!serviceAllowed('account.manage'))$('#settings-accounts').innerHTML='<h2>账号与职责</h2><p>当前账号无账号管理权限，请交由获授权负责人维护。</p>';
  if(!serviceAllowed('knowledge.publish'))$('#service-new-manual').closest('details').remove();
  document.querySelectorAll('[data-manual-state]').forEach(button=>{if(!serviceAllowed(button.dataset.manualState==='reviewed'?'knowledge.review':'knowledge.publish'))button.remove();});
  const destinations={'#catalog':'catalog.manage','#customers':'reservation.confirm','#opening':'inventory.opening','#correction':'inventory.correct','#correction?kind=inventory_adjustment':'inventory.correct','#reconciliation':'inventory.correct'};
  for(const [href,permission] of Object.entries(destinations))if(!serviceAllowed(permission))document.querySelectorAll('.service-settings a').forEach(link=>{if(link.getAttribute('href')===href)link.remove();});
  document.querySelectorAll('[data-setting-jump]').forEach(link=>link.onclick=event=>{event.preventDefault();document.getElementById('settings-'+link.dataset.settingJump).scrollIntoView({block:'start'});});
  document.querySelectorAll('[data-account]').forEach(form=>form.onsubmit=event=>{event.preventDefault();if(!serviceRequire('account.manage'))return;try{const values=new FormData(form);serviceStore.saveAccount(form.dataset.account,{name:String(values.get('name')).trim(),roles:values.getAll('roles'),enabled:values.has('enabled')});settingsPage();notify('演示账号已保存，未改变正式权限。');}catch(error){notify(error.message);}});
  if($('#service-new-account'))$('#service-new-account').onsubmit=event=>{event.preventDefault();if(!serviceRequire('account.manage'))return;const values=new FormData(event.target);if(!values.get('role'))return notify('请选择初始职责。');serviceStore.accounts.push({id:'demo-account-'+(++serviceStore.sequence),name:String(values.get('name')).trim(),roles:[values.get('role')],enabled:true,version:1});settingsPage();notify('演示账号已新增。');};
  if($('#service-new-manual'))$('#service-new-manual').onsubmit=event=>{event.preventDefault();if(!serviceRequire('knowledge.publish'))return;try{serviceStore.addManual(Object.fromEntries(new FormData(event.target)));settingsPage();notify('演示资料已进入待审核，尚未发布。');}catch(error){notify(error.message);}};
  document.querySelectorAll('[data-manual-state]').forEach(button=>button.onclick=()=>{const permission=button.dataset.manualState==='reviewed'?'knowledge.review':'knowledge.publish';if(!serviceRequire(permission))return;const reader=serviceDialog('资料状态确认 · 演示',`<p>确认将此虚构版本设为“${labels[button.dataset.manualState]}”？旧引用仍保留原版本。</p><form>${check('我已核对机型、版本与来源，确认模拟变更。')}<button class="primary">确认变更（演示）</button></form>`);reader.querySelector('form').onsubmit=event=>{event.preventDefault();if(!serviceRequire(permission))return;try{serviceStore.manualTransition(button.dataset.manualId,button.dataset.manualState);reader.close();settingsPage();notify('演示资料状态已更新。');}catch(error){notify(error.message);}};});
}
if(typeof module!=='undefined')module.exports={ServiceMockStore,servicePendingItems};
