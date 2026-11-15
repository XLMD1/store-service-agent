'use strict';

const serviceContactTitle=contact=>contact.name||'客户称呼未知';
const serviceContactLine=contact=>[contact.phone||'手机号未知',contact.address||'地址未知'].join(' · ');
const serviceHistoryLink=id=>'#service-detail?contact='+encodeURIComponent(id);
const partialDateLabel={year:'（仅知年份）',month:'（仅知月份）'};
const serviceRecordLabels={
  problem:'问题描述',customer_name:'客户称呼',phone:'手机号',address:'服务地址',
  repair_date:'维修日期',model:'设备型号',error_code:'故障码',
  treatment:'处理方法',parts:'更换配件',result:'实际结果',
};

function serviceRecordFacts(fields,names=Object.keys(serviceRecordLabels),resultLabel=serviceRecordLabels.result){
  return `<dl class="service-facts">${names.map(name=>`<div><dt>${name==='result'?resultLabel:serviceRecordLabels[name]}</dt>
    <dd>${esc(fields[name]||'未知')}${fields.uncertain_fields?.includes(name)?'（待核对）':''}</dd></div>`).join('')}</dl>`;
}

async function archiveSearchPage(){
  if(!hasPermission('service.read'))throw new Error('当前账号无权查询售后档案。');
  shell('售后档案','按手机号或地址查询已归档记录',`<section class="panel">
    <form id="service-history-search" class="fields">
      ${field('手机号或地址','q',state.serviceArchiveQuery||'','required maxlength="500"')}
      <button class="primary" type="submit">查询档案</button>
    </form>
    <div class="section-note" id="service-history-results" aria-live="polite"></div>
  </section><div><a class="button" href="#sources">售后来源</a> <a class="button" href="#service-agent">售后助手</a></div>`);
  const form=$('#service-history-search'), results=$('#service-history-results');
  async function search(query,offset=0){
    results.textContent='正在查询…';
    try{
      const rows=await FormState.freezeWhile(form,()=>api('/service-records/search','POST',{q:query,offset}));
      if(!form.isConnected)return;
      state.serviceArchiveQuery=query;
      results.innerHTML=rows.items.length?`<h2>选择客户与服务地址</h2>
        ${rows.items.map(row=>`<article class="row"><div><h3>${esc(serviceContactTitle(row))}</h3>
          <p>${esc(serviceContactLine(row))}</p></div><a class="button" href="${serviceHistoryLink(row.id)}">查看历史</a></article>`).join('')}
        <div class="actions">${offset?'<button type="button" data-history-previous>上一页</button>':''}
          ${rows.next_offset!=null?'<button type="button" data-history-next>下一页</button>':''}</div>`
        :'<p class="state">当前已归档范围内未找到。</p>';
      const previous=results.querySelector('[data-history-previous]'), next=results.querySelector('[data-history-next]');
      if(previous)previous.onclick=()=>search(query,Math.max(0,offset-50));
      if(next)next.onclick=()=>search(query,rows.next_offset);
    }catch(error){
      if(form.isConnected)results.textContent=error.message;
    }
  }
  form.onsubmit=event=>{
    event.preventDefault();
    const query=form.elements.q.value.trim();
    if(query)search(query);
    else results.textContent='请输入手机号或地址。';
  };
}

