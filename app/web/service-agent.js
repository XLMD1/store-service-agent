'use strict';

const serviceTaskPath='/service-agent/tasks';
const serviceTaskIntents={lookup:'查询售后历史',new:'登记新报修',supplement:'补充原档案'};
const serviceTaskHref=id=>'#service-task?id='+encodeURIComponent(id);

async function serviceAgentPage(params){
  if(!hasPermission('service.read'))throw new Error('当前账号无权使用售后助手。');
  const route=location.hash,offset=Math.max(0,Number.parseInt(params.get('offset'),10)||0);
  const data=await api(serviceTaskPath+'?offset='+offset);
  if(route!==location.hash)return;
  shell('售后助手','查询历史、整理新报修或补充维修结果',`<section class="panel service-task">
    <form id="service-task-create" class="fields"><label class="field"><span>要处理的售后事项</span>
      <textarea name="text" rows="4" required maxlength="10000"
        placeholder="例如：查 13800000000 上次的售后记录"></textarea></label>
      <button class="primary">开始整理</button></form>
  </section><section class="panel"><h2>我的售后任务</h2>
    ${data.items.map(item=>`<article class="row"><div><h3>${esc(item.text)}</h3>
      <p>${item.done?'已完成':'待继续'} · ${stamp(item.created_at)}</p></div>
      <a class="button" href="${serviceTaskHref(item.id)}">查看任务</a></article>`).join('')||'<p class="muted">暂无售后任务。</p>'}
    <div class="actions">${offset? `<a class="button" href="#service-agent?offset=${Math.max(0,offset-50)}">上一页</a>`:''}
      ${data.next_offset!=null?`<a class="button" href="#service-agent?offset=${esc(data.next_offset)}">下一页</a>`:''}</div>
  </section>`,'',true);
  const form=$('#service-task-create');
  let request;
  form.onsubmit=async event=>{
    event.preventDefault();
    const text=form.elements.text.value.trim();
    if(!text)return;
    if(request?.text!==text)request={request_id:crypto.randomUUID(),text};
    try{
      const task=await FormState.freezeWhile(form,()=>api(serviceTaskPath,'POST',request));
      if(form.isConnected)location.hash=serviceTaskHref(task.id);
    }catch(error){
      if(form.isConnected)notify(error.message);
    }
  };
}

function serviceTaskTarget(task){
  if(!task.record)return '';
  const row=task.record;
  return `<section class="panel"><h2>${esc(row.fields.problem)}</h2>
    ${row.status==='voided'?'<p class="state warning">已作废 · 保留历史供查阅</p>':''}
    ${serviceRecordFacts(row.fields,['repair_date','model','treatment','parts','result'])}
    ${row.latest_result?`<h3>最新补充结果</h3><p class="service-source">${esc(row.latest_result)}</p>`:''}
    <div class="actions"><a class="button" href="${serviceHistoryLink(task.contact_id)}">查看售后历史</a>
      ${row.source_id?`<a class="button" href="#source?id=${encodeURIComponent(row.source_id)}">查看原件</a>`:''}</div>
  </section>`;
}

function serviceTaskPreview(task){
  const preview=task.preview;
  if(!preview)return '';
  return `<section class="panel"><h2>${task.intent==='new'?'新报修草稿':'维修结果补充预览'}</h2>
    ${preview.contact?`<p>${esc(serviceContactTitle(preview.contact))} · ${esc(serviceContactLine(preview.contact))}</p>`:''}
    ${task.intent==='supplement'?`<p>关联档案 ${esc(task.record_id)} · 第 ${esc(preview.record_version)} 版</p>`:''}
    <p class="service-source">${esc(preview.content)}</p>
    <div class="actions"><a class="button" href="#source?id=${encodeURIComponent(preview.source_id)}">查看本次来源</a>
      ${preview.draft_id?`<a class="button" href="${serviceReviewLink(preview.source_id,preview.draft_id)}">打开归档草稿</a>`:''}</div>
    ${task.preview_stale?'<p class="state warning">档案或草稿已有变化，请核对最新版。</p>':''}
    ${!task.preview_stale&&preview.operation_id&&hasPermission('service.confirm')?`<form id="service-task-confirm" class="fields section-note">
      ${check('我已核对档案、内容和来源。')}<button class="primary">${task.intent==='new'?'确认归档':'确认补充'}</button></form>`:''}
  </section>`;
}

