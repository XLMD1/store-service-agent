'use strict';

const feeStatuses={assigned:'待申报',review:'待核对',payable:'待付',deducted:'已扣',paid:'已付'};
const feeKinds={installation:'安装',repair:'维修'};
const feeEvents={report:'提交申报',approve:'确认应付',deducted:'登记已扣',paid:'登记已付',
  reopen:'更正为待付',correct_amount:'更正应付金额',backfill:'补录旧单'};
const feePath='/work-fees';
const feeMoney=cents=>cents==null?'—':`¥${(cents/100).toFixed(2)}`;
const feeDetailLink=id=>'#work-fee?id='+encodeURIComponent(id);

function feeCents(value){
  if(value==='')return null;
  if(!/^\d{1,7}(\.\d{1,2})?$/.test(value))throw new Error('请输入有效金额，最多保留两位小数。');
  const [yuan,fraction='']=value.split('.');
  return Number(yuan)*100+Number(fraction.padEnd(2,'0'));
}

function feeMoneyField(label,name,value='',required=false){
  return field(label,name,value,`inputmode="decimal" maxlength="10" ${required?'required':''}`);
}

function feeSelect(label,name,entries,blank){
  return `<label class="field"><span>${label}</span><select name="${name}" ${blank?'':'required'}>
    ${blank?`<option value="">${blank}</option>`:''}
    ${entries.map(([value,text])=>`<option value="${esc(value)}">${esc(text)}</option>`).join('')}
  </select></label>`;
}

function workFields(schedule){
  return `${feeSelect('工作类型','kind',Object.entries(feeKinds))}
    ${field('地点','location','','required maxlength="500"')}
    ${field(schedule?'安排内容':'做了什么','description','','required maxlength="2000"')}
    ${schedule?field('安排日期','scheduled_on','','required','date'):''}
    <details><summary>关联单据（可选）</summary>
      ${field('售后档案编号','service_record_id','','maxlength="36"')}
      ${field('原单号','reference','','maxlength="100"')}
    </details>`;
}

function workPayload(form){
  const values=new FormData(form);
  return Object.fromEntries(['kind','location','description','scheduled_on','service_record_id','reference']
    .map(name=>[name,values.get(name)?.trim()||null]));
}

function feeItemFields(item={}){
  return `<div class="reservation" data-fee-item>
    ${field('工费项目','item_name',item.name||'','required maxlength="100"')}
    <div class="grid two">${field('数量','item_quantity',item.quantity??1,'required min="1" max="10000" step="1"','number')}
    ${feeMoneyField('本项申报金额（元）','item_amount',item.amount_cents==null?'':(item.amount_cents/100).toFixed(2),true)}</div>
    <button type="button" data-remove-fee-item>移除本项</button>
  </div>`;
}

function reportFields(report){
  const items=report?.items||[{}];
  return `${field('实际工作日期','worked_on',report?.worked_on||'','required','date')}
    ${field('实际情况','result',report?.result||'','required maxlength="2000"')}
    <div><h3>工费明细</h3><div data-fee-items>${items.map(feeItemFields).join('')}</div>
      <button type="button" data-add-fee-item>添加工费项目</button></div>
    ${feeMoneyField('已自行扣过的金额（元，可选）','reported_deduction',
      report?.reported_deduction_cents==null?'':(report.reported_deduction_cents/100).toFixed(2))}`;
}

function bindFeeItems(form){
  const list=form.querySelector('[data-fee-items]');
  if(!list)return;
  const add=form.querySelector('[data-add-fee-item]');
  const refresh=()=>{
    const remove=[...list.querySelectorAll('[data-remove-fee-item]')];
    remove.forEach(button=>{button.hidden=remove.length===1;});
    add.disabled=remove.length>=20;
  };
  list.onclick=event=>{
    if(!event.target.matches('[data-remove-fee-item]')||list.children.length<2)return;
    event.target.closest('[data-fee-item]').remove();
    refresh();
    add.focus();
  };
  add.onclick=()=>{
    if(list.children.length>=20)return;
    list.insertAdjacentHTML('beforeend',feeItemFields());
    refresh();
    list.lastElementChild.querySelector('input').focus();
  };
  refresh();
}