async function archiveHistoryPage(params){
  if(!hasPermission('service.read'))throw new Error('当前账号无权查询售后档案。');
  const id=params.get('contact');
  if(!id)throw new Error('请先查询并选择客户与服务地址。');
  const route=location.hash, offset=Math.max(0,Number.parseInt(params.get('offset'),10)||0);
  const data=await api('/service-records/contacts/'+encodeURIComponent(id)+'?offset='+offset);
  if(route!==location.hash)return;
  const link=serviceHistoryLink(data.contact.id)+'&amp;offset=';
  const entries=data.items.map(row=>`<section class="panel" id="archive-${esc(row.id)}">
    <h2>${esc(row.fields.problem)}</h2>
    ${row.status==='voided'?'<p class="state warning">已作废 · 保留历史供查阅</p>':''}
    <p class="muted">维修日期 ${esc(row.fields.repair_date||'未知')}${partialDateLabel[row.fields.repair_date_precision]||''}${row.fields.uncertain_fields?.includes('repair_date')?'（待核对）':''} · 归档于 ${stamp(row.archived_at)}</p>
    ${serviceRecordFacts(row.fields,['treatment','parts','result','model','error_code',
      ...['customer_name','phone','address'].filter(name=>row.fields[name]
        &&row.fields[name]!==data.contact[name==='customer_name'?'name':name])],'档案结果')}
    <div data-latest-result ${row.latest_result?'':'hidden'}><h3>最新补充结果</h3>
      <p class="service-source">${esc(row.latest_result)}</p></div>
    ${row.source_id?`<a class="button" href="#source?id=${encodeURIComponent(row.source_id)}">查看原件</a>`
      :'<p class="muted">原件由来源提交者查阅。</p>'}
    <details class="section-note" data-service-supplement="${esc(row.id)}">
      <summary>${hasPermission('service.confirm')&&row.status!=='voided'?'补充处理结果':'查看补充结果'}</summary>
      <div data-supplement-content></div>
    </details>
    <details class="section-note" data-record-revisions="${esc(row.id)}">
      <summary>档案更正与作废记录</summary>
      <div data-revision-content></div>
    </details>
  </section>`).join('');
  shell('售后历史',esc(serviceContactTitle(data.contact)),`<section class="panel"><h2>客户与服务地址</h2>
    <p>${esc(serviceContactLine(data.contact))}</p></section>${entries}
    <div class="actions">${offset?`<a class="button" href="${link+Math.max(0,offset-50)}">上一页</a>`:''}
      ${data.next_offset!=null?`<a class="button" href="${link+esc(data.next_offset)}">下一页</a>`:''}</div>`,'',true);
  document.querySelectorAll('[data-service-supplement]').forEach((detail,index)=>{
    detail.ontoggle=()=>{
      if(detail.open&&!detail.querySelector('[data-supplement-list]'))bindServiceSupplement(detail,data.items[index]);
    };
  });
  document.querySelectorAll('[data-record-revisions]').forEach((detail,index)=>{
    detail.ontoggle=()=>{
      if(detail.open&&!detail.querySelector('[data-revision-list]'))bindServiceRevisions(detail,data.items[index]);
    };
  });
}

