'use strict';
const canInbound = () => state.user?.permissions.includes('inventory.inbound');
const occurredText = value => value?.precision==='date' ? `${esc(value.date||'日期未填')}（仅知日期）` : `${localInboundTime(value?.at).replace('T',' ')||'时刻未填'}（北京时间）`;
const inboundMissing = key => ({warehouse_id:'库房',model_id:'型号',quantity:'入库数量',occurred:'发生日期或时刻','occurred.date':'发生日期','occurred.at':'发生时刻','occurred.t0_relation':'T0当天事件的先后关系','occurred.boundary_note':'起点边界核实依据',basis_note:'到货依据与备注'}[key]||key);
function localInboundTime(value){
  if(!value)return '';
  const base=new Date(new Date(value).getTime()+8*3600000).toISOString().slice(0,19);
  const fraction=value.match(/\.\d+(?=Z|[+-]\d\d:\d\d$)/)?.[0]||'';
  return base+fraction;
}
function inboundParameters(form,originalAt){
  const value=new FormData(form);const precision=value.get('precision');
  return {warehouse_id:value.get('warehouse_id')||null,model_id:value.get('model_id')||null,
    quantity:value.get('quantity')===''?null:Number(value.get('quantity')),basis_note:value.get('basis_note'),
    occurred:precision==='date'?{precision,date:value.get('date')||null,t0_relation:value.get('t0_relation')||'unknown',boundary_note:value.get('boundary_note')}:
      {precision,at:value.get('at')?(originalAt?.raw&&value.get('at')===originalAt.displayed?originalAt.raw:value.get('at')+'+08:00'):null}};
}
function inboundReceipt(receipt){
  return `<div class="state success"><strong>入库已登记</strong><p>本次实际入库${esc(receipt.quantity)}台，以下为本次提交时的库存。最新余额请重新查询。</p></div><h3>${esc(receipt.balance.warehouse.name)} · ${esc(receipt.balance.model.name)}</h3>${metrics(receipt.balance)}<p class="muted">发生：${occurredText(receipt.occurred)}<br>登记：${stamp(receipt.registered_at)}（北京时间）</p><div class="receipt-id">原单：${esc(receipt.business_id)}<br>操作：${esc(receipt.operation_id)}<br>流水：${esc(receipt.ledger_ids.join('、'))}<br>操作者：${esc(receipt.actor_id)}</div><div class="actions"><a class="button primary" href="#inventory">查询最新库存</a><a class="button" href="#inbound">登记其他到货</a></div>`;
}
function inboundImpact(preview){
  return `<table class="impact"><thead><tr><th>数量</th><th>当前</th><th>确认后预计</th></tr></thead><tbody>${[['实物在库','on_hand'],['已预留','reserved'],['可售','available']].map(([label,key])=>`<tr><th>${label}</th><td>${esc(preview.before[key])}台</td><td>${esc(preview.after[key])}台</td></tr>`).join('')}</tbody></table>`;
}
async function inboundPage(params){
  if(!canInbound())throw new Error('当前账号没有入库权限。');
  await loadCatalog();const item=params.get('draft')?await api('/drafts/'+encodeURIComponent(params.get('draft'))):null;
  if(item&&item.kind!=='inventory_inbound')throw new Error('此草稿属于其他业务，请从待核对列表打开。');
  const value=item?.parameters||{},occurred=value.occurred||{};let current=item,dirty=false;
  shell('入库登记','新到货走入库；期初建账只用于建立库存起点',`<div class="grid opening-grid"><section class="panel"><p class="step">01 / 核对到货</p><h2>本次入库资料</h2><form id="inbound-form" class="fields"><div class="grid two">${select('库房','warehouse_id',state.warehouses,value.warehouse_id,true)}${select('型号','model_id',state.models,value.model_id,true)}</div>${field('本次入库数量','quantity',value.quantity??'','min="1" step="1"','number')}<label class="field"><span>发生时间精度</span><select name="precision"><option value="date" ${occurred.precision!=='datetime'?'selected':''}>只知道日期</option><option value="datetime" ${occurred.precision==='datetime'?'selected':''}>知道精确时刻</option></select></label><div id="date-input">${field('实际发生日期','date',occurred.date||'','','date')}<details id="boundary-input" ${item?.missing_fields.some(x=>x.startsWith('occurred.t0')||x==='occurred.boundary_note')?'open':''}><summary>发生在建账当天？核实起点边界</summary><p class="muted">T0及之前的到货已包含在期初中，不能重复入库。同日先后不清时先保存待核对。</p><label class="field"><span>与T0的先后关系</span><select name="t0_relation"><option value="unknown" ${!occurred.t0_relation||occurred.t0_relation==='unknown'?'selected':''}>尚未核实</option><option value="after" ${occurred.t0_relation==='after'?'selected':''}>已核实在T0之后</option><option value="at_or_before" ${occurred.t0_relation==='at_or_before'?'selected':''}>在T0或之前（不能重复入库）</option></select></label>${field('边界核实依据','boundary_note',occurred.boundary_note||'','maxlength="1000"')}</details></div><div id="time-input">${field('实际发生时刻 · 北京时间','at',localInboundTime(occurred.at),'step="any"','datetime-local')}</div>${field('到货依据与备注','basis_note',value.basis_note||'','maxlength="1000"')}<button class="primary" type="submit">保存草稿并预览</button></form></section><aside class="panel"><p class="step">02 / 人工确认</p><h2>入库影响</h2><div id="inbound-preview"><div class="state">先保存资料，由后端读取最新库存并计算预计影响；保存草稿不会增加库存。</div></div></aside></div>`,'',true);
  const form=$('#inbound-form'),panel=$('#inbound-preview');
  const originalAt={displayed:form.elements.at.value,raw:occurred.at};
  const precisionVisibility=()=>{const exact=form.elements.precision.value==='datetime';$('#date-input').hidden=exact;$('#time-input').hidden=!exact;};precisionVisibility();
  const dirtyForm=()=>{dirty=true;panel.innerHTML='<div class="state warning">资料已修改，请重新保存草稿并核对预览。</div>';};
  form.addEventListener('input',dirtyForm);form.addEventListener('change',()=>{precisionVisibility();dirtyForm();});
  async function show(){
    if(!current)return;
    if(current.state==='succeeded'){const operation=await api('/operations/'+current.operation_id);panel.innerHTML=inboundReceipt(operation.result);form.querySelectorAll('input,select,button').forEach(x=>x.disabled=true);return;}
    if(!current.preview){panel.innerHTML=`<div class="state warning"><strong>草稿已保存，尚待补齐</strong><p>${esc(current.missing_fields.map(inboundMissing).join('、'))}</p><p>尚未产生入库或可执行确认。</p></div>`;if(current.missing_fields.some(x=>x.startsWith('occurred.t0')||x==='occurred.boundary_note'))$('#boundary-input').open=true;return;}
    const bound=current;
    panel.innerHTML=`<div class="state">入库草稿第${bound.version}版 · 尚未提交</div><h3>${esc(state.warehouses.find(x=>x.id===bound.parameters.warehouse_id)?.name)} · ${esc(state.models.find(x=>x.id===bound.parameters.model_id)?.name)}</h3>${inboundImpact(bound.preview)}<p class="muted">发生：${occurredText(bound.parameters.occurred)}<br>核对时库存版本：${bound.target_versions.account}</p><form id="inbound-confirm">${check('我已核对本次到货、发生时间和以上库存变化。')}<button class="primary">确认登记入库</button></form><div class="actions"><button id="inbound-verify" type="button">按原操作核验结果</button></div>`;
    $('#inbound-verify').onclick=async()=>{try{const operation=await api('/operations/'+bound.operation_id);if(!form.isConnected)return;if(operation.state==='succeeded'){current.state='succeeded';await show();}else{notify(operation.state==='pending'?'原操作尚无已提交回执，仍待确认。':'操作已失效，请重新保存并核对。');if(operation.state==='pending')$('#inbound-confirm button').disabled=false;}}catch(error){notify(error.message);}};
    $('#inbound-confirm').onsubmit=async event=>{event.preventDefault();if(dirty)return notify('资料已修改，请先重新预览。');const button=event.target.querySelector('button');button.disabled=true;try{const receipt=await FormState.freezeWhile(form,()=>api('/operations/'+bound.operation_id+'/confirm','POST',{draft_id:bound.id,draft_version:bound.version,parameters:bound.parameters}));if(!form.isConnected)return;current.state='succeeded';panel.innerHTML=inboundReceipt(receipt);form.querySelectorAll('input,select,button').forEach(x=>x.disabled=true);}catch(error){notify(error.message);button.disabled=true;}};
  }
  form.onsubmit=async event=>{event.preventDefault();const body={parameters:inboundParameters(form,originalAt)};try{const saved=await FormState.freezeWhile(form,()=>current?api('/drafts/'+current.id,'PATCH',{...body,expected_version:current.version}):api('/drafts','POST',{...body,kind:'inventory_inbound'}));if(!form.isConnected)return;current=saved;history.replaceState(null,'','#inbound?draft='+current.id);dirty=false;await show();}catch(error){notify(error.message);}};
  await show();
}
async function pendingPage(){
  await loadCatalog();const rows=await api('/drafts');
  shell('待核对','仅显示本账号当前有权限处理的未完成草稿',`<section class="panel"><h2>未完成草稿 · ${rows.length}项</h2>${rows.length?rows.map(row=>`<article class="row"><div><h3>${row.kind==='inventory_inbound'?'入库登记':'期初建账'} · 第${row.version}版</h3><p>${esc(state.warehouses.find(x=>x.id===row.parameters.warehouse_id)?.name||'库房待补')} · ${esc(state.models.find(x=>x.id===row.parameters.model_id)?.name||'型号待补')}</p><span class="badge">${row.state==='missing'?'待补信息':'待人工确认'}</span></div><a class="button" href="#${row.kind==='inventory_inbound'?'inbound':'opening'}?draft=${row.id}">继续核对</a></article>`).join(''):'<div class="state">当前没有待处理草稿。已提交的库存事实不会因退出或关闭页面消失。</div>'}</section>`,'',true);
}
if(typeof module!=='undefined')module.exports={inboundParameters,localInboundTime};