function reportPayload(form){
  return {
    worked_on:form.elements.worked_on.value,result:form.elements.result.value.trim(),
    reported_deduction_cents:feeCents(form.elements.reported_deduction.value.trim()),
    items:[...form.querySelectorAll('[data-fee-item]')].map(row=>({
      name:row.querySelector('[name=item_name]').value.trim(),
      quantity:Number(row.querySelector('[name=item_quantity]').value),
      amount_cents:feeCents(row.querySelector('[name=item_amount]').value.trim()),
    })),
  };
}

function bindFeeWrite(form,path,method,identifier,body,onSaved){
  if(!form)return;
  const route=location.hash;
  let previous, requestId;
  form.onsubmit=async event=>{
    event.preventDefault();
    if(route!==location.hash)return;
    try{
      const data=body();
      if(identifier){
        const fingerprint=JSON.stringify(data);
        if(fingerprint!==previous){previous=fingerprint;requestId=crypto.randomUUID();}
        data[identifier]=requestId;
      }
      const result=await FormState.freezeWhile(form,()=>api(path,method,data));
      if(form.isConnected&&route===location.hash)await onSaved(result);
    }catch(error){
      if(!form.isConnected||route!==location.hash)return;
      notify(error.status===409?'这笔记录已变化。请核对当前状态后再操作。':
        error.status===422?'请核对日期、金额、人员及必填说明。':error.message);
    }
  };
}

function feeSettlementFields(){
  return `<div data-fee-settlement>
    ${field('实际结算日期','occurred_on','','','date')}
    ${field('付款或扣款依据','note','','maxlength="2000"')}
    <div data-fee-collection>${feeMoneyField('代收金额（元，可选）','collected')}
      ${feeMoneyField('交回金额（元，可选）','returned')}</div>
  </div>`;
}

function syncFeeSettlement(form,action){
  const settled=['paid','deducted'].includes(action);
  form.querySelector('[data-fee-settlement]').hidden=!settled;
  form.querySelector('[data-fee-collection]').hidden=action!=='deducted';
  form.elements.occurred_on.required=settled;
  form.elements.note.required=settled;
}

function feeSettlementPayload(form,action){
  const fields=form.elements;
  const result={action,occurred_on:fields.occurred_on.value,note:fields.note.value.trim()};
  if(action==='deducted'){
    result.collected_cents=feeCents(fields.collected.value.trim());
    result.returned_cents=feeCents(fields.returned.value.trim());
  }
  return result;
}

function feeBackfillFields(entries){
  return `<section class="panel"><details><summary>补录已核对的旧单</summary>
    <form id="fee-backfill" class="fields">
      ${feeSelect('师傅','worker_id',entries,'请选择师傅')}
      ${field('本次补录起始日','cutoff_on','','required','date')}
      ${workFields(false)}${reportFields(null)}
      ${feeMoneyField('核实应付金额（元）','amount','',true)}
      ${field('补录核对依据','reason','','required maxlength="2000"')}
      ${feeSelect('核实后的状态','action',[['payable','待付'],['deducted','已扣'],['paid','已付']])}
      ${feeSettlementFields()}
      ${check('我已核对补录范围、应付金额和结算情况。')}
      <button class="primary" type="submit">确认补录</button>
    </form></details></section>`;
}

