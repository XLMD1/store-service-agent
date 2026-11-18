'use strict';
const agentStates={processing:'处理中',missing:'待补信息',awaiting_confirmation:'待人工确认',awaiting_verification:'待结果核验',completed:'已完成',failed:'暂未完成',cancelled:'已取消未提交部分'};
const agentActions={query_inventory:'库存查询',query_reservations:'预留查询',query_statistics:'进货统计',query_ledger:'库存流水',inventory_opening:'期初建账',inventory_inbound:'入库登记',inventory_outbound:'普通出库',reservation_create:'办理留货',reservation_pickup:'预留提货',reservation_cancel:'取消留货',inventory_adjustment:'盘点调整',inventory_correction:'原单数量更正'};
let agentPageVersion=0;
const agentRuns=new Set();

async function runAgentTask(id,payload){
  if(agentRuns.has(id))return;
  const route='#task?id='+id;
  const updateThinking=visible=>{
    const thinking=$('#agent-thinking');
    if(thinking?.dataset.taskId===id)thinking.hidden=!visible;
  };
  agentRuns.add(id);
  updateThinking(true);
  try{
    await api('/agent/tasks/'+id+'/run','POST',payload);
  }catch(error){
    if(location.hash===route)notify('任务已保存，处理结果需要核验。'+error.message);
  }finally{
    agentRuns.delete(id);
  }
  if(location.hash!==route)return;
  try{
    await agentTaskPage(new URLSearchParams({id}));
  }finally{
    updateThinking(false);
  }
}
function agentDeleteButton(task){
  return `<button type="button" data-delete-agent-task="${esc(task.id)}" data-version="${task.version}">删除任务</button>`;
}
function bindAgentDeletes(root,onDeleted){
  root.querySelectorAll('[data-delete-agent-task]').forEach(button=>button.onclick=async()=>{
    if(!confirm('删除这项库存任务及其未提交草稿？已登记的库存和回执会保留。'))return;
    button.disabled=true;
    try{
      await api('/agent/tasks/'+encodeURIComponent(button.dataset.deleteAgentTask)+'?expected_version='+button.dataset.version,'DELETE');
      if(button.isConnected)await onDeleted();
    }catch(error){if(button.isConnected){button.disabled=false;notify(error.message);}}
  });
}
function agentTaskRows(tasks,{empty='尚无库存任务。',canDelete=true}={}){
  return tasks.map(task=>{
    const service=task.kind==='service';
    const status={needs_choice:'待选择档案',draft_saved:'草稿待核对'}[task.state]||agentStates[task.state]||'状态待核验';
    const kind=task.kind?(service?'售后 · ':'库存 · '):'';
    const href=service?serviceTaskHref(task.id):'#task?id='+encodeURIComponent(task.id);
    return `<article class="row"><div><h3>${esc(task.text.length>70?task.text.slice(0,70)+'…':task.text)}</h3>
      <p>${kind}${esc(status)} · ${stamp(task.updated_at||task.created_at)}</p>
      ${task.items?.length?`<p>已完成 ${task.items.filter(item=>item.state==='completed').length} / ${task.items.length} 项</p>`:''}</div>
      <div class="actions"><a class="button" href="${href}">查看任务</a>${canDelete&&!service?agentDeleteButton(task):''}</div></article>`;
  }).join('')||`<p class="muted">${esc(empty)}</p>`;
}
function agentDateKey(value){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));}
function agentMonthChange(month,offset){const [year,number]=month.split('-').map(Number);return new Date(Date.UTC(year,number-1+offset,1)).toISOString().slice(0,7);}
function agentCalendar(month,selected,tasks){
  const first=new Date(month+'-01T12:00:00Z'),padding=(first.getUTCDay()+6)%7;
  const [year,number]=month.split('-').map(Number),days=new Date(Date.UTC(year,number,0)).getUTCDate();
  const completed=tasks.filter(task=>task.state==='completed');
  const counts=new Map();for(const task of completed){const key=agentDateKey(task.created_at);counts.set(key,(counts.get(key)||0)+1);}
  const today=agentDateKey(new Date());
  return `<div class="agent-calendar-head"><div><h3>${year}年${number}月</h3><p class="muted">按创建日期 · 已完成 ${completed.length}项</p></div><div class="actions"><button type="button" id="agent-month-prev" aria-label="上个月">‹</button><button type="button" id="agent-calendar-today">今天</button><button type="button" id="agent-month-next" aria-label="下个月">›</button></div></div><div class="agent-calendar-content"><div><div class="agent-calendar-week" aria-hidden="true">${['一','二','三','四','五','六','日'].map(day=>`<span>${day}</span>`).join('')}</div><div class="agent-calendar-grid" role="group" aria-label="${year}年${number}月日期">${'<span aria-hidden="true"></span>'.repeat(padding)}${Array.from({length:days},(_,index)=>{const date=month+'-'+String(index+1).padStart(2,'0'),count=counts.get(date)||0;return `<button type="button" data-agent-date="${date}" aria-pressed="${date===selected}" ${date===today?'aria-current="date"':''} aria-label="${number}月${index+1}日，${count}项已完成"><span>${index+1}</span><small>${count?count+'项':'&nbsp;'}</small></button>`;}).join('')}</div><p class="muted agent-calendar-note">日期上只统计已完成任务。选中日期可查看当天的全部任务。</p></div><section id="agent-day-tasks" class="agent-day-tasks" aria-live="polite"></section></div>`;
}
function bindAgentCalendar(month,selected,tasks){
  const choose=date=>{
    state.agentDay=date;
    document.querySelectorAll('[data-agent-date]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.agentDate===date)));
    const rows=tasks.filter(task=>agentDateKey(task.created_at)===date),[,number,day]=date.split('-').map(Number);
    $('#agent-day-tasks').innerHTML=`<h3>${number}月${day}日 <span class="muted">已完成 ${rows.filter(task=>task.state==='completed').length}项</span></h3>${agentTaskRows(rows,{empty:'这一天没有符合条件的任务。'})}`;
    bindAgentDeletes($('#agent-day-tasks'),agentHomePage);
  };
  const change=async(next,focus)=>{state.agentMonth=next;await agentHomePage();$(focus)?.focus();};
  $('#agent-month-prev').onclick=()=>change(agentMonthChange(month,-1),'#agent-month-prev').catch(error=>notify(error.message));
  $('#agent-month-next').onclick=()=>change(agentMonthChange(month,1),'#agent-month-next').catch(error=>notify(error.message));
  $('#agent-calendar-today').onclick=()=>{const today=agentDateKey(new Date());state.agentDay=today;if(today.startsWith(month)){choose(today);$(`[data-agent-date="${today}"]`).focus();}else change(today.slice(0,7),`[data-agent-date="${today}"]`).catch(error=>notify(error.message));};
  document.querySelectorAll('[data-agent-date]').forEach(button=>{
    button.onclick=()=>choose(button.dataset.agentDate);
    button.onkeydown=async event=>{
      const offset={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[event.key];if(offset===undefined)return;
      event.preventDefault();const next=new Date(button.dataset.agentDate+'T12:00:00Z');next.setUTCDate(next.getUTCDate()+offset);
      const date=next.toISOString().slice(0,10);state.agentDay=date;
      if(date.startsWith(month)){choose(date);$(`[data-agent-date="${date}"]`).focus();}
      else try{await change(date.slice(0,7),`[data-agent-date="${date}"]`);}catch(error){notify(error.message);}
    };
  });
  choose(selected);
}
async function agentHomePage(){
  const version=++agentPageVersion,route=location.hash;
  const today=agentDateKey(new Date()),month=state.agentMonth||today.slice(0,7);
  const selected=state.agentDay?.startsWith(month)?state.agentDay:today.startsWith(month)?today:month+'-01';
  const stockAllowed=hasPermission('inventory.read'), serviceAllowed=hasPermission('service.read');
  const modes=[...(stockAllowed?['inventory']:[]),...(serviceAllowed?['service']:[])];
  const [provider,stockHistory,serviceHistory,stockPending,servicePending]=await Promise.allSettled([
    stockAllowed?api('/agent/status'):null,
    stockAllowed?api('/agent/tasks?month='+month):[],
    serviceAllowed?api(serviceTaskPath+'?month='+month):{items:[]},
    stockAllowed?api('/agent/tasks?pending_only=true'):[],
    serviceAllowed?api(serviceTaskPath+'?pending_only=true'):{items:[]}
  ]);
  if(version!==agentPageVersion||route!==location.hash)return;
  const info=provider.status==='fulfilled'?provider.value:null;
  const status=!info?'模型状态不可用':info.test_double?'模型测试模式':info.configured?'DeepSeek已配置':'DeepSeek尚未配置';
  const merge=(stock,service)=>[
    ...(stock.value||[]).map(task=>({...task,kind:'inventory'})),
    ...(service.value?.items||[]).map(task=>({...task,kind:'service'}))
  ].sort((left,right)=>Date.parse(right.created_at)-Date.parse(left.created_at)||left.id.localeCompare(right.id));
  const labels={all:'全部',inventory:'库存',service:'售后'};
  const pending=merge(stockPending,servicePending).filter(task=>!['completed','cancelled'].includes(task.state));
  const rows=merge(stockHistory,serviceHistory);
  const pendingFailed=[stockPending,servicePending].some(result=>result.status==='rejected');
  const historyFailed=[stockHistory,serviceHistory].some(result=>result.status==='rejected');
  shell('工作台','整理库存或售后事项',`<div class="service-home">
    <section class="panel material-ink service-task">
      <div class="workbench-task-heading">
        <h2>新建任务</h2>
        ${stockAllowed?`<p class="muted" id="workbench-provider">${esc(status)}
          ${hasPermission('account.manage')?' · <a href="#deepseek-settings" aria-label="DeepSeek 设置">设置</a>':''}</p>`:''}
      </div>
      <form id="agent-task-form" class="fields">
        ${modes.length>1?`<div class="workbench-modes" role="group" aria-label="任务类型">${modes.map(key=>
          `<button type="button" data-workbench-mode="${key}" aria-pressed="false">${labels[key]}</button>`).join('')}</div>`:''}
        <label class="field"><span id="workbench-task-label"></span><textarea name="text" maxlength="10000" rows="4" required></textarea></label>
        <div class="actions"><button class="primary" id="agent-start"></button></div>
        <p class="muted">正式登记前需核对并确认。</p>
      </form>
    </section>
    <aside class="panel service-pending" id="workbench-pending"><h2>待我处理</h2>
      ${pendingFailed?'<p class="state warning">有一类待办暂时无法读取。</p><button type="button" data-workbench-retry>重试</button>':''}
      ${pending.length||!pendingFailed?agentTaskRows(pending.slice(0,5),{empty:'暂无待办。',canDelete:false}):''}
      ${pending.length>5?`<details class="section-note"><summary>其余 ${pending.length-5} 项</summary>
        ${agentTaskRows(pending.slice(5),{canDelete:false})}</details>`:''}
      ${stockAllowed?'<a class="button section-note" href="#pending">查看库存待核对草稿</a>':''}
    </aside>
    <nav class="service-shortcuts" aria-label="常用功能">
      ${serviceAllowed?`<a href="#sources">${icon('file')}售后来源</a>`:''}
      ${hasPermission('knowledge.read')?`<a href="#knowledge">${icon('file')}维修资料</a>`:''}
      ${stockAllowed?`<a href="#inventory">${icon('box')}查库存</a>${canInbound()?`<a href="#inbound">${icon('plus')}登记入库</a>`:''}
      <a href="#reservations">${icon('box')}预留查询</a><a href="#statistics">${icon('file')}进货统计</a>`:''}
      ${hasPermission('work_fee.manage')||hasPermission('work_fee.report')?`<a href="#work-fees">${icon('clipboard')}工费台账</a>`:''}
    </nav>
    <section class="panel service-recent"><h2>我的任务</h2>
      ${modes.length>1?`<div class="workbench-modes" role="group" aria-label="历史任务类型">${['all',...modes].map(key=>
        `<button type="button" data-workbench-history="${key}" aria-pressed="false">${labels[key]}</button>`).join('')}</div>`:''}
      ${historyFailed?'<p class="state warning">有一类历史暂时无法读取。</p><button type="button" data-workbench-retry>重试</button>':''}
      <div id="workbench-calendar"></div>
    </section></div>`);
  function showHistory(kind){
    state.workbenchHistory=kind;
    const filtered=kind==='all'?rows:rows.filter(task=>task.kind===kind);
    const day=state.agentDay?.startsWith(month)?state.agentDay:selected;
    document.querySelectorAll('[data-workbench-history]').forEach(button=>
      button.setAttribute('aria-pressed',String(button.dataset.workbenchHistory===kind)));
    $('#workbench-calendar').innerHTML=agentCalendar(month,day,filtered);
    bindAgentCalendar(month,day,filtered);
  }
  showHistory(modes.includes(state.workbenchHistory)?state.workbenchHistory:'all');
  document.querySelectorAll('[data-workbench-history]').forEach(button=>button.onclick=()=>showHistory(button.dataset.workbenchHistory));
  document.querySelectorAll('[data-workbench-retry]').forEach(button=>button.onclick=()=>agentHomePage().catch(error=>notify(error.message)));
  const form=$('#agent-task-form'), input=form.elements.text;
  let mode=modes.includes(state.workbenchTaskMode)?state.workbenchTaskMode:modes[0];
  const inputKey=kind=>kind==='service'?'serviceWorkbenchText':'agentText';
  const saveInput=()=>{state[inputKey(mode)]=input.value;};
  const showMode=kind=>{
    mode=state.workbenchTaskMode=kind;
    const service=kind==='service';
    input.value=state[inputKey(kind)]||'';
    input.placeholder=service?'例如：查 13800000000 上次的售后记录':'例如：查一号库所有型号的库存';
    $('#workbench-task-label').textContent=labels[kind]+'任务';
    $('#agent-start').textContent='整理'+labels[kind]+'任务';
    if($('#workbench-provider'))$('#workbench-provider').hidden=service;
    form.querySelectorAll('[data-workbench-mode]').forEach(button=>
      button.setAttribute('aria-pressed',String(button.dataset.workbenchMode===kind)));
  };
  if(!mode){form.hidden=true;return;}
  showMode(mode);
  input.oninput=saveInput;
  form.querySelectorAll('[data-workbench-mode]').forEach(button=>button.onclick=()=>{
    saveInput();
    showMode(button.dataset.workbenchMode);
  });
  form.onsubmit=async event=>{
    event.preventDefault();
    const text=input.value.trim();
    if(!text)return;
    saveInput();
    const kind=mode,service=kind==='service';
    const key=service?'serviceWorkbenchRequest':'agentRequest';
    if(state[key]?.text!==text)state[key]={request_id:crypto.randomUUID(),text};
    try{
      const task=await FormState.freezeWhile(form,()=>api(service?serviceTaskPath:'/agent/tasks','POST',state[key]));
      state[key]=null;
      if(state[inputKey(kind)]?.trim()===text)state[inputKey(kind)]='';
      if(!form.isConnected)return;
      location.hash=service?serviceTaskHref(task.id):'#task?id='+encodeURIComponent(task.id);
      if(!service)await runAgentTask(task.id,{expected_version:task.version});
    }catch(error){
      if(form.isConnected)notify('尚未核实任务保存结果，请查看任务列表或按原请求重试。'+error.message);
    }
  };
}
async function agentSettingsPage(){
  if(!state.user.permissions.includes('account.manage'))throw new Error('只有负责人可管理DeepSeek密钥。');
  const route=location.hash,info=await api('/agent/settings');if(route!==location.hash)return;
  const status=!info.readable?'本机配置无法读取，请重新保存':info.configured?'DeepSeek密钥已配置':'DeepSeek尚未配置';
  shell('DeepSeek设置','由负责人管理本机服务使用的模型密钥',`<div class="grid agent-settings"><section class="panel"><h2>模型服务</h2><p class="state ${info.readable&&info.configured?'':'warning'}">${esc(status)}</p><dl class="service-facts"><div><dt>服务</dt><dd>DeepSeek</dd></div><div><dt>当前模型</dt><dd>${esc(info.model)}</dd></div><div><dt>配置来源</dt><dd>${info.source==='local'?'本机保存':info.source==='environment'?'服务环境配置':info.source==='disabled'?'已清除并停用':'需要重新保存'}</dd></div></dl><p class="muted">保存后立即用于后续任务，无需重启。配置状态不代表接口已连通；保存设置不会调用付费模型。</p></section><section class="panel"><h2>${info.configured?'更换密钥':'输入密钥'}</h2><form id="agent-settings-form" class="fields">${field('DeepSeek API密钥','api_key','','required minlength="8" maxlength="512" autocomplete="off" spellcheck="false"','password')}<p class="muted">保存在运行门店服务的本机。页面不回显已存密钥，不保存到浏览器；留空不会更换配置。</p>${check('我确认保存此密钥，供门店服务后续任务使用。')}<button class="primary" type="submit">保存密钥</button></form><details class="agent-clear-key"><summary>清除密钥并停用</summary><p class="muted">停用后保留库存任务，人工查询和表单仍可使用。重新保存密钥即可启用。</p><form id="agent-settings-clear" class="fields">${check('我确认清除当前服务的密钥配置并停用模型调用。')}<button type="submit">确认清除并停用</button></form></details></section></div>`,'',true);
  const form=$('#agent-settings-form');
  form.onsubmit=async event=>{event.preventDefault();const key=form.elements.api_key.value.trim();if(!key)return;form.elements.api_key.value='';try{await FormState.freezeWhile(form,()=>api('/agent/settings','POST',{api_key:key,confirmed:true}));if(!form.isConnected)return;await agentSettingsPage();notify('密钥已保存，后续任务使用新配置。');}catch(error){notify(error.message+' 请重新输入密钥。');}};
  const clear=$('#agent-settings-clear');clear.onsubmit=async event=>{event.preventDefault();try{await FormState.freezeWhile(clear,()=>api('/agent/settings','DELETE'));if(!clear.isConnected)return;await agentSettingsPage();notify('密钥配置已清除，模型调用已停用。');}catch(error){notify(error.message);}};
}
function agentQueryResult(action,result){
  if(action==='query_inventory')return inventoryResults(result);
  if(action==='query_statistics')return `<h3>已登记有效进货</h3><p class="task-total">${esc(result.total_quantity)} 台</p><p class="muted">查询截至：${stamp(result.queried_at)}；期初与盘点不计进货。</p>${result.coverage.map(row=>`<p>${esc(row.warehouse.name)} · ${esc(row.model.name)}：${esc(coverageNames[row.coverage_status]||'覆盖范围待核对')}</p>`).join('')}<table class="impact"><thead><tr><th>分组</th><th>有效进货</th></tr></thead><tbody>${result.groups.map(row=>`<tr><td>${esc(row.label)}</td><td>${esc(row.quantity)}台</td></tr>`).join('')}</tbody></table>`;
  if(action==='query_reservations')return result.reservations.map(row=>`<article class="reservation"><h3>${esc(row.warehouse.name)} · ${esc(row.model.name)}</h3>${reservationDetails(row)}</article>`).join('')||'<p class="state">当前查询没有匹配的未提预留。</p>';
  return result.ledger.slice(0,50).map(row=>`<article class="row"><div><h3>${esc(({opening:'期初',inbound:'入库',outbound:'出库',reserve:'留货',pickup:'提货',cancel:'取消',adjustment:'盘点',correction:'更正'})[row.kind]||'库存事件')} · 有效${esc(row.quantity)}台</h3><p>${esc(occurredText(row.occurred))}</p><p>${esc(row.basis_note)}</p><p class="receipt-id">原单：${esc(row.business_id)}</p></div></article>`).join('')||'<p class="state">当前范围没有已登记流水。</p>';
}
function agentDraftHref(draft){
  const page=correctionNames[draft.kind]?'correction':movementTypes[draft.kind]?'movement':draft.kind==='inventory_inbound'?'inbound':'opening';
  return `#${page}?draft=${encodeURIComponent(draft.id)}`;
}
function agentItemView(item,index,showForm){
  const draft=item.draft,p= draft?.parameters||{},preview=draft?.preview;
  if(!showForm&&draft&&item.state==='missing'&&!preview&&!Object.values(item.candidates||{}).some(rows=>rows.length))return '';
  const name=agentActions[item.action]||'库存事项';
  let content=item.action==='inventory_opening'&&!draft?'<a class="button" href="#opening">到期初建账表单逐笔核对</a>':'';
  if(item.state==='completed'&&item.result){const receipt=item.result;content=item.action.startsWith('query_')?agentQueryResult(item.action,receipt):`<div class="state success">已登记，以原操作回执为准。</div>${receipt.balance?metrics(receipt.balance):''}<p class="receipt-id">原单：${esc(receipt.business_id)}<br>操作：${esc(receipt.operation_id)}</p><p class="muted">这是提交时结果；最新库存请重新查询。</p>`;}
  else if(draft){const warehouse=preview?.warehouse?.name||state.warehouses.find(row=>row.id===p.warehouse_id)?.name;const model=preview?.model?.name||state.models.find(row=>row.id===p.model_id)?.name;
    content=`<p><strong>${esc(warehouse||'按原单库房')} · ${esc(model||'按原单型号')}</strong></p>${preview?.customer?`<p>客户：${esc(preview.customer.display_name)} · ${esc(preview.customer.phone||'联系方式未知')} · ${esc(preview.customer.address||'地址未知')}</p>`:''}${preview?.reservation?reservationDetails(preview.reservation):''}<p class="muted">${p.occurred?esc(occurredText(p.occurred)):p.t0?'T0：'+stamp(p.t0):'发生时间按原单保留'}</p><p>${['inventory_inbound','inventory_outbound','reservation_create'].includes(draft.kind)?'备注':'依据'}：${esc(p.basis_note||(['inventory_inbound','inventory_outbound','reservation_create'].includes(draft.kind)?'未填写（可选）':'待补'))}</p>${preview?preview.before?inboundImpact(preview):metrics(preview):'<p class="state warning">资料尚未补齐，不能确认。</p>'}`;
    if(showForm)content+=`<a class="button" href="${agentDraftHref(draft)}">改用表单核对</a>`;
    if(item.state==='awaiting_confirmation'&&draft.operation_id)content+=`<form data-agent-confirm="${item.id}" class="fields section-note">${check('我已核对本笔对象、来源依据、时间和以上数量，确认正式登记。')}<button class="primary">确认${name}</button></form>`;
  }
  const candidates=Object.entries(item.candidates||{}).map(([fieldName,rows])=>rows.length?`<form data-agent-select="${esc(item.id)}" data-field="${fieldName}" class="fields section-note">${select(({warehouse:'库房',model:'型号',customer:'客户与地址',reference:'具体预留或原单'})[fieldName],'selection',rows.map(row=>({id:row.id,name:row.label})))}<button>选定并重新预览</button></form>`:'<p class="state warning">当前没有匹配候选，请补充描述或先维护对应资料。</p>').join('');
  return `<section class="panel" data-agent-item="${item.id}"><div class="section-head"><h2>${index+1}. ${name}</h2><span class="badge">${esc(agentStates[item.state]||'待核验')}</span></div>${content}${candidates}</section>`;
}
async function agentTaskPage(params){
  const version=++agentPageVersion,route=location.hash,id=params.get('id');
  if(!id){shell('未选择库存任务','请从工作台或待核对继续','<section class="panel"><a class="button" href="#home">返回工作台</a></section>','',true);return;}
  const [task,provider]=await Promise.all([api('/agent/tasks/'+encodeURIComponent(id)),api('/agent/status').catch(()=>null),loadCatalog()]);
  if(version!==agentPageVersion||route!==location.hash)return;
  const questions=task.items.flatMap((item,index)=>item.question?[{
    text:item.question,title:task.items.length>1?`第${index+1}项 · ${agentActions[item.action]}`:''
  }]:[]);
  if(task.question)questions.unshift({text:task.question,title:''});
  const canReply=!['completed','cancelled'].includes(task.state);
  const attemptsLeft=task.budget.model_attempts<task.budget.max_model_attempts;
  const waiting=agentRuns.has(id);
  const singleItem=task.items.length===1?task.items[0]:null;
  const originalDraft=canReply&&singleItem?.state!=='completed'?singleItem?.draft:null;
  const items=task.items.map((item,index)=>agentItemView(item,index,!originalDraft)).join('');
  const conversation=`<section class="panel agent-conversation">
    <div class="section-head"><h2>任务对话</h2><span class="badge" role="status">${esc(agentStates[task.state]||'待核验')}</span></div>
    <div class="agent-message"><strong>你</strong><pre class="service-source">${esc(task.text)}</pre></div>
    ${(task.followups||[]).map(reply=>`<div class="agent-message"><strong>你的补充</strong><pre class="service-source">${esc(reply)}</pre></div>`).join('')}
    ${questions.length?`<div class="agent-message agent-message-assistant" role="status"><strong>库存助手</strong>
      ${questions.map(question=>`<p>${question.title?`<strong>${esc(question.title)}　</strong>`:''}${esc(question.text)}</p>`).join('')}
    </div>`:''}
    <div role="status"><div id="agent-thinking" class="agent-message agent-message-assistant agent-thinking" data-task-id="${esc(id)}" ${waiting?'':'hidden'}>
      <strong>库存助手正在整理</strong>
      <span class="agent-thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span>
    </div></div>
    ${canReply?`<form id="agent-reply" class="fields section-note"><label class="field"><span>回复库存助手</span>
      <textarea name="reply" rows="3" maxlength="5000" required ${attemptsLeft&&!waiting?'':'disabled'}></textarea></label>
      <button class="primary" ${attemptsLeft&&!waiting?'':'disabled'}>发送补充</button>
      ${attemptsLeft?'':'<p class="muted">已达到本任务的整理次数上限。可使用下方库存表单继续。</p>'}
    </form>`:''}
    <div class="actions section-note"><button id="agent-refresh">核验最新回执</button>
      ${(task.can_retry||!task.items.length)&&canReply&&attemptsLeft&&!waiting?'<button id="agent-run">重新整理</button>':''}
      <a class="button" href="${originalDraft?agentDraftHref(originalDraft):'#inventory'}">使用库存表单</a>${agentDeleteButton(task)}
    </div>
  </section>`;
  const stop=canReply?`<section class="panel"><details><summary>停止尚未提交的部分</summary>
    <form id="agent-cancel" class="fields">${check('确认停止本任务尚未提交的部分。已登记的库存和回执会保留。')}
      <button>取消未提交部分</button>
    </form></details></section>`:'';
  shell('库存任务','通过对话补齐信息，再逐笔核对和确认',`
    ${provider?.test_double?'<p class="state warning">隔离测试环境，使用模型测试替身。</p>':''}
    ${conversation}${items?`<div class="grid">${items}</div>`:''}${stop}`,'',true);
  const main=$('#main');
  bindAgentDeletes(main,()=>{location.hash='home';});
  const action=async(path,payload)=>{try{await FormState.freezeWhile(main,()=>api('/agent/tasks/'+id+'/'+path,'POST',{expected_version:task.version,...payload}));if(main.isConnected)await agentTaskPage(params);}catch(error){notify(error.message);if(main.isConnected)agentTaskPage(params).catch(reloadError=>notify(reloadError.message));}};
  const run=payload=>FormState.freezeWhile(main,()=>runAgentTask(id,{expected_version:task.version,...payload}))
    .catch(error=>notify(error.message));
  $('#agent-refresh').onclick=()=>action('refresh',{});if($('#agent-run'))$('#agent-run').onclick=()=>run({});
  if($('#agent-reply'))$('#agent-reply').onsubmit=event=>{
    event.preventDefault();
    const reply=event.target.elements.reply.value.trim();
    if(reply&&attemptsLeft)run({reply});
  };
  if($('#agent-cancel'))$('#agent-cancel').onsubmit=event=>{event.preventDefault();action('cancel',{});};
  document.querySelectorAll('[data-agent-select]').forEach(form=>form.onsubmit=event=>{event.preventDefault();const value=form.elements.selection.value;if(!value)return notify('请先从列表选定具体对象。');action('select',{item_id:form.dataset.agentSelect,field:form.dataset.field,value});});
  document.querySelectorAll('[data-agent-confirm]').forEach(form=>form.onsubmit=async event=>{event.preventDefault();const item=task.items.find(row=>row.id===form.dataset.agentConfirm),draft=item.draft;try{await FormState.freezeWhile(main,()=>api('/operations/'+draft.operation_id+'/confirm','POST',{draft_id:draft.id,draft_version:draft.version,parameters:draft.parameters}));if(main.isConnected)await agentTaskPage(params);}catch(error){notify('提交结果请按原任务核验，勿重复建立业务。'+error.message);if(main.isConnected)agentTaskPage(params).catch(reloadError=>notify(reloadError.message));}});
  if(typeof FrontendPickers!=='undefined')FrontendPickers.refresh();
}