function bindServiceRevisions(detail,row){
  const path='/service-records/'+encodeURIComponent(row.id)+'/revisions';
  const panel=detail.querySelector('[data-revision-content]');
  const names=['problem','model','error_code','repair_date','treatment','parts','result'];
  panel.innerHTML=`<div data-revision-list class="section-note"></div>
    ${hasPermission('service.confirm')&&row.status!=='voided'?`<form class="fields" data-revision-form hidden>
      <label class="field"><span>更正项目</span><select name="field" required>
        <option value="">请选择</option>
        ${names.map(name=>`<option value="${name}">${serviceRecordLabels[name]}</option>`).join('')}
        ${hasPermission('account.manage')?'<option value="void">作废整条档案</option>':''}
      </select></label>
      <div data-revision-value hidden><label class="field"><span>更正后内容</span>
        <textarea name="value" maxlength="4000" rows="2"></textarea></label>
        <p class="muted" data-date-hint hidden>日期可填 YYYY、YYYY-MM 或 YYYY-MM-DD。留空表示未知。</p></div>
      ${field('原因','reason','','required maxlength="500"')}
      <button type="submit" class="primary">预览变更</button>
    </form><div class="section-note" data-revision-preview></div><p data-revision-status role="status"></p>`:''}`;
  const list=panel.querySelector('[data-revision-list]');
  const form=panel.querySelector('[data-revision-form]');
  let current;
  const display=value=>Array.isArray(value)?value.map(key=>serviceRecordLabels[key]||key).join('、')
    :value==='active'?'有效':value==='voided'?'已作废':value||'未知';
  const label=key=>({status:'档案状态',repair_date_precision:'日期精度',uncertain_fields:'待核对字段'}[key]
    ||serviceRecordLabels[key]||key);
  const compare=(before,after)=>Object.keys(before).map(key=>`<p>${esc(label(key))}<br>
    ${esc(display(before[key]))} → ${esc(display(after[key]))}</p>`).join('');
  async function load(offset=0){
    try{
      const result=await api(path+'?offset='+offset);
      if(!panel.isConnected)return;
      if(offset===0){
        current=result;
        if(form)form.hidden=result.status==='voided';
      }
      list.innerHTML=result.items.length?result.items.map(entry=>`<article class="service-row">
        <h3>${entry.kind==='void'?'作废':'字段更正'}</h3><p class="muted">第 ${esc(entry.version)} 版 · ${esc(entry.actor)} · ${stamp(entry.created_at)}</p>
        <p>${esc(entry.reason)}</p>${compare(entry.before,entry.after)}</article>`).join('')
        :'<p class="muted">暂无更正或作废记录。</p>';
      if(offset)list.insertAdjacentHTML('beforeend',`<button type="button" data-revision-offset="${Math.max(0,offset-50)}">上一页</button>`);
      if(result.next_offset!=null)list.insertAdjacentHTML('beforeend',`<button type="button" data-revision-offset="${esc(result.next_offset)}">下一页</button>`);
    }catch(error){
      if(panel.isConnected)list.innerHTML=`<p role="status">${esc(error.message)}</p><button type="button" data-revision-offset="${offset}">重试</button>`;
    }
  }
  list.onclick=event=>{if(event.target.dataset.revisionOffset!=null)load(Number(event.target.dataset.revisionOffset));};
  load();
  if(!form)return;
  const preview=panel.querySelector('[data-revision-preview]'),status=panel.querySelector('[data-revision-status]');
  const target=form.elements.field, value=form.elements.value;
  target.onchange=()=>{
    const key=target.value;
    panel.querySelector('[data-revision-value]').hidden=!key||key==='void';
    panel.querySelector('[data-date-hint]').hidden=key!=='repair_date';
    value.value=current?.fields[key]||'';
  };
  form.oninput=()=>{preview.replaceChildren();status.textContent='';};
  form.onsubmit=event=>{
    event.preventDefault();
    if(!current||current.status!=='active')return;
    const key=target.value, reason=form.elements.reason.value.trim(), after=value.value.trim()||null;
    if(!reason){status.textContent='请填写原因。';return;}
    const isVoid=key==='void',changes=isVoid?{}:{[key]:after};
    if(key==='repair_date')changes.repair_date_precision=after?({4:'year',7:'month',10:'day'}[after.length]||'unknown'):'unknown';
    const payload={kind:isVoid?'void':'correct',reason,changes,version:current.version,
      operation_id:crypto.randomUUID(),confirmed:true};
    preview.innerHTML=`<section class="state"><h3>${isVoid?'核对作废':'核对更正'}</h3>
      <p>档案编号 ${esc(row.id)} · 第 ${esc(current.version)} 版</p>
      ${isVoid?compare({status:'active'},{status:'voided'}):compare({[key]:current.fields[key]},{[key]:after})}
      <p>原因 ${esc(reason)}</p><form data-revision-confirm>${check('我已核对档案和本次变更。')}
      <button class="primary">确认${isVoid?'作废':'更正'}</button></form></section>`;
    preview.querySelector('form').onsubmit=async confirmation=>{
      confirmation.preventDefault();
      try{
        await FormState.freezeWhile(panel,()=>api(path,'POST',payload));
        if(!panel.isConnected)return;
        await render();
        const updated=document.querySelector('[data-record-revisions="'+row.id+'"]');
        if(updated)updated.open=true;
        notify(isVoid?'档案已作废，历史保留。':'更正已保存。');
      }catch(error){
        if(!panel.isConnected)return;
        if(error.status===409){
          preview.replaceChildren();
          current=null;
          await load();
          status.textContent='档案已更新，请核对最新版本。你的输入已保留。';
        }else status.textContent=error.status===422?'请核对更正内容和格式。':error.message;
      }
    };
  };
}