async function workFeesPage(){
  const route=location.hash;
  const manager=hasPermission('work_fee.manage'), worker=hasPermission('work_fee.report');
  if(!manager&&!worker)throw new Error('当前账号无权查看工费。');
  const workers=manager?(await api(feePath+'/workers')).items:[];
  if(route!==location.hash)return;
  const entries=workers.map(item=>[item.id,item.name]);
  shell('工费台账',manager?'核对每位师傅的申报和结算记录':'查看本人工作和工费',`<section class="panel">
    <form class="fields" id="fee-query">
      ${manager?feeSelect('师傅','worker_id',entries,'全部师傅'):''}
      <div class="grid two">${field('工作日期从','from_on','','','date')}${field('到','to_on','','','date')}</div>
      ${feeSelect('结算状态','state',Object.entries(feeStatuses),'全部状态')}
      <button class="primary" type="submit">查询工费</button>
    </form>
    <div id="fee-results" class="section-note" aria-live="polite"></div>
  </section>
  ${manager?`<section class="panel">
    ${hasPermission('account.manage')?'<div class="actions"><a class="button" href="#technicians">管理师傅账号</a></div>':''}
    <details><summary>安排工作</summary>
    ${workers.length?`<form id="fee-job-form" class="fields">
      ${workFields(true)}
      <fieldset><legend>参加的师傅</legend>
      ${workers.map(item=>`<label class="check"><input type="checkbox" name="worker_ids" value="${esc(item.id)}">${esc(item.name)}</label>`).join('')}
      </fieldset>
      ${check('我已核对安排日期、地点及人员。')}
      <button class="primary" type="submit">确认安排</button></form>`:'<p>目前没有可安排的师傅账号。</p>'}</details></section>`:''}
  ${manager&&workers.length?feeBackfillFields(entries):''}
  ${worker?`<section class="panel"><details><summary>补报口头安排的工作</summary>
    <form id="fee-new-report" class="fields">${workFields(false)}${reportFields(null)}
      <button class="primary" type="submit">提交申报</button></form>
    </details></section>`:''}`,'',true);
  const query=$('#fee-query'), results=$('#fee-results');
  async function load(criteria,offset=0){
    const params=new URLSearchParams({...criteria,offset});
    results.textContent='正在读取…';
    try{
      const data=await FormState.freezeWhile(query,()=>api(feePath+'?'+params));
      if(!query.isConnected)return;
      results.innerHTML=`<dl class="metrics fee-totals">${['payable','deducted','paid'].map(key=>
        `<div><dt>${feeStatuses[key]}</dt><dd>${feeMoney(data.totals[key])}</dd></div>`).join('')}</dl>
        ${data.items.map(row=>`<article class="row"><div><h3>${feeKinds[row.work.kind]} · ${esc(row.work.description)}</h3>
          <p>${esc(row.worker_name)} · ${esc(row.worked_on||row.work.scheduled_on||'日期待登记')} · ${esc(row.work.location)}</p>
          <p><span class="badge">${feeStatuses[row.state]}</span>
          ${row.confirmed_cents==null?(row.claimed_cents==null?'':'申报 '+feeMoney(row.claimed_cents)):'应付 '+feeMoney(row.confirmed_cents)}</p>
        </div><a class="button" href="${feeDetailLink(row.id)}">查看</a></article>`).join('')||'<p class="state">当前条件下没有工费记录。</p>'}
        <div class="actions">${offset?'<button type="button" data-fee-previous>上一页</button>':''}
        ${data.next_offset!=null?'<button type="button" data-fee-next>下一页</button>':''}</div>`;
      const previous=results.querySelector('[data-fee-previous]'),next=results.querySelector('[data-fee-next]');
      if(previous)previous.onclick=()=>load(criteria,Math.max(0,offset-50));
      if(next)next.onclick=()=>load(criteria,data.next_offset);
    }catch(error){if(query.isConnected)results.textContent=error.message;}
  }
  query.onsubmit=event=>{
    event.preventDefault();
    load(Object.fromEntries([...new FormData(query)].filter(([,value])=>value)));
  };
  const job=$('#fee-job-form');
  bindFeeWrite(job,feePath+'/jobs','POST','request_id',()=>{
    const ids=new FormData(job).getAll('worker_ids');
    if(!ids.length)throw new Error('请选择至少一位师傅。');
    return {work:workPayload(job),worker_ids:ids,confirmed:job.elements.confirmed.checked};
  },result=>{location.hash=feeDetailLink(result.fees[0].id);});
  const report=$('#fee-new-report');
  if(report){
    bindFeeItems(report);
    bindFeeWrite(report,feePath+'/reports','POST','request_id',
      ()=>({work:workPayload(report),report:reportPayload(report)}),
      result=>{location.hash=feeDetailLink(result.id);});
  }
  const backfill=$('#fee-backfill');
  if(backfill){
    bindFeeItems(backfill);
    const action=backfill.elements.action;
    action.onchange=()=>syncFeeSettlement(backfill,action.value);
    action.onchange();
    bindFeeWrite(backfill,feePath+'/backfill','POST','request_id',()=>{
      const fields=backfill.elements;
      if(!fields.worker_id.value)throw new Error('请选择师傅。');
      return {
        worker_id:fields.worker_id.value,cutoff_on:fields.cutoff_on.value,work:workPayload(backfill),
        report:reportPayload(backfill),amount_cents:feeCents(fields.amount.value.trim()),
        reason:fields.reason.value.trim(),confirmed:fields.confirmed.checked,
        settlement:action.value==='payable'?null:feeSettlementPayload(backfill,action.value),
      };
    },result=>{location.hash=feeDetailLink(result.id);});
  }
  await load({});
}

