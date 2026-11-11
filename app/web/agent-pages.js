'use strict';
const agentStates={processing:'处理中',missing:'待补信息',awaiting_confirmation:'待人工确认',awaiting_verification:'待结果核验',completed:'已完成',failed:'暂未完成',cancelled:'已取消未提交部分'};
const agentActions={query_inventory:'库存查询',query_reservations:'预留查询',query_statistics:'进货统计',query_ledger:'库存流水',inventory_opening:'期初建账',inventory_inbound:'入库登记',inventory_outbound:'普通出库',reservation_create:'办理留货',reservation_pickup:'预留提货',reservation_cancel:'取消留货',inventory_adjustment:'盘点调整',inventory_correction:'原单数量更正'};
let agentPageVersion=0;
function agentTaskRows(tasks){return tasks.map(task=>`<article class="row"><div><h3>${esc(task.text.length>70?task.text.slice(0,70)+'…':task.text)}</h3><p>${esc(agentStates[task.state]||'状态待核验')} · ${stamp(task.updated_at)}</p>${task.items?.length?`<p>已完成 ${task.items.filter(item=>item.state==='completed').length} / ${task.items.length} 项；各笔单独核对</p>`:''}</div><a class="button" href="#task?id=${esc(task.id)}">查看任务</a></article>`).join('')||'<p class="muted">尚无库存任务。可输入需求，也可直接使用库存表单。</p>';}
function agentDateKey(value){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));}
function agentMonthChange(month,offset){const [year,number]=month.split('-').map(Number);return new Date(Date.UTC(year,number-1+offset,1)).toISOString().slice(0,7);}
function agentCalendar(month,selected,tasks){
  const first=new Date(month+'-01T12:00:00Z'),padding=(first.getUTCDay()+6)%7;
  const [year,number]=month.split('-').map(Number),days=new Date(Date.UTC(year,number,0)).getUTCDate();
  const counts=new Map();for(const task of tasks){const key=agentDateKey(task.created_at);counts.set(key,(counts.get(key)||0)+1);}
  const today=agentDateKey(new Date());
  return `<div class="agent-calendar-head"><div><h3>${year}年${number}月</h3><p class="muted">按任务创建日期 · ${tasks.length}项</p></div><div class="actions"><button type="button" id="agent-month-prev" aria-label="上个月">‹</button><button type="button" id="agent-calendar-today">今天</button><button type="button" id="agent-month-next" aria-label="下个月">›</button></div></div><div class="agent-calendar-content"><div><div class="agent-calendar-week" aria-hidden="true">${['一','二','三','四','五','六','日'].map(day=>`<span>${day}</span>`).join('')}</div><div class="agent-calendar-grid" role="group" aria-label="${year}年${number}月日期">${'<span aria-hidden="true"></span>'.repeat(padding)}${Array.from({length:days},(_,index)=>{const date=month+'-'+String(index+1).padStart(2,'0'),count=counts.get(date)||0;return `<button type="button" data-agent-date="${date}" aria-pressed="${date===selected}" ${date===today?'aria-current="date"':''} aria-label="${number}月${index+1}日，${count}项任务"><span>${index+1}</span><small>${count?count+'项':'&nbsp;'}</small></button>`;}).join('')}</div><p class="muted agent-calendar-note">选择日期查看任务，已完成记录仍可查阅。</p></div><section id="agent-day-tasks" class="agent-day-tasks" aria-live="polite"></section></div>`;
}
function bindAgentCalendar(month,selected,tasks){
  const choose=date=>{
    state.agentDay=date;
    document.querySelectorAll('[data-agent-date]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.agentDate===date)));
    const rows=tasks.filter(task=>agentDateKey(task.created_at)===date),[,number,day]=date.split('-').map(Number);
    $('#agent-day-tasks').innerHTML=`<h3>${number}月${day}日 <span class="muted">${rows.length}项</span></h3>${rows.length?agentTaskRows(rows):'<p class="state">这一天没有库存任务。可选择其他日期查看。</p>'}`;
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
  const [provider,tasks]=await Promise.allSettled([api('/agent/status'),api('/agent/tasks?month='+month)]);
  if(version!==agentPageVersion||route!==location.hash)return;
  const info=provider.status==='fulfilled'?provider.value:null,rows=tasks.status==='fulfilled'?tasks.value:[];
  const status=!info?'任务服务暂不可用':info.test_double?'测试替身 · 未调用DeepSeek':info.configured?'DeepSeek已配置 · '+info.model:'DeepSeek尚未配置';
  shell('工作台','描述库存需求，核对草稿后再确认',`<div class="service-home"><section class="panel material-ink service-task"><h2>今天要处理什么？</h2><form id="agent-task-form" class="fields"><label class="field"><span>库存任务</span><textarea name="text" maxlength="10000" rows="4" required placeholder="例如：查一号库所有型号的库存">${esc(state.agentText||'')}</textarea></label><div class="actions"><button class="primary" id="agent-start">开始整理</button></div><p class="muted">先查询、补问并生成草稿；正式登记仍需你逐笔点击确认。仅支持文字库存任务。</p></form></section><nav class="service-shortcuts" aria-label="库存常用功能"><a href="#inventory">${icon('box')}查库存</a>${canInbound()?`<a href="#inbound">${icon('plus')}登记入库</a>`:''}<a href="#reservations">${icon('box')}预留查询</a><a href="#statistics">${icon('file')}进货统计</a></nav><aside class="panel service-pending"><h2>任务进度</h2><p class="state ${info?.test_double||!info?.configured?'warning':''}">${esc(status)}</p><p class="muted section-note">${info?.test_double?'此环境使用明确标识的模型测试替身；库存结果仍来自当前测试数据库。':info?.configured?'模型只整理意图；数量和实际回执由库存服务提供。':'负责人可在DeepSeek设置中保存密钥；现有库存查询与人工表单继续可用。'}</p><div class="actions section-note"><a class="button" href="#pending">查看待核对</a>${hasPermission('service.read')?'<a class="button" href="#sources">售后来源</a>':''}${state.user.permissions.includes('account.manage')?'<a class="button" href="#deepseek-settings">DeepSeek设置</a>':''}</div></aside><section class="panel service-recent"><h2>我的库存任务</h2>${tasks.status==='rejected'?'<p class="state warning">暂时无法读取任务列表，请重试；不代表没有历史任务。</p><button id="agent-reload">重试读取任务</button>':agentCalendar(month,selected,rows)}</section></div>`);
  const form=$('#agent-task-form');form.elements.text.oninput=()=>{state.agentText=form.elements.text.value;};
  if(tasks.status==='fulfilled')bindAgentCalendar(month,selected,rows);
  if($('#agent-reload'))$('#agent-reload').onclick=()=>agentHomePage().catch(error=>notify(error.message));
  form.onsubmit=async event=>{event.preventDefault();const text=form.elements.text.value.trim();if(!text)return;state.agentText=text;
    if(!state.agentRequest||state.agentRequest.text!==text)state.agentRequest={request_id:crypto.randomUUID(),text};
    try{const task=await FormState.freezeWhile(form,()=>api('/agent/tasks','POST',state.agentRequest));state.agentRequest=null;if(!form.isConnected)return;const hash='#task?id='+task.id;location.hash=hash;
      try{await api('/agent/tasks/'+task.id+'/run','POST',{expected_version:task.version});}catch(error){notify('任务已保存，处理结果需要核验。'+error.message);}
      if(location.hash===hash)await agentTaskPage(new URLSearchParams({id:task.id}));
    }catch(error){notify('尚未核实任务保存结果，请查看任务列表或按原请求重试。'+error.message);}
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
function agentItemView(item,index){
  const draft=item.draft,p= draft?.parameters||{},preview=draft?.preview;
  const name=agentActions[item.action]||'库存事项';
  let content=item.action==='inventory_opening'&&!draft?'<a class="button" href="#opening">到期初建账表单逐笔核对</a>':'';
  if(item.state==='completed'&&item.result){const receipt=item.result;content=item.action.startsWith('query_')?agentQueryResult(item.action,receipt):`<div class="state success">已登记，以原操作回执为准。</div>${receipt.balance?metrics(receipt.balance):''}<p class="receipt-id">原单：${esc(receipt.business_id)}<br>操作：${esc(receipt.operation_id)}</p><p class="muted">这是提交时结果；最新库存请重新查询。</p>`;}
  else if(draft){const warehouse=preview?.warehouse?.name||state.warehouses.find(row=>row.id===p.warehouse_id)?.name;const model=preview?.model?.name||state.models.find(row=>row.id===p.model_id)?.name;
    content=`<p><strong>${esc(warehouse||'按原单库房')} · ${esc(model||'按原单型号')}</strong></p>${preview?.customer?`<p>客户：${esc(preview.customer.display_name)} · ${esc(preview.customer.phone||'联系方式未知')} · ${esc(preview.customer.address||'地址未知')}</p>`:''}${preview?.reservation?reservationDetails(preview.reservation):''}<p class="muted">${p.occurred?esc(occurredText(p.occurred)):p.t0?'T0：'+stamp(p.t0):'发生时间按原单保留'}</p><p>${['inventory_inbound','inventory_outbound'].includes(draft.kind)?'备注':'依据'}：${esc(p.basis_note||(['inventory_inbound','inventory_outbound'].includes(draft.kind)?'未填写（可选）':'待补'))}</p>${preview?preview.before?inboundImpact(preview):metrics(preview):'<p class="state warning">资料尚未补齐，不能确认。</p>'}`;
    const page=correctionNames[draft.kind]?'correction':movementTypes[draft.kind]?'movement':draft.kind==='inventory_inbound'?'inbound':'opening';
    content+=`<a class="button" href="#${page}?draft=${esc(draft.id)}">在原表单继续核对</a>`;
    if(item.state==='awaiting_confirmation'&&draft.operation_id)content+=`<form data-agent-confirm="${item.id}" class="fields section-note">${check('我已核对本笔对象、来源依据、时间和以上数量，确认正式登记。')}<button class="primary">确认${name}</button></form>`;
  }
  const candidates=Object.entries(item.candidates||{}).map(([fieldName,rows])=>rows.length?`<form data-agent-select="${esc(item.id)}" data-field="${fieldName}" class="fields section-note">${select(({warehouse:'库房',model:'型号',customer:'客户与地址',reference:'具体预留或原单'})[fieldName],'selection',rows.map(row=>({id:row.id,name:row.label})))}<button>选定并重新预览</button></form>`:'<p class="state warning">当前没有匹配候选，请补充描述或先维护对应资料。</p>').join('');
  return `<section class="panel" data-agent-item="${item.id}"><div class="section-head"><h2>${index+1}. ${name}</h2><span class="badge">${esc(agentStates[item.state]||'待核验')}</span></div>${item.question?`<p class="state warning">${esc(item.question)}</p>`:''}${content}${candidates}</section>`;
}
async function agentTaskPage(params){
  const version=++agentPageVersion,route=location.hash,id=params.get('id');
  if(!id){shell('未选择库存任务','请从工作台或待核对继续','<section class="panel"><a class="button" href="#home">返回工作台</a></section>','',true);return;}
  const [task,provider]=await Promise.all([api('/agent/tasks/'+encodeURIComponent(id)),api('/agent/status').catch(()=>null),loadCatalog()]);
  if(version!==agentPageVersion||route!==location.hash)return;
  shell('库存任务','逐笔核对，保留草稿及原操作结果',`${provider?.test_double?'<p class="state warning">模型测试替身生成的计划 · 当前为隔离样例环境，未调用DeepSeek。</p>':''}<section class="panel"><div class="section-head"><h2>本次需求</h2><span class="badge" role="status">${esc(agentStates[task.state]||'待核验')}</span></div><pre class="service-source">${esc(task.text)}</pre>${(task.followups||[]).map((reply,index)=>`<h3>补充说明 ${index+1}</h3><pre class="service-source">${esc(reply)}</pre>`).join('')}${task.question?`<p class="state warning" role="status">${esc(task.question)}</p>`:''}<p class="muted">保存：${stamp(task.updated_at)} · 已完成 ${task.items.filter(row=>row.state==='completed').length} / ${task.items.length} 项</p><div class="actions"><button id="agent-refresh">核验最新回执</button>${(task.can_retry||!task.items.length)&&task.state!=='cancelled'?'<button id="agent-run" class="primary">整理或重试此任务</button>':''}<a class="button" href="#inventory">使用库存表单</a></div></section><div class="grid">${task.items.map(agentItemView).join('')}</div>${!['completed','cancelled'].includes(task.state)?`<section class="panel"><h2>补充或修正未完成事项</h2><form id="agent-reply" class="fields"><label class="field"><span>补充说明</span><textarea name="reply" rows="3" maxlength="5000" required></textarea></label><button class="primary" ${task.budget.model_attempts>=task.budget.max_model_attempts?'disabled':''}>补充并重新整理</button><p class="muted">只处理未完成事项；已登记部分保留。整理尝试 ${task.budget.model_attempts} / ${task.budget.max_model_attempts}（开发上限），也可直接从原表单补齐。</p></form><details><summary>停止尚未提交的部分</summary><form id="agent-cancel" class="fields">${check('确认停止本任务尚未提交的部分；已登记事实保留，更正需另行办理。')}<button>取消未提交部分</button></form></details></section>`:''}`,'',true);
  const main=$('#main');
  const action=async(path,payload)=>{try{await FormState.freezeWhile(main,()=>api('/agent/tasks/'+id+'/'+path,'POST',{expected_version:task.version,...payload}));if(main.isConnected)await agentTaskPage(params);}catch(error){notify(error.message);if(main.isConnected)agentTaskPage(params).catch(reloadError=>notify(reloadError.message));}};
  $('#agent-refresh').onclick=()=>action('refresh',{});if($('#agent-run'))$('#agent-run').onclick=()=>action('run',{});
  if($('#agent-reply'))$('#agent-reply').onsubmit=event=>{event.preventDefault();action('run',{reply:event.target.elements.reply.value});};
  if($('#agent-cancel'))$('#agent-cancel').onsubmit=event=>{event.preventDefault();action('cancel',{});};
  document.querySelectorAll('[data-agent-select]').forEach(form=>form.onsubmit=event=>{event.preventDefault();const value=form.elements.selection.value;if(!value)return notify('请先从列表选定具体对象。');action('select',{item_id:form.dataset.agentSelect,field:form.dataset.field,value});});
  document.querySelectorAll('[data-agent-confirm]').forEach(form=>form.onsubmit=async event=>{event.preventDefault();const item=task.items.find(row=>row.id===form.dataset.agentConfirm),draft=item.draft;try{await FormState.freezeWhile(main,()=>api('/operations/'+draft.operation_id+'/confirm','POST',{draft_id:draft.id,draft_version:draft.version,parameters:draft.parameters}));if(main.isConnected)await agentTaskPage(params);}catch(error){notify('提交结果请按原任务核验，勿重复建立业务。'+error.message);if(main.isConnected)agentTaskPage(params).catch(reloadError=>notify(reloadError.message));}});
  if(typeof FrontendPickers!=='undefined')FrontendPickers.refresh();
}
