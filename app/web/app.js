'use strict';
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const icon = name => `<svg class="icon" aria-hidden="true"><use href="/web/assets/icons.svg#${name}"></use></svg>`;
const state = {user:null, warehouses:[], models:[], customers:[], draft:null};
let renderVersion = 0;
const canOpen = () => state.user?.permissions.includes('inventory.opening');
const stamp = value => value ? new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'medium',timeStyle:'short'}).format(new Date(value)) : '未知';
const localTime = value => value ? new Date(new Date(value).getTime()+8*3600000).toISOString().slice(0,16) : '';
function notify(message){ $('#notice').innerHTML=`<button type="button" id="dismiss">关闭</button>${esc(message)}`; $('#notice').hidden=false; $('#dismiss').onclick=()=>$('#notice').hidden=true; }
async function api(path, method='GET', body){
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
function options(rows, selected, blank='请选择', enabledOnly=false){return `<option value="">${blank}</option>`+rows.filter(x=>!enabledOnly||x.enabled).map(x=>`<option value="${x.id}" ${x.id===selected?'selected':''}>${esc(x.name||x.display_name)}${x.code?' · '+esc(x.code):''}${x.enabled===false?'（已停用）':''}${x.phone?' · '+esc(x.phone):''}${x.address?' · '+esc(x.address):''}</option>`).join('');}
const select=(label,name,rows,selected='',enabledOnly=false)=>`<label class="field"><span>${label}</span><select name="${name}">${options(rows,selected,'请选择'+label,enabledOnly)}</select></label>`;
function metrics(value){return `<dl class="metrics">${[['实物在库','on_hand'],['已预留','reserved'],['可售','available']].map(([label,key])=>`<div><dt>${label}</dt><dd>${esc(value[key])}<small>台</small></dd></div>`).join('')}</dl>`;}
function shell(title,subtitle,content,action='',secondary=false){
  $('#app').innerHTML=`<div class="shell"><header class="top material-ink"><div class="bar"><div>${secondary?'<a href="#inventory">← 返回库存</a>':''}<h1>${title}</h1></div>${action}</div><p>${subtitle}</p><div class="identity"><small>${esc(state.user.username)} · 当前已登录</small><button id="logout" type="button">退出登录</button></div></header><main id="main" class="content">${content}</main><footer class="page-footer">本机开发验证 · 请使用明确标注的样例，不录入真实客户资料</footer></div>`;
  $('#logout').onclick=async()=>{try{await api('/auth/logout','POST');state.user=null;location.hash='login';}catch(error){notify(error.message);}};
}
function loginPage(){
  $('#app').innerHTML=`<main class="login" id="main"><header class="top material-ink"><p>门店内部协作</p><h1>门店助手</h1><p>登录后，核对每一笔库存起点。</p></header><section class="panel"><h2>登录</h2><form id="login-form" class="fields">${field('账号','username','','required autocomplete="username" maxlength="64"')}${field('密码','password','','required autocomplete="current-password" maxlength="256"','password')}<button class="primary" type="submit">登录门店助手</button><p class="muted">每人使用独立账号。首次负责人由本机初始化，当前没有默认密码。</p></form></section></main>`;
  $('#login-form').onsubmit=async event=>{event.preventDefault();const form=event.target;const button=form.querySelector('button');button.disabled=true;try{state.user=await api('/auth/login','POST',Object.fromEntries(new FormData(form)));form.reset();location.hash='inventory';}catch(error){notify(error.message);}finally{button.disabled=false;}};
}
async function loadCatalog(){[state.warehouses,state.models]=await Promise.all([api('/catalog/warehouses'),api('/catalog/models')]);}
async function inventoryPage(){
  await loadCatalog();
  const owner=canOpen();
  shell('库存','按库房、型号查询 · 数量来自共享服务',`<nav class="actions workflow-nav" aria-label="库存办理">${canInbound()||owner?'<a class="button" href="#pending">待核对草稿</a>':''}${owner?'<a class="button" href="#opening">期初建账</a><a class="button" href="#catalog">基础资料</a>':''}</nav><section class="panel"><h2>选择库存对象</h2><form id="query-form" class="fields"><div class="grid two">${select('库房','warehouse_id',state.warehouses)}${select('型号','model_id',state.models)}</div><button class="primary">${icon('search')}查询库存</button></form></section><section id="balance" class="panel"><div class="state">请选择库房和型号，查看建账状态与库存。</div></section>${owner?'<p class="muted">尚无库房或型号？<a href="#catalog">先维护基础资料</a>。期初建账须核对T0实物和具体客户留货。</p>':''}`,canInbound()?'<a class="button primary" href="#inbound">登记入库</a>':'');
  $('#query-form').onsubmit=async event=>{event.preventDefault();const params=new URLSearchParams(new FormData(event.target));if(!params.get('warehouse_id')||!params.get('model_id'))return notify('请选择具体库房和型号。');const button=event.target.querySelector('button');button.disabled=true;try{const result=await api('/inventory/balance?'+params);$('#balance').innerHTML=`<div class="section-head"><h2>${esc(result.warehouse.name)} · ${esc(result.model.name)}</h2><span class="badge">${result.status==='opened'?'已建账':'未建账'}</span></div>${result.status==='opened'?metrics(result)+`<p class="muted">建账时刻：${stamp(result.t0)}（北京时间）<br>查询截至：${stamp(result.queried_at)} · 版本${result.version}</p><h3>期初预留</h3>${result.reservations.length?result.reservations.map(row=>`<div class="row"><div><strong>${esc(row.remaining_quantity)}台尚未提走</strong><p>建账时登记${row.registered_quantity}台 · 已提${row.picked_quantity} · 已取消${row.cancelled_quantity}</p><p>${esc(row.basis_note)}</p></div><span class="badge">${row.is_opening?'期初留货':'留货'}</span></div>`).join(''):'<p class="muted">没有期初预留。</p>'}`:'<div class="state warning">未建账，数量尚未确认，不能按0台理解。请由负责人核对实物和既有留货后建立起点。</div>'}`;}catch(error){notify(error.message);}finally{button.disabled=false;}};
}
function reservationRow(row={}){return `<div class="reservation">${select('客户','customer_id',state.customers,row.customer_id)}${field('T0尚未提走数量','remaining_quantity',row.remaining_quantity??'','min="1" step="1" required','number')}${field('留货依据','reservation_basis',row.basis_note||'','required maxlength="1000"')}<button type="button" data-remove>移除此项</button></div>`;}
function openingParams(form){const values=new FormData(form);return {warehouse_id:values.get('warehouse_id')||null,model_id:values.get('model_id')||null,t0:values.get('t0')?values.get('t0')+':00+08:00':null,on_hand:values.get('on_hand')===''?null:Number(values.get('on_hand')),basis_note:values.get('basis_note'),opening_reservations:[...form.querySelectorAll('.reservation')].map(row=>({customer_id:row.querySelector('[name=customer_id]').value,remaining_quantity:Number(row.querySelector('[name=remaining_quantity]').value),basis_note:row.querySelector('[name=reservation_basis]').value}))};}
function receiptPanel(receipt){return `<div class="state success"><strong>建账已登记</strong><p>这是后端保存的正式回执。期初库存不计入进货。</p></div>${metrics(receipt.balance)}<p class="muted">T0：${stamp(receipt.t0)}（北京时间）<br>登记时间：${stamp(receipt.registered_at)}</p><div class="receipt-id">原单：${esc(receipt.business_id)}<br>操作：${esc(receipt.operation_id)}<br>操作者：${esc(receipt.actor_id)}</div><div class="actions"><a href="#inventory" class="button primary">查询库存</a><a href="#opening" class="button">新建其他起点</a></div>`;}
async function openingPage(params){
  if(!canOpen())throw new Error('只有获授权负责人可办理期初建账。');
  await loadCatalog();state.customers=await api('/catalog/customers');state.draft=params.get('draft')?await api('/drafts/'+encodeURIComponent(params.get('draft'))):null;
  const item=state.draft;const value=item?.parameters||{};
  shell('期初建账','核对一个库房、一个型号的起点 · 期初不计进货',`<div class="grid opening-grid"><section class="panel"><p class="step">01 / 核对起点</p><h2>实物与既有留货</h2><form id="opening-form" class="fields"><div class="grid two">${select('库房','warehouse_id',state.warehouses,value.warehouse_id,true)}${select('型号','model_id',state.models,value.model_id,true)}</div>${field('建账生效时刻T0 · 北京时间','t0',localTime(value.t0),'','datetime-local')}${field('T0实物在库（含留给客户但未提走的货）','on_hand',value.on_hand??'','min="0" step="1"','number')}${field('盘点依据与备注','basis_note',value.basis_note||'','maxlength="1000"')}<div><div class="section-head"><h3>T0尚未提走的留货</h3><button type="button" id="add-reservation">${icon('plus')}添加</button></div><p class="muted">逐笔选定客户，仅填建账时剩余量；已提和已取消从0开始。</p><div id="reservations">${(value.opening_reservations||[]).map(reservationRow).join('')}</div><a href="#catalog">登记或核对客户资料</a></div><button class="primary" id="save-draft">保存草稿并预览</button></form></section><aside class="panel"><p class="step">02 / 人工确认</p><h2>建账影响</h2><div id="preview"><div class="state">填写并保存草稿后，由后端计算在库、预留和可售。预览不会锁定库存。</div></div></aside></div>`,'',true);
  const form=$('#opening-form');let dirty=false;
  const markDirty=()=>{dirty=true;$('#preview').innerHTML='<div class="state warning">内容已修改，请重新保存并核对预览。旧版确认不能使用。</div>';};
  form.addEventListener('input',markDirty);form.addEventListener('change',markDirty);
  $('#add-reservation').onclick=()=>{$('#reservations').insertAdjacentHTML('beforeend',reservationRow());markDirty();};
  $('#reservations').onclick=event=>{if(event.target.closest('[data-remove]')){event.target.closest('.reservation').remove();markDirty();}};
  const showPreview=async()=>{
    const row=state.draft;if(!row)return;
    if(row.state==='succeeded'){const operation=await api('/operations/'+row.operation_id);$('#preview').innerHTML=receiptPanel(operation.result);form.querySelectorAll('input,select,button').forEach(x=>x.disabled=true);return;}
    if(!row.preview){$('#preview').innerHTML=`<div class="state warning">草稿已保存，尚缺：${esc(row.missing_fields.map(x=>({warehouse_id:'库房',model_id:'型号',t0:'T0',on_hand:'实物数量',basis_note:'盘点依据'}[x]||x)).join('、'))}。补齐后重新预览。</div>`;return;}
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
  await loadCatalog();state.customers=await api('/catalog/customers');
  const build=(kind,title,rows)=>`<section class="panel"><h2>${title}</h2><form data-create="${kind}" class="fields">${kind==='warehouses'?field('库房编号','code','','required maxlength="32"'):''}${field(kind==='customers'?'客户称呼':'名称',kind==='customers'?'display_name':'name','','required maxlength="100"')}${kind==='models'?field('经核实别名（用逗号分隔）','aliases'):''}${kind==='customers'?field('已知联系方式（未知留空）','phone','','maxlength="64"')+field('已知地址（未知留空）','address','','maxlength="500"'):''}${check('我已核对资料，确认登记。')}<button class="primary">登记${title}</button></form><h3 style="margin-top:24px">已登记${title}</h3>${rows.map(row=>kind==='customers'?`<div class="row"><div><strong>${esc(row.display_name)}</strong><p>${esc(row.phone||'联系方式未知')} · ${esc(row.address||'地址未知')}</p></div></div>`:`<details><summary>${esc(row.name)} <span class="badge">${row.enabled?'启用':'停用'} · V${row.version}</span></summary><form data-edit="${kind}" data-id="${row.id}" data-version="${row.version}" class="fields">${kind==='warehouses'?field('编号','code',row.code,'required maxlength="32"'):''}${field('名称','name',row.name,'required maxlength="100"')}${kind==='models'?field('经核实别名','aliases',row.aliases.join(', ')):''}<label class="check"><input type="checkbox" name="enabled" ${row.enabled?'checked':''}><span>启用（停用后保留已有台账）</span></label>${check('我已核对，确认保存此次变更。')}<button>确认保存</button></form></details>`).join('')||'<p class="muted">尚未登记。</p>'}</section>`;
  shell('基础资料','由负责人维护 · 保留来源与修订，不删除历史标识',`<div class="grid catalog-grid">${build('warehouses','库房',state.warehouses)}${build('models','型号',state.models)}${build('customers','客户引用',state.customers)}</div>`,'',true);
  document.querySelectorAll('[data-create],[data-edit]').forEach(form=>form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;const data=Object.fromEntries(new FormData(form));data.confirmed=true;if('aliases'in data)data.aliases=data.aliases.split(/[,，]/).map(x=>x.trim()).filter(Boolean);if(form.dataset.edit){data.enabled=form.elements.enabled.checked;data.expected_version=Number(form.dataset.version);}else if(form.dataset.create==='customers'){data.phone=data.phone||null;data.address=data.address||null;}try{await api('/catalog/'+(form.dataset.create||form.dataset.edit)+(form.dataset.id?'/'+form.dataset.id:''),form.dataset.edit?'PATCH':'POST',data);await render();notify('资料已保存，修订记录由后端保留。');}catch(error){notify(error.message);button.disabled=false;}});
}
async function render(){
  const version=++renderVersion;$('#notice').hidden=true;
  try{
    if(!state.user){try{state.user=await api('/auth/me');}catch{loginPage();return;}}
    if(version!==renderVersion)return;
    const [page,query='']=location.hash.slice(1).split('?');
    if(page==='opening')await openingPage(new URLSearchParams(query));else if(page==='catalog')await catalogPage();else if(page==='inbound')await inboundPage(new URLSearchParams(query));else if(page==='pending')await pendingPage();else await inventoryPage();
  }catch(error){notify(error.message);}
}
if(typeof module!=='undefined')module.exports={api};
else {
  $('.skip').onclick=event=>{event.preventDefault();const main=$('#main');if(main){main.setAttribute('tabindex','-1');main.focus();}};
  window.addEventListener('hashchange',render);render();
}