function feeDecisionFields(row){
  if(row.state==='assigned')return '';
  const settled=['deducted','paid'].includes(row.state);
  const amount=row.confirmed_cents??row.claimed_cents;
  return `<section class="panel"><h2>${row.state==='review'?'核对应付':'登记结算或更正'}</h2>
    <form id="fee-decision" class="fields">
      ${row.state==='payable'?feeSelect('操作','action',[
        ...(amount>0?[['paid','门店已付'],['deducted','已从代收款扣除']]:[]),
        ['correct_amount','更正确认金额']]):`<input type="hidden" name="action" value="${settled?'reopen':'approve'}">`}
      <div data-fee-decision-amount>${feeMoneyField('确认金额（元）','amount',(amount/100).toFixed(2))}</div>
      ${feeSettlementFields()}
      <div data-fee-decision-reason>${field('调整或更正原因','reason','','maxlength="2000"')}</div>
      ${check('我已核对金额和实际结算情况。')}
      <button class="primary" type="submit">确认保存</button>
    </form></section>`;
}

function bindFeeDecision(form,row){
  if(!form)return;
  const controls={
    amount:form.querySelector('[data-fee-decision-amount]'),
    settlement:form.querySelector('[data-fee-settlement]'),
    reason:form.querySelector('[data-fee-decision-reason]'),
  };
  const sync=()=>{
    const action=form.elements.action.value;
    syncFeeSettlement(form,action);
    controls.amount.hidden=!['approve','correct_amount'].includes(action);
    controls.reason.hidden=!controls.settlement.hidden;
    form.elements.amount.required=!controls.amount.hidden;
    form.elements.reason.required=['correct_amount','reopen'].includes(action);
  };
  form.elements.action.onchange=sync;
  sync();
  bindFeeWrite(form,feePath+'/'+encodeURIComponent(row.id)+'/decisions','POST','operation_id',()=>{
    const fields=form.elements, action=fields.action.value;
    const decision=controls.settlement.hidden?{action}:feeSettlementPayload(form,action);
    if(!controls.amount.hidden)decision.amount_cents=feeCents(fields.amount.value.trim());
    if(!controls.reason.hidden)decision.reason=fields.reason.value.trim()||null;
    return {version:row.version,confirmed:fields.confirmed.checked,decision};
  },()=>render());
}