async function serviceTaskPage(params){
  if(!hasPermission('service.read'))throw new Error('当前账号无权使用售后助手。');
  const id=params.get('id'),route=location.hash;
  if(!id)throw new Error('请从售后助手打开一项任务。');
  const path=serviceTaskPath+'/'+encodeURIComponent(id);
  const task=await api(path);
  if(route!==location.hash)return;
  const editable=task.state!=='completed'&&!task.preview?.draft_id;
  const canPrepare=editable&&hasPermission('service.draft')&&task.content
    &&(task.intent==='supplement'&&task.record?.status==='active'&&hasPermission('service.confirm')
      ||task.intent==='new'&&(!task.lookup||task.contact_id));
  shell('售后任务',esc(serviceTaskIntents[task.intent]||'请核对任务类型'),`<section class="panel"><h2>提交内容</h2>
    <p class="service-source">${esc(task.text)}</p>${editable?`<form id="service-task-edit" class="fields">
      <label class="field"><span>要办理的事项</span><select name="intent" required>
        <option value="">请选择</option>${Object.entries(serviceTaskIntents).map(([value,name])=>
          `<option value="${value}" ${task.intent===value?'selected':''}>${name}</option>`).join('')}</select></label>
      ${field('手机号、地址或档案编号','lookup',task.lookup,'maxlength="500"')}
      <label class="field"><span>新报修问题或本次补充内容</span><textarea name="content" rows="3"
        maxlength="4000">${esc(task.content)}</textarea></label>
      <button class="primary">保存并查找</button>
    </form>`:''}</section>
    ${editable&&task.lookup?`<section class="panel"><h2>核对客户与服务地址</h2>
      ${task.contacts.map(contact=>`<article class="row"><div><h3>${esc(serviceContactTitle(contact))}</h3>
        <p>${esc(serviceContactLine(contact))}</p></div><button type="button" data-task-contact="${esc(contact.id)}"
          ${task.contact_id===contact.id?'disabled':''}>${task.contact_id===contact.id?'已选':'选此地址'}</button></article>`).join('')
        ||'<p class="muted">当前归档范围内未找到候选。请核对查找条件。</p>'}
      ${task.contact_id&&['lookup','supplement'].includes(task.intent)?`<h3>核对具体档案</h3>
        ${task.records.map(record=>`<article class="row"><div><h3>${esc(record.fields.problem)}</h3>
          <p>维修日期 ${esc(record.fields.repair_date||'未知')} · 编号 ${esc(record.id)}</p></div>
          <button type="button" data-task-record="${esc(record.id)}" ${task.record_id===record.id?'disabled':''}>
            ${task.record_id===record.id?'已选':'选此档案'}</button></article>`).join('')
          ||'<p class="muted">该地址暂无有效档案。</p>'}`:''}
      ${task.more_candidates?'<p class="muted">还有更多候选，可用完整地址或档案编号缩小范围。</p>':''}
    </section>`:''}
    ${serviceTaskTarget(task)}
    ${task.receipt?`<section class="panel"><h2>${task.intent==='new'?'已归档':'已补充'}</h2>
      <p>回执编号 ${esc(task.receipt.id)}</p>
      ${task.contact_id||task.receipt.contact_id?`<a class="button" href="${serviceHistoryLink(task.contact_id||task.receipt.contact_id)}">查看售后历史</a>`:''}</section>`
      :serviceTaskPreview(task)}
    ${canPrepare&&(!task.preview||task.preview_stale)?`<section class="panel"><button type="button" id="service-task-prepare"
      class="primary">${task.preview_stale?'按当前版本重新预览':'保存草稿并预览'}</button></section>`:''}
    ${editable&&task.intent==='supplement'&&!hasPermission('service.confirm')?
      '<p class="state">登记正式补充需要负责人或接单人员的售后确认权限。</p>':''}
  `,'',true);
  const main=$('#main');
  let dirty=false;
  const act=async(action,payload)=>{
    if(dirty&&action!=='configure'){notify('先保存上方修改，再选择候选或预览。');return;}
    try{
      await FormState.freezeWhile(main,()=>api(path+'/'+action,'POST',payload));
      if(main.isConnected)await serviceTaskPage(params);
    }catch(error){
      if(!main.isConnected)return;
      if(error.status===409){
        await serviceTaskPage(params);
        notify('任务或档案已有变化，请核对最新内容。');
      }else notify(error.message);
    }
  };
  const edit=$('#service-task-edit');
  if(edit){
    edit.oninput=()=>{dirty=true;};
    edit.onsubmit=event=>{
      event.preventDefault();
      act('configure',{...Object.fromEntries(new FormData(edit)),version:task.version});
    };
  }
  for(const button of main.querySelectorAll('[data-task-contact]')){
    button.onclick=()=>act('select',{version:task.version,contact_id:button.dataset.taskContact});
  }
  for(const button of main.querySelectorAll('[data-task-record]')){
    button.onclick=()=>act('select',{version:task.version,record_id:button.dataset.taskRecord});
  }
  const prepare=$('#service-task-prepare');
  if(prepare)prepare.onclick=()=>act('prepare',{version:task.version});
  const confirm=$('#service-task-confirm');
  if(confirm)confirm.onsubmit=event=>{
    event.preventDefault();
    act('confirm',{operation_id:task.preview.operation_id,confirmed:confirm.elements.confirmed.checked});
  };
}