function bindServiceSupplement(detail,row){
  const path='/service-records/'+encodeURIComponent(row.id)+'/supplements';
  const panel=detail.querySelector('[data-supplement-content]');
  panel.innerHTML=`<div class="section-note" data-supplement-list></div>
    ${hasPermission('service.confirm')&&row.status!=='voided'?`<form class="fields section-note" data-supplement-form hidden>
      <label class="field"><span>后续处理与结果</span><textarea name="result" rows="3" maxlength="4000" required></textarea></label>
      <label class="field"><span>本次来源</span><select name="source" required><option value="">请选择自己保存的原件</option></select></label>
      <div class="actions"><a href="#sources" target="_blank" rel="noopener">在新窗口保存来源</a>
        <button type="button" data-supplement-sources>刷新来源</button>
        <button type="button" data-supplement-more hidden>加载更多来源</button></div>
      <p data-supplement-source-status role="status"></p>
      <button type="submit" class="primary">预览补充</button>
    </form>
    <div class="section-note" data-supplement-preview></div>
    <p data-supplement-status role="status"></p>`:''}`;
  const list=panel.querySelector('[data-supplement-list]'), form=panel.querySelector('[data-supplement-form]');
  const latestResult=detail.parentElement.querySelector('[data-latest-result]');
  let version, latest;
  async function load(offset=0){
    try{
      const data=await api(path+'?offset='+offset);
      if(!panel.isConnected)return;
      if(offset===0){
        version=data.version;
        latest=data.items[0]?.result;
        latestResult.hidden=!latest;
        latestResult.querySelector('p').textContent=latest||'';
        if(form)form.hidden=false;
      }
      list.innerHTML=data.items.length?`<h3>补充记录</h3>${data.items.map(item=>`<article class="service-row">
        <small>第 ${esc(item.version)} 版 · ${esc(item.actor)} · ${stamp(item.created_at)}</small>
        <p class="service-source">${esc(item.result)}</p>
        ${item.source_id?`<a href="#source?id=${encodeURIComponent(item.source_id)}">查看本次来源</a>`
          :'<p class="muted">本次来源由提交者查阅。</p>'}</article>`).join('')}
        <div class="actions">${offset?`<button type="button" data-supplement-offset="${Math.max(0,offset-50)}">上一页</button>`:''}
        ${data.next_offset!=null?`<button type="button" data-supplement-offset="${esc(data.next_offset)}">下一页</button>`:''}</div>`
        :'<p class="muted">暂无补充记录。</p>';
    }catch(error){
      if(!panel.isConnected)return;
      list.innerHTML=`<p role="status">${esc(error.message)}</p><button type="button" data-supplement-offset="${offset}">重试读取</button>`;
    }
  }
  list.onclick=event=>{
    const button=event.target.closest('[data-supplement-offset]');
    if(button)load(Number(button.dataset.supplementOffset));
  };
  load();
  if(!form)return;
  const source=form.elements.source, preview=panel.querySelector('[data-supplement-preview]'),
    status=panel.querySelector('[data-supplement-status]'), sourceStatus=panel.querySelector('[data-supplement-source-status]'),
    more=panel.querySelector('[data-supplement-more]');
  async function loadSources(offset=0){
    try{
      const data=await FormState.freezeWhile(form,()=>api('/sources?offset='+offset));
      if(!form.isConnected)return;
      const selected=source.value;
      if(!offset)while(source.options.length>1)source.remove(1);
      for(const item of data.items){
        if(item.id===row.source_id||Array.from(source.options).some(option=>option.value===item.id))continue;
        const name=item.source_label||'未命名来源';
        const option=document.createElement('option');
        option.value=item.id;
        option.textContent=[name,item.material_type==='photo'?'照片':'文字',stamp(item.submitted_at),item.id.slice(0,8)].join(' · ');
        source.append(option);
      }
      if(Array.from(source.options).some(option=>option.value===selected))source.value=selected;
      else preview.replaceChildren();
      more.hidden=data.next_offset==null;
      more.onclick=()=>loadSources(data.next_offset);
      sourceStatus.textContent=source.options.length>1?'':'暂无可选来源。请先保存本次原文或照片。';
    }catch(error){
      if(form.isConnected)sourceStatus.textContent=error.message;
    }
  }
  panel.querySelector('[data-supplement-sources]').onclick=()=>loadSources();
  loadSources();
  form.oninput=()=>{preview.replaceChildren();status.textContent='';};
  form.onsubmit=event=>{
    event.preventDefault();
    const result=form.elements.result.value.trim();
    if(!result||!source.value||!version){status.textContent='请填写结果并选择本次来源。';return;}
    const payload={operation_id:crypto.randomUUID(),version,result,source_id:source.value,confirmed:true};
    preview.innerHTML=`<section class="state"><h3>核对补充内容</h3>
      <p>档案编号 ${esc(row.id)} · 第 ${esc(version)} 版</p>
      ${serviceRecordFacts({result:latest||row.fields.result},['result'],'本次补充前的结果')}
      <h4>本次补充</h4><p class="service-source">${esc(result)}</p>
      <p><a href="#source?id=${encodeURIComponent(source.value)}" target="_blank" rel="noopener">查看本次来源</a></p>
      <form data-supplement-confirm>${check('我已核对档案、本次结果和来源。')}
        <button type="submit" class="primary">确认补充</button></form></section>`;
    preview.querySelector('form').onsubmit=async confirmEvent=>{
      confirmEvent.preventDefault();
      status.textContent='正在确认补充…';
      try{
        const receipt=await FormState.freezeWhile(panel,()=>api(path,'POST',payload));
        if(!form.isConnected)return;
        form.reset();
        preview.replaceChildren();
        await load();
        status.textContent='补充已保存 · 第 '+receipt.version+' 版';
      }catch(error){
        if(!form.isConnected)return;
        if(error.status===409){
          preview.replaceChildren();
          version=null;
          await load();
          status.textContent='档案已更新。请核对最新记录，你的输入已保留，可重新预览。';
        }else status.textContent=error.message;
      }
    };
    status.textContent='';
  };
}