async function technicianAccountsPage(){
  if(!hasPermission('account.manage'))throw new Error('只有负责人可以管理师傅账号。');
  const route=location.hash;
  const {items}=await api('/accounts/technicians');
  if(route!==location.hash)return;
  shell('师傅账号','账号启用后可登录，并出现在安排工作的师傅列表里',`<div class="grid opening-grid">
    <section class="panel"><h2>创建维修师傅账号</h2>
      <form id="technician-create" class="fields">
        ${field('登录账号','username','','required maxlength="64" pattern="[a-zA-Z0-9_.\\-]+" autocomplete="off" aria-describedby="technician-username-help"')}
        <p class="muted" id="technician-username-help">使用英文字母、数字、点、下划线或短横线。</p>
        ${field('初始密码','password','','required minlength="12" maxlength="256" autocomplete="new-password" aria-describedby="technician-password-help"','password')}
        <p class="muted" id="technician-password-help">至少 12 个字符。</p>
        ${check('我已核对账号，并确认授予维修师傅角色。')}
        <button type="submit" class="primary">创建师傅账号</button>
      </form>
    </section>
    <section class="panel"><h2>现有师傅</h2>
      ${items.map(item=>`<details><summary>${esc(item.username)} <span class="badge">${item.enabled?'已启用':'已停用'}</span></summary>
        <form class="fields" data-technician-id="${esc(item.id)}">
          ${check(item.enabled?'我确认停用此账号。师傅将退出当前会话。':'我确认启用此账号。')}
          <button type="submit">${item.enabled?'确认停用':'确认启用'}</button>
        </form></details>`).join('')||'<p class="state">还没有师傅账号。</p>'}
    </section></div>`,'',true);
  const create=$('#technician-create');
  const save=async(form,path,method,body,success)=>{
    try{
      await FormState.freezeWhile(form,()=>api(path,method,body));
      if(route===location.hash&&form.isConnected){
        form.reset();
        await render();
        if(route===location.hash)notify(success);
      }
    }catch(error){
      if(route!==location.hash||!form.isConnected)return;
      if(method==='POST')form.elements.password.value='';
      notify(error.status===409&&method==='POST'?'该登录账号已存在，请核对现有师傅列表。':error.message);
    }
  };
  create.onsubmit=event=>{
    event.preventDefault();
    const {username,password,confirmed}=create.elements;
    save(create,'/accounts','POST',{username:username.value,password:password.value,
      roles:['technician'],confirmed:confirmed.checked},'师傅账号已创建。');
  };
  document.querySelectorAll('[data-technician-id]').forEach(form=>{
    const item=items.find(row=>row.id===form.dataset.technicianId);
    form.onsubmit=event=>{
      event.preventDefault();
      save(form,'/accounts/'+encodeURIComponent(item.id),'PATCH',
        {enabled:!item.enabled,confirmed:form.elements.confirmed.checked},item.enabled?'师傅账号已停用。':'师傅账号已启用。');
    };
  });
}

