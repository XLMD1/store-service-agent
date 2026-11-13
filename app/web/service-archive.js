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

function serviceRecordFacts(fields,names=Object.keys(serviceRecordLabels)){
  return `<dl class="service-facts">${names.map(name=>`<div><dt>${serviceRecordLabels[name]}</dt>
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
  </section><div><a class="button" href="#sources">售后来源</a></div>`);
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
    <p class="muted">维修日期 ${esc(row.fields.repair_date||'未知')}${partialDateLabel[row.fields.repair_date_precision]||''}${row.fields.uncertain_fields?.includes('repair_date')?'（待核对）':''} · 归档于 ${stamp(row.archived_at)}</p>
    ${serviceRecordFacts(row.fields,['treatment','parts','result','model','error_code',
      ...['customer_name','phone','address'].filter(name=>row.fields[name]
        &&row.fields[name]!==data.contact[name==='customer_name'?'name':name])])}
    ${row.source_id?`<a class="button" href="#source?id=${encodeURIComponent(row.source_id)}">查看原件</a>`
      :'<p class="muted">原件由来源提交者查阅。</p>'}
  </section>`).join('');
  shell('售后历史',esc(serviceContactTitle(data.contact)),`<section class="panel"><h2>客户与服务地址</h2>
    <p>${esc(serviceContactLine(data.contact))}</p></section>${entries}
    <div class="actions">${offset?`<a class="button" href="${link+Math.max(0,offset-50)}">上一页</a>`:''}
      ${data.next_offset!=null?`<a class="button" href="${link+esc(data.next_offset)}">下一页</a>`:''}</div>`,'',true);
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
