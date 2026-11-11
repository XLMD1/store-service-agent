'use strict';
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const icon = name => `<svg class="icon" aria-hidden="true"><use href="/web/assets/icons.svg#${name}"></use></svg>`;
const state = {user:null, warehouses:[], models:[], customers:[], draft:null};
let renderVersion = 0;
const isMockMode=()=>typeof FrontendMock!=='undefined';
const canOpen = () => state.user?.permissions.includes('inventory.opening');
const stamp = value => value ? new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'medium',timeStyle:'short'}).format(new Date(value)) : '未知';
const localTime = value => value ? new Date(new Date(value).getTime()+8*3600000).toISOString().slice(0,16) : '';
function notify(message){ $('#notice').innerHTML=`<button type="button" id="dismiss">关闭</button>${esc(isMockMode()?'演示：'+message:message)}`; $('#notice').hidden=false; $('#dismiss').onclick=()=>$('#notice').hidden=true; }
async function api(path, method='GET', body){
  if(isMockMode())return FrontendMock.request(path,method,body);
  const headers={};
  if(method!=='GET'){
    const csrf=await fetch('/api/auth/csrf',{cache:'no-store',credentials:'same-origin'});
    if(!csrf.ok) throw new Error('暂时无法取得确认凭据，请稍后重试。');
    headers['X-CSRF-Token']=(await csrf.json()).csrf_token; headers['Content-Type']='application/json';
  }
  let response;
  try { response=await fetch('/api'+path,{method,headers,credentials:'same-origin',cache:'no-store',...(body!==undefined?{body:JSON.stringify(body)}:{})}); }
  catch { throw new Error('连接中断，提交结果尚未核验。请保留当前页面并按原操作核验。'); }
  let data=null;
  if(response.status!==204){
    try{data=await response.json();}
    catch{throw new Error('响应不完整，提交结果尚未核验。请按原操作核验，勿重新建立操作。');}
  }
  if(!response.ok){
    if(response.status===401) {state.user=null; location.hash='login';}
    const messages={401:'登录已失效或账号密码不正确，请重新登录。',403:'当前账号无权操作，或确认凭据已失效。',409:'数据或草稿已变化，请重新查询、预览并确认。',422:'输入不符合要求，请核对数量、时间、资料状态及留货依据。',429:'登录尝试过多，请在5分钟后重试。',404:'未找到对应资料或草稿。'};
    throw new Error(messages[response.status]||'服务暂时不可用，请按原操作核验。');
  }
  return data;
}
const field=(label,name,value='',attrs='',type='text')=>`<label class="field"><span>${label}</span><input name="${name}" type="${type}" value="${esc(value)}" ${attrs}></label>`;
const check=(text,name='confirmed')=>`<label class="check"><input type="checkbox" name="${name}" required><span>${text}</span></label>`;
function options(rows, selected, blank='请选择', enabledOnly=false){return `<option value="">${blank}</option>`+rows.filter(x=>!enabledOnly||x.enabled).map(x=>`<option value="${x.id}" ${x.id===selected?'selected':''}>${esc(x.name||x.display_name)}${x.code&&rows.filter(row=>row.name===x.name).length>1?' · 区分编号 '+esc(x.code):''}${x.enabled===false?'（已停用）':''}${x.phone?' · '+esc(x.phone):''}${x.address?' · '+esc(x.address):''}</option>`).join('');}
const select=(label,name,rows,selected='',enabledOnly=false)=>`<label class="field"><span>${label}</span><select name="${name}">${options(rows,selected,'请选择'+label,enabledOnly)}</select></label>`;
function metrics(value){return `<dl class="metrics">${[['实物在库','on_hand'],['已预留','reserved'],['可售','available']].map(([label,key])=>`<div><dt>${label}</dt><dd>${esc(value[key])}<small>台</small></dd></div>`).join('')}</dl>`;}
function keepSidebarCurrentVisible(){
  const nav=$('.sidebar-organized>nav'),active=nav?.querySelector('[aria-current=page]');
  if(!active||!active.getClientRects().length)return;
  const container=nav.getBoundingClientRect(),link=active.getBoundingClientRect();
  if(link.bottom>container.bottom)nav.scrollTop+=link.bottom-container.bottom;
  else if(link.top<container.top)nav.scrollTop-=container.top-link.top;
}
function sidebarNavigation(navigation,current,title){
  const active=current==='movement'?(title==='普通出库'?'movement?kind=inventory_outbound':'reservations'):current==='source'?'sources':current;
  const link=([page,label,symbol,permission,shortLabel])=>`<a href="#${page}" title="${label}" aria-label="${label}" ${active===page?'aria-current="page"':''}>${icon(symbol)}<span class="nav-label">${label}</span><span class="nav-short" aria-hidden="true">${shortLabel}</span></a>`;
  if(isMockMode())return navigation.map(link).join('');
  const groups=[{id:'daily',label:'日常工作',short:'日常',pages:['home','pending','sources','inventory','inbound','movement?kind=inventory_outbound','reservations']},
    {id:'reports',label:'统计与核对',short:'统计',pages:['statistics','ledger','reconciliation','correction']},
    {id:'setup',label:'资料与设置',short:'资料',pages:['catalog','customers','opening','deepseek-settings']}];
  return groups.map(group=>{
    const rows=group.pages.map(page=>navigation.find(row=>row[0]===page)).filter(Boolean);
    if(!rows.length)return '';
    const caption=`<span class="nav-group-label">${group.label}</span><span class="nav-group-short" aria-hidden="true">${group.short}</span>`;
    if(group.id==='daily')return `<section class="sidebar-group" data-sidebar-group="daily"><h2 class="sidebar-group-title">${caption}</h2>${rows.map(link).join('')}</section>`;
    const open=rows.some(row=>row[0]===active)||(state.sidebarOpen?.[group.id]??group.id==='reports');
    return `<details class="sidebar-group" data-sidebar-group="${group.id}" ${open?'open':''}><summary>${caption}<span class="sidebar-caret" aria-hidden="true">›</span></summary>${rows.map(link).join('')}</details>`;
  }).join('');
}
function shell(title,subtitle,content,action='',secondary=false){
  const permissions=state.user.permissions,current=location.hash.slice(1).split('?')[0]||'home';
  const navigation=[...(!isMockMode()?[['home','工作台','home','inventory.read','工作'],['deepseek-settings','DeepSeek设置','settings','account.manage','模型'],['sources','售后来源','file','service.read','来源']]:[]),...(isMockMode()?[['home','工作台','home','inventory.read','工作'],['service-search','售后档案','file','service.read','售后'],['repair-assistant','维修辅助','wrench','repair.query','维修'],['settings','资料与设置','settings','inventory.read','设置']]:[]),['inventory','库存查询','box','inventory.read','库存'],['reservations','预留查询','box','inventory.read','预留'],['ledger','库存流水','file','inventory.read','流水'],['pending','待核对草稿','clipboard',permissions.find(x=>['inventory.inbound','inventory.outbound','reservation.confirm','reservation.cancel','reservation.pickup','inventory.opening',...(isMockMode()?['service.draft']:['inventory.read'])].includes(x)),'草稿'],['statistics','进货统计','file','inventory.read','统计'],['correction','原单更正','settings','inventory.correct','更正'],['reconciliation','库存对账','file','inventory.correct','对账'],['inbound','登记入库','plus','inventory.inbound','入库'],...(!isMockMode()?[['movement?kind=inventory_outbound','普通出库','box','inventory.outbound','出库']]:[]),['customers','客户资料','file','reservation.confirm','客户'],['catalog','库房与型号','settings','inventory.opening','资料'],['opening','期初建账','settings','inventory.opening','建账']].filter(row=>permissions.includes(row[3]));
  const returnLink=['service-draft','service-detail','repair-assistant','settings','task','deepseek-settings'].includes(current)?`<a href="#${current==='service-draft'?'pending':current==='service-detail'?'service-search':'home'}">← 返回${current==='service-draft'?'待核对':current==='service-detail'?'售后检索':'工作台'}</a>`:'<a href="#inventory">← 返回库存</a>';
  const mobileNav=secondary?'':`<nav class="mobile-primary" aria-label="手机主导航">${[['home','工作台','home'],['pending','待核对','clipboard'],['service-search','售后','file'],['inventory','库存','box']].map(([route,label,symbol])=>`<a href="#${route}" ${current===route?'aria-current="page"':''}>${icon(symbol)}<span>${label}</span></a>`).join('')}</nav>`;
  $('#app').innerHTML=`<div class="workspace" id="workspace"><aside class="desktop-sidebar material-ink ${isMockMode()?'':'sidebar-organized'}" aria-label="电脑端导航"><a class="workspace-brand" href="#inventory">门店助手<small>售后与库存协作</small></a><p class="sidebar-label">${isMockMode()?'门店工作区':'库存工作区'}</p><nav aria-label="业务导航">${sidebarNavigation(navigation,current,title)}</nav><div class="sidebar-foot"><strong>${esc(state.user.username)}</strong><span>本机审核环境</span></div></aside><div class="shell"><div class="workspace-toolbar"><span class="workspace-location">${isMockMode()?'门店工作区':'库存工作区'} / ${esc(title)}</span><div class="view-switch" role="group" aria-label="页面模式"><button id="view-desktop" type="button">电脑端</button><button id="view-mobile" type="button">手机端</button></div></div><header class="top material-ink"><div class="bar"><div>${secondary?returnLink:''}<h1>${title}</h1></div>${action}</div><p>${subtitle}</p><div class="identity"><small>${esc(state.user.username)} · 当前已登录</small><button id="logout" type="button">退出登录</button></div></header><main id="main" class="content">${content}</main>${mobileNav}<footer class="page-footer">${isMockMode()?'前端演示 · 全部虚构数据 · 不写入真实台账':'本机开发验证 · 请使用明确标注的样例，不录入真实客户资料'}</footer></div></div>`;
  document.querySelectorAll('details[data-sidebar-group]').forEach(group=>{group.ontoggle=()=>{state.sidebarOpen||={};state.sidebarOpen[group.dataset.sidebarGroup]=group.open;};});
  const setView=mode=>{state.viewMode=mode;$('#workspace').dataset.view=mode;$('#view-desktop').setAttribute('aria-pressed',String(mode==='desktop'));$('#view-mobile').setAttribute('aria-pressed',String(mode==='mobile'));keepSidebarCurrentVisible();};
  setView(state.viewMode||(window.matchMedia('(min-width: 1000px)').matches?'desktop':'mobile'));
  $('#view-desktop').onclick=()=>setView('desktop');$('#view-mobile').onclick=()=>setView('mobile');

  window.scrollTo(0,0);
  $('#logout').onclick=async()=>{try{await api('/auth/logout','POST');state.user=null;location.hash='login';}catch(error){notify(error.message);}};
}
function loginPage(){
  $('#app').innerHTML=`<main class="login" id="main"><header class="top material-ink"><p>门店内部协作</p><h1>门店助手</h1><p>登录后，核对每一笔库存起点。</p></header><section class="panel"><h2>登录</h2><form id="login-form" class="fields">${field('账号','username','','required autocomplete="username" maxlength="64"')}${field('密码','password','','required autocomplete="current-password" maxlength="256"','password')}<button class="primary" type="submit">登录门店助手</button><p class="muted">${isMockMode()?'仅演示：账号demo-owner，口令demo。请勿输入真实密码。':'每人使用独立账号。首次负责人由本机初始化，当前没有默认密码。'}</p></form></section></main>`;
  $('#login-form').onsubmit=async event=>{event.preventDefault();const form=event.target;const button=form.querySelector('button');button.disabled=true;try{state.user=await api('/auth/login','POST',Object.fromEntries(new FormData(form)));form.reset();location.hash='home';}catch(error){notify(error.message);}finally{button.disabled=false;}};
}
async function loadCatalog(){[state.warehouses,state.models]=await Promise.all([api('/catalog/warehouses'),api('/catalog/models')]);}
function reservationRow(row={}){return `<div class="reservation">${select('客户','customer_id',state.customers,row.customer_id)}${field('T0尚未提走数量','remaining_quantity',row.remaining_quantity??'','min="1" step="1" required','number')}${field('留货依据','reservation_basis',row.basis_note||'','required maxlength="1000"')}<button type="button" data-remove>移除此项</button></div>`;}
function openingParams(form){const values=new FormData(form);return {warehouse_id:values.get('warehouse_id')||null,model_id:values.get('model_id')||null,t0:values.get('t0')?values.get('t0')+':00+08:00':null,on_hand:values.get('on_hand')===''?null:Number(values.get('on_hand')),basis_note:values.get('basis_note'),opening_reservations:[...form.querySelectorAll('.reservation')].map(row=>({customer_id:row.querySelector('[name=customer_id]').value,remaining_quantity:Number(row.querySelector('[name=remaining_quantity]').value),basis_note:row.querySelector('[name=reservation_basis]').value}))};}
function receiptPanel(receipt){return `<div class="state success"><strong>${isMockMode()?'模拟建账完成':'建账已登记'}</strong><p>${isMockMode()?'前端模拟回执，未写入真实台账。':'这是后端保存的正式回执。'}期初库存不计入进货。</p></div>${metrics(receipt.balance)}<p class="muted">T0：${stamp(receipt.t0)}（北京时间）<br>登记时间：${stamp(receipt.registered_at)}</p><div class="receipt-id">原单：${esc(receipt.business_id)}<br>操作：${esc(receipt.operation_id)}<br>操作者：${esc(receipt.actor_id)}</div><div class="actions"><a href="#inventory" class="button primary">查询库存</a><a href="#opening" class="button">新建其他起点</a></div>`;}
async function openingPage(params){
  if(!canOpen())throw new Error('只有获授权负责人可办理期初建账。');
  await loadCatalog();state.customers=await api('/catalog/customers');state.draft=params.get('draft')?await api('/drafts/'+encodeURIComponent(params.get('draft'))):null;
  const item=state.draft;const value=item?.parameters||{warehouse_id:params.get('warehouse'),model_id:params.get('model')};
  shell('期初建账','核对一个库房、一个型号的起点 · 期初不计进货',`<div class="grid opening-grid"><section class="panel"><p class="step">01 / 核对起点</p><h2>实物与既有留货</h2><form id="opening-form" class="fields"><div class="grid two">${select('库房','warehouse_id',state.warehouses,value.warehouse_id,true)}${select('型号','model_id',state.models,value.model_id,true)}</div>${field('建账生效时刻T0 · 北京时间','t0',localTime(value.t0),'','datetime-local')}${field('T0实物在库（含留给客户但未提走的货）','on_hand',value.on_hand??'','min="0" step="1"','number')}${field('盘点依据与备注','basis_note',value.basis_note||'','maxlength="1000"')}<div><div class="section-head"><h3>T0尚未提走的留货</h3><button type="button" id="add-reservation">${icon('plus')}添加</button></div><p class="muted">逐笔选定客户，仅填建账时剩余量；已提和已取消从0开始。</p><div id="reservations">${(value.opening_reservations||[]).map(reservationRow).join('')}</div><a href="#customers">登记或核对客户资料</a></div><button class="primary" id="save-draft">保存草稿并预览</button></form></section><aside class="panel"><p class="step">02 / 人工确认</p><h2>建账影响</h2><div id="preview"><div class="state">填写并保存草稿后，${isMockMode()?'由前端模拟':'由后端计算'}在库、预留和可售。预览不会锁定库存。</div></div></aside></div>`,'',true);
  const form=$('#opening-form');let dirty=false;
  const markDirty=()=>{dirty=true;$('#preview').innerHTML='<div class="state warning">内容已修改，请重新保存并核对预览。旧版确认不能使用。</div>';};
  form.addEventListener('input',markDirty);form.addEventListener('change',markDirty);
  $('#add-reservation').onclick=()=>{$('#reservations').insertAdjacentHTML('beforeend',reservationRow());markDirty();};
  $('#reservations').onclick=event=>{if(event.target.closest('[data-remove]')){event.target.closest('.reservation').remove();markDirty();}};
  const showPreview=async()=>{
    const row=state.draft;if(!row)return;
    if(row.state==='succeeded'){const operation=await api('/operations/'+row.operation_id);$('#preview').innerHTML=receiptPanel(operation.result);form.querySelectorAll('input,select,button').forEach(x=>x.disabled=true);return;}
    if(!row.preview){$('#preview').innerHTML=`<div class="state warning">草稿已保存，尚缺：${esc(row.missing_fields.map(x=>({review_required:'补充说明后重新核对',warehouse_id:'库房',model_id:'型号',t0:'T0',on_hand:'实物数量',basis_note:'盘点依据'}[x]||x)).join('、'))}。补齐后重新预览。</div>`;return;}
    $('#preview').innerHTML=`<div class="state">草稿第${row.version}版 · 尚未建账</div>${metrics(row.preview)}<p><strong>${esc(state.warehouses.find(x=>x.id===row.parameters.warehouse_id)?.name)} · ${esc(state.models.find(x=>x.id===row.parameters.model_id)?.name)}</strong></p><p class="muted">T0：${stamp(row.parameters.t0)}（北京时间）<br>留货${row.parameters.opening_reservations.length}笔，期初不计进货。</p><form id="confirm-form">${check('我已核对T0实物、每笔客户留货及以上数量。')}<button class="primary" type="submit">确认建立起点</button></form><div class="actions"><button type="button" id="verify-operation">按原操作核验结果</button></div>`;
    const verify=async()=>{const result=await api('/operations/'+row.operation_id);if(result.state==='succeeded'){state.draft.state='succeeded';await showPreview();}else {notify(result.state==='pending'?'此操作仍待人工确认，尚无已提交回执。':'旧操作已失效，请重新保存并预览。'); if(result.state==='pending')$('#confirm-form button').disabled=false;}};
    $('#verify-operation').onclick=()=>verify().catch(error=>notify(error.message));
    $('#confirm-form').onsubmit=async event=>{event.preventDefault();if(dirty)return notify('内容有修改，请重新保存草稿。');const button=event.target.querySelector('button');button.disabled=true;try{const result=await FormState.freezeWhile(form,()=>api('/operations/'+row.operation_id+'/confirm','POST',{draft_id:row.id,draft_version:row.version,parameters:row.parameters}));if(!form.isConnected)return;state.draft.state='succeeded';$('#preview').innerHTML=receiptPanel(result);form.querySelectorAll('input,select,button').forEach(x=>x.disabled=true);}catch(error){notify(error.message);button.disabled=true;}};
  };
  form.onsubmit=async event=>{event.preventDefault();const button=$('#save-draft');button.disabled=true;try{const body={parameters:openingParams(form)};const saved=await FormState.freezeWhile(form,()=>state.draft?api('/drafts/'+state.draft.id,'PATCH',{...body,expected_version:state.draft.version}):api('/drafts','POST',{...body,kind:'inventory_opening'}));if(!form.isConnected)return;state.draft=saved;history.replaceState(null,'','#opening?draft='+state.draft.id);dirty=false;await showPreview();}catch(error){notify(error.message);}finally{button.disabled=false;}};
  await showPreview();
}
async function catalogPage(){
  if(!canOpen())throw new Error('只有获授权负责人可维护基础资料。');
  await loadCatalog();
  const build=(kind,title,rows)=>`<section class="panel"><h2>${title}</h2><form data-create="${kind}" class="fields">${field(kind==='warehouses'?'库房名称':'型号名称','name','','required maxlength="100"')}${kind==='models'?field('经核实别名（用逗号分隔）','aliases'):''}${check('我已核对资料，确认登记。')}<button class="primary">登记${title}</button></form><h3 class="section-note">已登记${title}</h3>${rows.map(row=>`<details><summary>${esc(row.name)}${kind==='warehouses'&&rows.filter(other=>other.name===row.name).length>1?'<span class="receipt-id">区分编号：'+esc(row.code)+'</span>':''} <span class="badge">${row.enabled?'启用':'停用'} · V${row.version}</span></summary><form data-edit="${kind}" data-id="${row.id}" data-version="${row.version}" class="fields">${field(kind==='warehouses'?'库房名称':'型号名称','name',row.name,'required maxlength="100"')}${kind==='models'?field('经核实别名','aliases',row.aliases.join(', ')):''}<label class="check"><input type="checkbox" name="enabled" ${row.enabled?'checked':''}><span>启用（停用后保留已有台账）</span></label>${check('我已核对，确认保存此次变更。')}<button>确认保存</button></form></details>`).join('')||'<p class="muted">尚未登记。</p>'}</section>`;
  shell('库房与型号','库房只需填写一个名称；同一库房可存放多个型号',`<div class="state">先登记库房和型号，再分别核对各型号的库存起点。客户统一在此登记：<a class="button" href="#customers">客户资料</a></div><div class="grid catalog-grid">${build('warehouses','库房',state.warehouses)}${build('models','型号',state.models)}</div>`,'',true);
  document.querySelectorAll('[data-create],[data-edit]').forEach(form=>form.onsubmit=async event=>{event.preventDefault();const data=Object.fromEntries(new FormData(form));data.confirmed=true;if('aliases'in data)data.aliases=data.aliases.split(/[,，]/).map(x=>x.trim()).filter(Boolean);if(form.dataset.edit){data.enabled=form.elements.enabled.checked;data.expected_version=Number(form.dataset.version);}try{await FormState.freezeWhile(form,()=>api('/catalog/'+(form.dataset.create||form.dataset.edit)+(form.dataset.id?'/'+form.dataset.id:''),form.dataset.edit?'PATCH':'POST',data));await render();notify(isMockMode()?'模拟资料已保存，修订仅在当前页面内存保留。':'资料已保存，修订记录由后端保留。');}catch(error){notify(error.message);}});
}
async function render(){
  const version=++renderVersion;$('#notice').hidden=true;
  try{
    if(!state.user){try{state.user=await api('/auth/me');}catch{loginPage();return;}}
    if(version!==renderVersion)return;
    const [page,query='']=location.hash.slice(1).split('?');
    if(!isMockMode()&&page==='sources')await sourcesPage(new URLSearchParams(query));else if(!isMockMode()&&page==='source')await sourcePage(new URLSearchParams(query));else if(!isMockMode()&&page==='service-search'){shell('售后业务待接入','当前仅提供独立前端演示','<section class="panel"><p>真实售后业务将在M2接入。</p><a class="button" href="/web/mock.html#service-search">打开售后前端演示（虚构数据）</a><a class="button" href="#home">返回工作台</a></section>','',false);}else if(!isMockMode()&&page==='deepseek-settings')await agentSettingsPage();else if(!isMockMode()&&page==='task')await agentTaskPage(new URLSearchParams(query));else if(!isMockMode()&&(!page||page==='home'))await agentHomePage();else if(isMockMode()&&(!page||page==='home'))await homePage();else if(isMockMode()&&page==='service-draft')await serviceDraftPage(new URLSearchParams(query));else if(isMockMode()&&page==='service-search')await serviceSearchPage(new URLSearchParams(query));else if(isMockMode()&&page==='service-detail')await serviceDetailPage(new URLSearchParams(query));else if(isMockMode()&&page==='repair-assistant')await repairPage(new URLSearchParams(query));else if(isMockMode()&&page==='settings')await settingsPage();else if(page==='reserved-pickup')await reservationsPage(new URLSearchParams(query));else if(page==='inbound-statistics')await statisticsPage();else if(page==='statistics')await statisticsPage();else if(page==='correction')await correctionPage(new URLSearchParams(query));else if(page==='reconciliation')await reconciliationPage();else if(page==='opening')await openingPage(new URLSearchParams(query));else if(page==='catalog')await catalogPage();else if(page==='inbound')await inboundPage(new URLSearchParams(query));else if(page==='pending')await pendingPage();else if(page==='movement')await movementPage(new URLSearchParams(query));else if(page==='reservations')await reservationsPage(new URLSearchParams(query));else if(page==='customers')await customerPage();else if(page==='ledger')await ledgerPage(new URLSearchParams(query));else await inventoryPage();
  }catch(error){if(state.user){shell('页面暂时不可用',isMockMode()?'请核对权限或演示场景':'请核对权限或服务连接',`<section class="panel"><p>${esc(error.message)}</p><div class="actions"><button id="retry-page">重试当前页面</button><a class="button" href="#home">回工作台</a></div></section>`,'',true);$('#retry-page').onclick=render;}notify(error.message);}
  if(typeof FrontendPickers!=='undefined')FrontendPickers.refresh();
}
if(typeof module!=='undefined')module.exports={api};
else {
  $('.skip').onclick=event=>{event.preventDefault();const main=$('#main');if(main){main.setAttribute('tabindex','-1');main.focus();}};
  window.addEventListener('hashchange',render);window.addEventListener('resize',keepSidebarCurrentVisible);render();
}