function renderArchiveControls(panel,source,draft,editForm){
  panel.replaceChildren();
  panel.hidden=!draft||(!draft.archive&&!hasPermission('service.confirm'));
  if(panel.hidden)return;
  if(draft.archive){
    panel.innerHTML=`<div class="state success" role="status"><strong>已归档</strong>
      <p>档案编号 ${esc(draft.archive.id)}</p></div>
      <div class="actions"><a class="button primary" href="${serviceHistoryLink(draft.archive.contact_id)}">查看售后历史</a></div>`;
    return;
  }
  const path='/sources/'+encodeURIComponent(source.id)+'/drafts/'+encodeURIComponent(draft.id);
  const initial=draft.fields.uncertain_fields?.includes('phone')?draft.fields.address:draft.fields.phone||draft.fields.address;
  panel.innerHTML=`<h2>核对客户与服务地址</h2>
    <form id="service-contact-search" class="fields">
      ${field('手机号或地址','q',initial||'','required maxlength="500"')}
      <button type="submit">查找已有客户与地址</button>
    </form>
    <p class="section-note muted" id="service-contact-status" role="status"></p>
    <button type="button" id="service-contact-next" hidden>下一页候选</button>
    <form id="service-archive-preview-form" class="fields section-note">
      <label class="field"><span>关联方式</span><select name="contact" required>
        <option value="">请选择</option><option value="new">确认新建客户与服务地址</option>
      </select></label>
      <button type="submit">预览归档</button>
    </form>
    <div id="service-archive-confirmation" class="section-note"></div>
    <p id="service-archive-status" role="status"></p>`;
  const contactForm=panel.querySelector('#service-contact-search');
  const next=panel.querySelector('#service-contact-next');
  const contactStatus=panel.querySelector('#service-contact-status');
  const previewForm=panel.querySelector('#service-archive-preview-form');
  const confirmation=panel.querySelector('#service-archive-confirmation');
  const status=panel.querySelector('#service-archive-status');
  const choices=previewForm.elements.contact;
  function clearPreview(){
    confirmation.replaceChildren();
    status.textContent='';
  }
  async function findContacts(query,offset=0){
    clearPreview();
    choices.selectedIndex=0;
    while(choices.options.length>2)choices.remove(2);
    next.hidden=true;
    contactStatus.textContent='正在查找…';
    try{
      const result=await FormState.freezeWhile(panel,()=>api('/service-records/search','POST',{q:query,offset}));
      if(!contactForm.isConnected)return;
      for(const item of result.items){
        const option=document.createElement('option');
        option.value=item.id;
        option.textContent=serviceContactTitle(item)+' · '+serviceContactLine(item)+' · '+item.id.slice(0,8);
        choices.append(option);
      }
      contactStatus.textContent=result.items.length?'请按地址核对并选择。':'当前已归档范围内未找到。';
      next.hidden=result.next_offset==null;
      next.onclick=()=>findContacts(query,result.next_offset);
    }catch(error){
      if(contactForm.isConnected)contactStatus.textContent=error.message;
    }
  }
  contactForm.onsubmit=event=>{
    event.preventDefault();
    const query=contactForm.elements.q.value.trim();
    if(query)findContacts(query);
  };
  choices.onchange=clearPreview;
  previewForm.onsubmit=async event=>{
    event.preventDefault();
    clearPreview();
    const association=choices.value==='new'?{create_new:true}:{contact_id:choices.value};
    try{
      const preview=await FormState.freezeWhile(panel,()=>api(path+'/archive-preview','POST',{version:draft.version,...association}));
      if(!previewForm.isConnected)return;
      confirmation.innerHTML=`<section class="state">
        <h3>确认归档内容</h3><p>${esc(serviceContactTitle(preview.contact))} · ${esc(serviceContactLine(preview.contact))}</p>
        <a href="#source?id=${encodeURIComponent(preview.source_id)}">查看对应来源</a>
        ${serviceRecordFacts(preview.fields)}
        <form id="service-archive-confirm-form">
          ${check('我已核对客户、地址、字段及来源。')}
          <button class="primary" type="submit">确认归档</button>
        </form></section>`;
      confirmation.querySelector('form').onsubmit=async confirmEvent=>{
        confirmEvent.preventDefault();
        status.textContent='正在确认归档…';
        try{
          await FormState.freezeWhile(editForm,()=>FormState.freezeWhile(panel,()=>
            api(path+'/archive-confirm','POST',{operation_id:preview.operation_id,confirmed:true})));
          if(confirmation.isConnected)await render();
        }catch(error){
          if(!confirmation.isConnected)return;
          if(error.status===409)clearPreview();
          status.textContent=error.status===409?'归档预览已变化，请重新读取草稿并预览。'
            :'归档结果尚未核实。请重试同一次确认，或重新打开草稿核验。';
        }
      };
    }catch(error){
      if(!previewForm.isConnected)return;
      status.textContent=error.status===422?'请先核对问题描述，并确认可识别的手机号或地址。':error.message;
    }
  };
}