async function workFeePage(params){
  const route=location.hash, id=params.get('id');
  const manager=hasPermission('work_fee.manage'), worker=hasPermission('work_fee.report');
  if(!id||(!manager&&!worker))throw new Error('请从工费台账选择一笔记录。');
  const [row,workers]=await Promise.all([api(feePath+'/'+encodeURIComponent(id)),
    manager?api(feePath+'/workers'):null]);
  if(route!==location.hash)return;
  const editable=worker&&row.worker_id===state.user.id&&['assigned','review'].includes(row.state);
  const history=row.events.slice().reverse().map(event=>`<article class="row"><div>
    <h3>${feeEvents[event.decision.action]}</h3><p>${stamp(event.occurred_at)} · ${feeStatuses[event.before.state]} → ${feeStatuses[event.after.state]}</p>
    <p>${feeMoney(event.before.confirmed_cents)} → ${feeMoney(event.after.confirmed_cents)}</p>
    ${event.after.settlement?`<p>实际结算 ${esc(event.after.settlement.occurred_on)} · ${feeMoney(event.after.settlement.amount_cents)}</p>`:''}
    ${event.decision.reason||event.decision.note?`<p>${esc(event.decision.reason||event.decision.note)}</p>`:''}
    ${event.decision.action==='backfill'&&event.after.settlement?`<p>${esc(event.after.settlement.note)}</p>`:''}
  </div></article>`).join('');
  const settlement=row.settlement;
  shell('工费明细',esc(feeKinds[row.work.kind]+' · '+row.worker_name),`<section class="panel">
    <h2>${esc(row.work.description)}</h2>
    <p>${esc(row.work.location)}</p>
    <p class="muted">工作日期 ${esc(row.worked_on||'待登记')}${row.work.scheduled_on?' · 安排 '+esc(row.work.scheduled_on):''}</p>
    ${row.work.reference?`<p class="muted">原单 ${esc(row.work.reference)}</p>`:''}
    ${row.work.service_record_id?`<p class="muted receipt-id">售后档案 ${esc(row.work.service_record_id)}</p>`:''}
    ${row.work.backfill_from?`<p class="muted">补录起始日 ${esc(row.work.backfill_from)}</p>`:''}
    <p class="section-note"><span class="badge">${feeStatuses[row.state]}</span> 申报 ${feeMoney(row.claimed_cents)} · 应付 ${feeMoney(row.confirmed_cents)}</p>
    ${row.report?`<h3 class="section-note">实际工作</h3><p>${esc(row.report.result)}</p><ul>
      ${row.report.items.map(item=>`<li>${esc(item.name)} × ${esc(item.quantity)} · ${feeMoney(item.amount_cents)}</li>`).join('')}</ul>
      ${row.report.reported_deduction_cents==null?'':`<p>师傅申报已扣 ${feeMoney(row.report.reported_deduction_cents)}</p>`}`:''}
    ${settlement?`<div class="state success">${feeStatuses[row.state]} ${feeMoney(settlement.amount_cents)} · ${esc(settlement.occurred_on)}
      <p>${esc(settlement.note)}</p>
      ${settlement.collected_cents==null?'':`<p>代收 ${feeMoney(settlement.collected_cents)}</p>`}
      ${settlement.returned_cents==null?'':`<p>交回 ${feeMoney(settlement.returned_cents)}</p>`}</div>`:''}
  </section>
  ${editable?`<section class="panel"><h2>填报实际工作</h2><form id="fee-report-edit" class="fields">
    ${reportFields(row.report)}<button class="primary" type="submit">提交申报</button>
    </form></section>`:''}
  ${manager?feeDecisionFields(row):''}
  ${manager&&workers.items.length&&!row.work.backfill_from?`<section class="panel"><details><summary>添加同单师傅</summary>
    <form id="fee-add-worker" class="fields">${feeSelect('师傅','worker_id',workers.items.map(item=>[item.id,item.name]))}
      ${check('我已核对此人参加同一项工作。')}<button type="submit">确认添加</button>
    </form></details></section>`:''}
  ${history?`<section class="panel"><h2>核对与结算记录</h2>${history}</section>`:''}`,
  manager?'<button type="button" id="fee-refresh">刷新记录</button>':'',true);
  const report=$('#fee-report-edit'), add=$('#fee-add-worker');
  const refresh=$('#fee-refresh');
  if(refresh)refresh.onclick=render;
  if(report){
    bindFeeItems(report);
    bindFeeWrite(report,feePath+'/'+encodeURIComponent(id)+'/report','PUT','operation_id',
      ()=>({version:row.version,report:reportPayload(report)}),()=>render());
  }
  bindFeeDecision($('#fee-decision'),row);
  bindFeeWrite(add,feePath+'/jobs/'+encodeURIComponent(row.work.id)+'/workers','POST',null,
    ()=>({worker_id:add.elements.worker_id.value,confirmed:add.elements.confirmed.checked}),
    result=>{location.hash=feeDetailLink(result.id);});
}
