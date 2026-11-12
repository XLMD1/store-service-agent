'use strict';
function warehouseCandidates(rows,input){
  const name=input.trim().toLocaleLowerCase();
  if(!name)return [];
  const exact=rows.filter(row=>row.name.toLocaleLowerCase()===name);
  return exact.length?exact:rows.filter(row=>row.name.toLocaleLowerCase().includes(name));
}
function inventoryResults(result){
  const {warehouse,totals,items}=result,opened=items.filter(row=>row.status==='opened'),unknown=items.filter(row=>row.status!=='opened');
  const modelCard=row=>`<article class="stock-card"><div class="section-head"><h3>${esc(row.model.name)}</h3><span class="badge">已建账${row.model.enabled?'':' · 型号停用'}</span></div>${metrics(row)}<div class="actions"><a class="button" href="#ledger?warehouse=${warehouse.id}&model=${row.model.id}">${icon('file')}查看流水</a><a class="button" href="#reservations?warehouse=${warehouse.id}&model=${row.model.id}">${icon('box')}查看预留</a></div><p class="muted section-note">建账起点：${stamp(row.t0)}</p></article>`;
  const heading=`<div class="section-head stock-heading"><h2>${esc(warehouse.name)}</h2><span class="badge">${warehouse.enabled?'启用':'库房已停用'}</span></div>`;
  const details=opened.length?`<section aria-label="分型号库存" class="grid stock-grid">${opened.map(modelCard).join('')}</section>`:'<section class="panel"><div class="state warning">本次查询没有已建账型号，库存数量尚未确认，不能按0台理解。</div></section>';
  const total=opened.length?`<section class="panel stock-total"><h2>已建账型号合计 · ${totals.opened_model_count}种</h2>${metrics(totals)}<p class="muted">仅合计本次查询中已建账的型号${unknown.length?'，其余'+unknown.length+'种未建账，不计入合计':''}。</p></section>`:'';
  const missing=unknown.length?`<section class="panel"><details class="unknown-models"><summary>${unknown.length}种型号尚未在此库房建账</summary><p class="muted">下列是已登记的型号资料；尚无该库房台账，不能据此认定库里有货或没货。</p>${unknown.map(row=>`<div class="row"><div><strong>${esc(row.model.name)}</strong><p>未建账 · 库存未知${row.model.enabled?'':' · 型号已停用'}</p></div>${canOpen()&&warehouse.enabled&&row.model.enabled?`<a class="button" href="#opening?warehouse=${warehouse.id}&model=${row.model.id}">建账</a>`:''}</div>`).join('')}</details></section>`:items.length?'':'<section class="panel"><div class="state">尚未登记型号资料，请由负责人维护后核对建账。</div></section>';
  return heading+details+total+`<p class="muted">查询截至：${stamp(result.queried_at)} · 北京时间<br>数量依据已登记记录，未建账范围不按零库存处理。</p>`+missing;
}
async function inventoryPage(){
  await loadCatalog();
  const owner=canOpen();
  let selected=null;
  const outbound=outboundEntry();
  const daily=[canInbound()?['#inbound','登记入库','新到货登记入库']:null,
    outbound?[outbound,'出库',hasPermission('inventory.outbound')&&hasPermission('reservation.pickup')?'普通出库或预留提货':hasPermission('inventory.outbound')?'从可售库存出货':'办理客户预留提货']:null,
    hasPermission('reservation.confirm')?['#movement?kind=reservation_create','办理留货','为客户新增预留']:null,
    state.user.permissions.some(x=>['inventory.inbound','inventory.outbound','reservation.confirm','reservation.cancel','reservation.pickup','inventory.opening'].includes(x))?['#pending','待核对草稿','继续未完成的操作']:null].filter(Boolean);
  shell('库存','先查库房，再按型号核对库存',`<section class="panel query-panel"><div class="section-head"><h2>查询库存</h2><span class="badge">库房、型号必选</span></div><form id="query-form" class="fields"><div class="grid query-fields"><div class="field inventory-picker"><label for="warehouse-name">库房名称</label><div class="picker-control"><input name="warehouse_name" type="text" value="" id="warehouse-name" required maxlength="100" autocomplete="off" placeholder="输入或选择库房"><button type="button" id="warehouse-toggle" aria-label="选择库房" title="选择库房" aria-expanded="false" aria-controls="warehouse-choices"><span class="picker-toggle-label">选择库房</span>${icon('chevron')}</button></div><div id="warehouse-choices" class="picker-choices" role="region" aria-label="库房选项" hidden></div></div><div class="field inventory-picker"><label for="model-name">型号</label><div class="picker-control"><input name="model_name" type="text" value="" id="model-name" required maxlength="100" autocomplete="off" placeholder="输入或选择型号"><input name="model_id" type="hidden" value=""><button type="button" id="model-toggle" aria-label="选择型号" title="选择型号" aria-expanded="false" aria-controls="model-choices"><span class="picker-toggle-label">选择型号</span>${icon('chevron')}</button></div><div id="model-choices" class="picker-choices" role="region" aria-label="型号选项" hidden></div></div><button class="primary">${icon('search')}查询库存</button></div><p class="muted">库房、型号均可输入名称或展开列表选择，支持全部型号。</p></form><nav class="query-links" aria-label="库存查询入口"><a href="#reservations">预留查询</a><a href="#ledger">库存流水</a><a href="#statistics">进货统计</a></nav></section><div id="balance" class="stock-results" aria-live="polite"><section class="panel"><div class="state">请填写库房名称并选择型号，点击“查询库存”后显示结果。</div></section></div>${daily.length?`<section class="panel"><h2>日常办理</h2><nav class="operation-grid" aria-label="库存办理">${daily.map(([href,title,hint])=>`<a class="operation-link" href="${href}"><strong>${title}</strong><small>${hint}</small></a>`).join('')}</nav><p class="muted section-note">已有留货的客户提货或取消，请先到<a href="#reservations">预留查询</a>选定具体记录。</p></section>`:''}${owner||hasPermission('reservation.confirm')?`<section class="panel settings-panel"><details><summary>基础设置</summary><nav class="actions" aria-label="库存设置">${hasPermission('reservation.confirm')?'<a class="button" href="#customers">客户资料</a>':''}${owner?'<a class="button" href="#catalog">库房与型号</a><a class="button" href="#opening">期初建账</a><a class="button" href="#correction">原单更正</a><a class="button" href="#correction?kind=inventory_adjustment">盘点调整</a><a class="button" href="#reconciliation">库存对账</a>':''}</nav><p class="muted section-note">一个库房可以存放多个型号，每个库房与型号分别核对一次建账起点。</p></details></section>`:''}`);
  const form=$('#query-form'),panel=$('#balance'),choices=$('#warehouse-choices'),toggle=$('#warehouse-toggle'),modelChoices=$('#model-choices'),modelToggle=$('#model-toggle');
  const modelRows=[{id:'all',name:'全部型号'},...state.models];
  const closeModels=()=>{modelChoices.hidden=true;modelToggle.setAttribute('aria-expanded','false');};
  const closeChoices=()=>{choices.hidden=true;toggle.setAttribute('aria-expanded','false');};
  const showChoices=rows=>{
    closeModels();choices.hidden=false;toggle.setAttribute('aria-expanded','true');
    choices.innerHTML=rows.length?`<p class="muted">选择库房后，点击“查询库存”。</p><div class="candidate-list">${rows.map(row=>`<button type="button" data-warehouse="${row.id}">${esc(row.name)}${row.enabled===false?'（已停用）':''}${state.warehouses.filter(other=>other.name===row.name).length>1?' · 区分编号 '+esc(row.code):''}</button>`).join('')}</div>`:'<div class="state warning">没有匹配的库房，请核对名称或由负责人先登记库房。</div>';
    choices.querySelectorAll('[data-warehouse]').forEach(button=>button.onclick=()=>{selected=rows.find(row=>row.id===button.dataset.warehouse);form.elements.warehouse_name.value=selected.name;closeChoices();panel.innerHTML='<section class="panel"><div class="state">库房已选定，请点击“查询库存”。</div></section>';toggle.focus();});
  };
  const showModels=rows=>{
    closeChoices();modelChoices.hidden=false;modelToggle.setAttribute('aria-expanded','true');
    modelChoices.innerHTML=rows.length?`<p class="muted">选择型号后，点击“查询库存”。</p><div class="candidate-list">${rows.map(row=>`<button type="button" data-model="${row.id}">${esc(row.name)}${row.enabled===false?'（已停用）':''}${modelRows.filter(other=>other.name===row.name).length>1?' · 编号 '+esc(row.id):''}</button>`).join('')}</div>`:'<div class="state warning">没有匹配的型号，请核对名称或从完整列表选择。</div>';
    modelChoices.querySelectorAll('[data-model]').forEach(button=>button.onclick=()=>{const row=modelRows.find(row=>row.id===button.dataset.model);form.elements.model_name.value=row.name;form.elements.model_id.value=row.id;closeModels();panel.innerHTML='<section class="panel"><div class="state">型号已选定，请点击“查询库存”。</div></section>';modelToggle.focus();});
  };
  toggle.onclick=()=>choices.hidden?showChoices(state.warehouses):closeChoices();
  modelToggle.onclick=()=>modelChoices.hidden?showModels(modelRows):closeModels();
  form.addEventListener('keydown',event=>{if(event.key==='Escape'){if(!choices.hidden){closeChoices();toggle.focus();}else if(!modelChoices.hidden){closeModels();modelToggle.focus();}}});
  form.addEventListener('input',event=>{if(form.elements.warehouse_name.value.trim()!==selected?.name)selected=null;if(event.target===form.elements.model_name)form.elements.model_id.value='';closeChoices();closeModels();panel.innerHTML='<section class="panel"><div class="state">查询条件已修改，请重新查询。</div></section>';});
  form.onsubmit=async event=>{
    event.preventDefault();const name=form.elements.warehouse_name.value.trim();
    let modelId=form.elements.model_id.value;
    if(!name)return notify('请填写库房名称。');
    if(!modelId){
      const modelName=form.elements.model_name.value.trim();
      if(!modelName)return notify('请选择型号或“全部型号”后再查询。');
      const matches=warehouseCandidates(modelRows,modelName);
      if(matches.length===1&&matches[0].name.toLocaleLowerCase()===modelName.toLocaleLowerCase()){modelId=matches[0].id;form.elements.model_id.value=modelId;}
      else{showModels(matches);return;}
    }
    if(!selected){
      const matches=warehouseCandidates(state.warehouses,name);
      if(matches.length===1&&matches[0].name.toLocaleLowerCase()===name.toLocaleLowerCase())selected=matches[0];
      else{showChoices(matches);return;}
    }
    closeChoices();closeModels();
    const params=new URLSearchParams({warehouse_id:selected.id});
    if(modelId!=='all')params.set('model_id',modelId);
    try{const result=await FormState.freezeWhile(form,()=>api('/inventory/overview?'+params));if(form.isConnected)panel.innerHTML=inventoryResults(result);}catch(error){if(form.isConnected)notify(error.message);}
  };
}
if(typeof module!=='undefined')module.exports={warehouseCandidates};
