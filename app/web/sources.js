'use strict';

const sourceKinds={chat:'群消息',paper:'纸本',other:'其他'};

function photoBase64(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result).split(',',2)[1]);
    reader.onerror=()=>reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function sourceForm(policy){
  const photos=policy.photo_media_types?.length;
  const photoLimit=photos?(policy.photo_max_bytes/1048576).toLocaleString('zh-CN',{maximumFractionDigits:3}):'';
  return `<section class="panel">
    <h2>提交来源</h2>
    <form id="source-form" class="fields">
      ${photos?`<label class="field"><span>材料类型</span><select name="material_type"><option value="text">文字原文</option><option value="photo">照片</option></select></label>`:''}
      <div id="source-text-fields">
        <label class="field"><span>售后原文</span><textarea name="text" rows="7" required maxlength="${esc(policy.text_max_chars)}" aria-describedby="source-limit"></textarea></label>
        <p class="muted" id="source-limit">每份最多 ${esc(policy.text_max_chars)} 字符。</p>
      </div>
      ${photos?`<div id="source-photo-fields" hidden>
        <label class="field"><span>选择照片</span><input name="photo" type="file" accept="${esc(policy.photo_media_types.join(','))}" aria-describedby="source-photo-limit" disabled required></label>
        <p class="muted" id="source-photo-limit">每次 1 张 JPEG 或 PNG，最多 ${esc(photoLimit)} MiB、${esc((policy.photo_max_pixels/10000).toLocaleString('zh-CN'))} 万像素。开发环境由管理员核对留存。</p>
      </div>`:''}
      <details><summary>填写来源信息（可选）</summary>
        <div class="fields section-note">
          <label class="field"><span>来源类型</span><select name="source_kind"><option value="">未提供</option>${Object.entries(sourceKinds).map(([id,label])=>`<option value="${id}">${label}</option>`).join('')}</select></label>
          ${field('群名或纸本名称','source_label','','maxlength="100"')}
          ${field('纸本页码','page_label','','maxlength="40"')}
          ${field('消息时间（北京时间）','message_time','','','datetime-local')}
          ${field('备注','note','','maxlength="500"')}
        </div>
      </details>
      <div class="actions"><button class="primary" type="submit">保存原文</button></div>
    </form>
  </section>`;
}

function sourceList(result,offset,canWrite,shared=false){
  const page='#sources?'+(shared?'scope=shared&amp;':'')+'offset=';
  const rows=result.items.map(row=>`<article class="row">
    <div><h3>${esc(row.source_label||sourceKinds[row.source_kind]||(row.material_type==='photo'?'售后照片':'售后原文'))}</h3>
    <p>保存于 ${stamp(row.submitted_at)}${row.page_label?' · '+esc(row.page_label):''}</p>
    ${!shared&&row.can_delete===false?'<p class="muted">已关联档案或任务，保留原件。</p>':''}</div>
    <div class="actions"><a class="button" href="#source?id=${encodeURIComponent(row.id)}">查看原件</a>
      ${canWrite&&row.can_delete?`<button type="button" data-remove-source="${esc(row.id)}">删除</button>`:''}</div>
  </article>`).join('');
  return `${rows||`<p class="state">${shared?'这一页没有授权给你的来源。':'这一页没有来源。'}</p>`}
      <div class="actions">${offset>0?`<a class="button" href="${page+Math.max(0,offset-50)}">上一页</a>`:''}
      ${result.next_offset!==null?`<a class="button" href="${page+esc(result.next_offset)}">下一页</a>`:''}</div>`;
}

async function sourcesPage(params){
  const route=location.hash;
  if(!hasPermission('service.read'))throw new Error('当前账号无权查看售后来源。');
  const offset=Math.max(0,Number.parseInt(params.get('offset'),10)||0);
  const shared=params.get('scope')==='shared';
  const listPath='/sources?offset='+offset+(shared?'&scope=shared':'');
  const [policy,result]=await Promise.all([!shared&&hasPermission('service.draft')?api('/sources/policy'):null,api(listPath)]);
  if(route!==location.hash)return;
  const supportsReview=result.supports_review_access;
  if(shared&&!supportsReview){
    location.hash='sources';
    return;
  }
  shell('售后来源',supportsReview?'保存、查阅和移交售后材料':'保存和查阅自己提交的文字和照片',`<div class="grid ${policy?'opening-grid':''}">${policy?sourceForm(policy):''}
    <section class="panel">${supportsReview?`<nav class="actions" aria-label="来源范围">
      <a class="button ${shared?'':'primary'}" href="#sources" ${shared?'':'aria-current="page"'}>我的来源</a>
      <a class="button ${shared?'primary':''}" href="#sources?scope=shared" ${shared?'aria-current="page"':''}>授权给我</a>
    </nav>`:'<h2>我的来源</h2>'}<div id="source-list">${sourceList(result,offset,!!policy,shared)}</div></section></div>`,'',true);
  if(!policy)return;
  const list=$('#source-list');
  list.onclick=async event=>{
    const button=event.target.closest('[data-remove-source]');
    if(!button||button.disabled||!confirm('删除这份来源及其未归档草稿？'))return;
    try{
      await FormState.freezeWhile(list,async()=>{
        await api('/sources/'+encodeURIComponent(button.dataset.removeSource),'DELETE',{confirmed:true});
        if(!list.isConnected)return;
        button.closest('article').remove();
        try{
          const fresh=await api(listPath);
          if(list.isConnected)list.innerHTML=sourceList(fresh,offset,true);
        }catch{
          if(list.isConnected)notify('来源已删除。列表暂时无法刷新。');
        }
      });
    }catch(error){
      if(list.isConnected)notify(error.status===409?'该来源已被档案或任务引用，原件会保留。':error.message);
    }
  };
  const form=$('#source-form');
  const mode=form.elements.material_type, photo=form.elements.photo, original=form.elements.text;
  if(mode)mode.onchange=()=>{
    const isPhoto=mode.value==='photo';
    $('#source-text-fields').hidden=isPhoto;
    $('#source-photo-fields').hidden=!isPhoto;
    original.disabled=isPhoto;
    photo.disabled=!isPhoto;
    form.querySelector('button[type="submit"]').textContent=isPhoto?'保存照片':'保存原文';
  };
  let previousBody, requestId;
  form.onsubmit=async event=>{
    event.preventDefault();
    const body=Object.fromEntries(new FormData(form));
    const isPhoto=body.material_type==='photo';
    const file=isPhoto?photo.files[0]:null;
    delete body.material_type;
    delete body.photo;
    if(isPhoto&&(!file||file.size>policy.photo_max_bytes)){notify('请选择符合大小限制的照片。');return;}
    if(!isPhoto&&!body.text.trim()){notify('请填写售后原文。');return;}
    for(const name of ['source_kind','source_label','page_label','message_time','note']){
      body[name]=body[name].trim()||null;
    }
    if(body.message_time)body.message_time+='+08:00';
    try{
      const saved=await FormState.freezeWhile(form,async()=>{
        if(file)body.image_base64=await photoBase64(file);
        const contents=JSON.stringify(body);
        if(previousBody!==contents){previousBody=contents;requestId=crypto.randomUUID();}
        return api(isPhoto?'/sources/photos':'/sources','POST',{...body,request_id:requestId});
      });
      if(!saved?.id)throw new Error('Incomplete source response');
      if(form.isConnected)location.hash='source?id='+encodeURIComponent(saved.id);
    }catch{
      if(form.isConnected)notify('尚未核实来源保存结果。输入已保留，请核对格式后重试，或查看我的来源。');
    }
  };
}

function sourceMaterial(row){
  return row.material_type==='photo'?`<h2>照片原件</h2><div id="source-image-panel" hidden><img id="source-image" class="service-photo" alt="售后来源照片"></div>
    <div id="source-image-error" hidden><p class="state warning" role="status">原图暂不可查看。</p><button type="button" id="source-image-retry">重试读取</button></div>`
    :`<h2>原文</h2><pre class="service-source" tabindex="0">${esc(row.text)}</pre>`;
}

function bindSourcePhoto(row){
  if(row.material_type!=='photo')return;
  const originalUrl='/api/sources/'+encodeURIComponent(row.id)+'/original';
  const image=$('#source-image'), panel=$('#source-image-panel'), error=$('#source-image-error');
  image.onerror=()=>{panel.hidden=true;error.hidden=false;};
  image.onload=()=>{panel.hidden=false;error.hidden=true;};
  $('#source-image-retry').onclick=()=>{image.src=originalUrl+'?retry='+Date.now();};
  image.src=originalUrl;
}

function serviceReviewLink(sourceId,draftId){
  return '#service-draft?source='+encodeURIComponent(sourceId)+(draftId?'&draft='+encodeURIComponent(draftId):'');
}

function sourceReviewAccess(){
  return `<section class="panel"><details id="source-review-access"><summary>授权核对</summary>
    <div class="fields section-note">
      <div id="source-reviewers" aria-live="polite"></div>
      <form id="source-review-form" class="fields">
        ${field('接收人登录账号','username','','required maxlength="64" pattern="[A-Za-z0-9_.\\-]+" autocapitalize="none"')}
        <label class="check"><input name="confirmed" type="checkbox" required>允许此账号查看整份原件，并按职责核对全部关联草稿</label>
        <div class="actions"><button type="submit" class="primary">确认授权</button></div>
      </form>
      <p class="muted" id="source-review-status" role="status"></p>
    </div></details></section>`;
}

function bindSourceReviewAccess(path){
  const details=$('#source-review-access'), list=$('#source-reviewers');
  const form=$('#source-review-form'), status=$('#source-review-status');
  const accessPath=path+'/review-access';
  let previousUsername, requestId;
  async function refresh(){
    try{
      const {items}=await api(accessPath);
      list.innerHTML=items.map(({id,username})=>`<div class="row"><strong>${esc(username)}</strong>
        <button type="button" data-revoke-access="${esc(id)}" aria-label="撤销 ${esc(username)} 的授权">撤销授权</button></div>`).join('')
        ||'<p class="muted">暂无已授权账号。</p>';
    }catch{
      list.textContent='暂时无法读取授权列表。';
    }
  }
  details.ontoggle=()=>{if(details.open)refresh();};
  form.onsubmit=async event=>{
    event.preventDefault();
    const data=new FormData(form);
    const username=String(data.get('username')).trim();
    if(previousUsername!==username||!requestId){previousUsername=username;requestId=crypto.randomUUID();}
    try{
      await FormState.freezeWhile(details,async()=>{
        await api(accessPath,'POST',{username,confirmed:data.has('confirmed'),request_id:requestId});
        requestId=null;
        form.reset();
        status.textContent='授权已保存。接收人可在「授权给我」查看。';
        await refresh();
      });
    }catch(error){
      if(error.status===409){
        requestId=null;
        status.textContent='此账号已获授权或之前的授权已撤销，请核对列表后再操作。';
        await refresh();
      }else status.textContent=error.status===422?'请核对登录账号，并确认账号已启用且有售后核对权限。':error.message;
    }
  };
  list.onclick=async event=>{
    const button=event.target.closest('[data-revoke-access]');
    if(!button||button.disabled||!confirm('撤销后，此账号将无法打开这份原件及其草稿。继续撤销？'))return;
    try{
      await FormState.freezeWhile(details,async()=>{
        await api(accessPath+'/'+encodeURIComponent(button.dataset.revokeAccess),'DELETE',{confirmed:true});
        status.textContent='授权已撤销。';
        await refresh();
      });
    }catch(error){
      status.textContent=error.message;
    }
  };
}

async function sourcePage(params){
  const route=location.hash;
  if(!hasPermission('service.read'))throw new Error('当前账号无权查看售后来源。');
  const id=params.get('id');
  if(!id)throw new Error('请从我的来源选择原件。');
  const path='/sources/'+encodeURIComponent(id);
  const offset=Math.max(0,Number.parseInt(params.get('offset'),10)||0);
  const [row,drafts]=await Promise.all([api(path),api(path+'/drafts?offset='+offset).catch(()=>null)]);
  if(route!==location.hash)return;
  const photo=row.material_type==='photo';
  const canWrite=hasPermission('service.draft');
  const canManageAccess=canWrite&&row.owned_by_viewer;
  const entries=drafts?.items.map(draft=>`<article class="row"><div><h3>${esc(draft.fields.problem?.trim().slice(0,80)||'问题未填写')}</h3>
    <p>${stamp(draft.created_at)} · ${draft.archive?'已归档':'第 '+esc(draft.version)+' 版'}</p></div>
    <a class="button" data-draft-link href="${serviceReviewLink(row.id,draft.id)}">${draft.archive?'查看归档结果':'打开草稿'}</a></article>`).join('');
  const draftPage='#source?id='+encodeURIComponent(row.id)+'&amp;offset=';
  shell('来源原件',photo?'售后来源照片':'售后来源文字',`<div class="grid opening-grid">
    <section class="panel">${sourceMaterial(row)}</section>
    <div class="grid"><section class="panel"><h2>该来源的草稿</h2>
      ${drafts?entries||'<p class="muted">这一页没有草稿。</p>':'<p class="state warning" role="status">草稿列表暂时无法读取。</p>'}
      <div class="actions">
        ${canWrite&&!row.extracted_count?`<button class="primary" id="extract-service-drafts" type="button">${photo?'识别照片生成草稿':'从文字生成草稿'}</button>`:''}
        ${canWrite?`<a class="button" id="new-service-draft" href="${serviceReviewLink(row.id)}">新建草稿</a>`:''}
        ${offset>0?`<a class="button" href="${draftPage+Math.max(0,offset-50)}">上一页</a>`:''}
        ${drafts?.next_offset!=null?`<a class="button" href="${draftPage+esc(drafts.next_offset)}">下一页</a>`:''}
        ${drafts?'':'<button id="source-drafts-retry" type="button">重试草稿列表</button>'}
      </div>
      <p id="source-extraction-status" class="muted" role="status">${row.extracted_count
        ?'已生成 '+esc(row.extracted_count)+' 条，请对照原件逐条核对。'
        :canWrite?'每行填写一个“字段：内容”，多条记录用“第 1 条”“第 2 条”等标明。':''}</p>
    </section><section class="panel"><h2>来源信息</h2><dl>
      <dt>来源类型</dt><dd>${sourceKinds[row.source_kind]||'未提供'}</dd>
      <dt>群名或纸本名称</dt><dd>${esc(row.source_label||'未提供')}</dd>
      <dt>纸本页码</dt><dd>${esc(row.page_label||'未提供')}</dd>
      <dt>消息时间（北京时间）</dt><dd>${row.message_time?stamp(row.message_time):'未提供'}</dd>
      <dt>保存时间（北京时间）</dt><dd>${stamp(row.submitted_at)}</dd>
      ${row.note?`<dt>备注</dt><dd>${esc(row.note)}</dd>`:''}
    </dl></section>${canManageAccess?sourceReviewAccess():''}</div></div>`,'',true);
  bindSourcePhoto(row);
  if(canManageAccess)bindSourceReviewAccess(path);
  const retry=$('#source-drafts-retry');
  if(retry)retry.onclick=render;
  const extract=$('#extract-service-drafts');
  if(extract)extract.onclick=async()=>{
    const status=$('#source-extraction-status');
    extract.disabled=true;
    status.textContent=photo?'正在识别照片…':'正在读取文字…';
    try{
      await api(path+'/drafts/extract','POST');
      if(route===location.hash)await render();
    }catch(error){
      if(route!==location.hash)return;
      status.textContent=error.status===422?'未能从原件分出可用字段。你可以打开原件手工新建草稿。'
        :error.status===503?'照片暂时无法识别。你可以重试，或打开原件手工新建草稿。':error.message;
      extract.disabled=false;
    }
  };
}

const serviceReviewFields=[
  ['problem','问题描述',4000,true],['customer_name','客户称呼',100],['phone','手机号',100],
  ['address','服务地址',500,true],['model','设备型号',100],['error_code','故障码',100],
  ['treatment','处理方法',4000,true],['parts','更换配件',4000,true],['result','实际结果',4000,true],
];
const repairDateFormats={year:['年份','YYYY','[0-9]{4}'],month:['年和月','YYYY-MM','[0-9]{4}-[0-9]{2}'],
  day:['完整日期','YYYY-MM-DD','[0-9]{4}-[0-9]{2}-[0-9]{2}']};

function serviceReviewFlag(fields,name,label){
  return `<label class="check"><input type="checkbox" data-uncertain="${name}" aria-label="${label}待核对"
    ${fields.uncertain_fields?.includes(name)?'checked':''}>待核对</label>`;
}

function serviceReviewField(fields,[name,label,max,multiline]){
  const input=multiline?`<label class="field"><span>${label}</span><textarea name="${name}" maxlength="${max}" rows="2">${esc(fields[name])}</textarea></label>`
    :field(label,name,fields[name],`maxlength="${max}"`);
  return `<div>${input}${serviceReviewFlag(fields,name,label)}</div>`;
}

async function sourceDraftReviewPage(params){
  let route=location.hash;
  const sourceId=params.get('source'), draftId=params.get('draft');
  const canWrite=hasPermission('service.draft');
  if(!sourceId||!hasPermission('service.read')||(!draftId&&!canWrite)){
    throw new Error('请从有权查看的售后来源进入草稿。');
  }
  const sourcePath='/sources/'+encodeURIComponent(sourceId), draftsPath=sourcePath+'/drafts';
  const [source,saved]=await Promise.all([api(sourcePath),draftId?api(draftsPath+'/'+encodeURIComponent(draftId)):null]);
  if(route!==location.hash)return;
  let draft=saved;
  const writable=canWrite&&!draft?.archive;
  const fields=draft?.fields||{};
  const extra=serviceReviewFields.slice(6);
  const showExtra=extra.some(([name])=>fields[name]||fields.uncertain_fields?.includes(name));
  shell('售后草稿核对',draft?.archive?'查看归档回执和原件':'对照原件填写，每条记录单独保存',`<div class="grid service-compare service-review">
    <section class="panel service-review-original">${sourceMaterial(source)}
      ${source.source_label||source.page_label?`<p class="muted">${esc([source.source_label,source.page_label].filter(Boolean).join(' · '))}</p>`:''}
    </section>
    <section class="panel"><h2>${draft?.archive?'已归档字段':'待核对字段'}</h2>
      <div id="service-archive-receipt"></div>
      <form id="service-review-form">
        <fieldset class="service-review-fields fields" aria-label="待核对字段" ${writable?'':'disabled'}>
          ${writable?'<p class="muted">不确定的字段可以留空或标记为待核对。</p>':''}
          ${serviceReviewFields.slice(0,6).map(item=>serviceReviewField(fields,item)).join('')}
          <div>
            <label class="field"><span>维修日期精度</span><select name="repair_date_precision">
              ${[['unknown','未知'],...Object.entries(repairDateFormats).map(([key,[label]])=>[key,label])]
                .map(([key,label])=>`<option value="${key}" ${(fields.repair_date_precision||'unknown')===key?'selected':''}>${label}</option>`).join('')}
            </select></label>
            <div id="service-repair-date">${field('维修日期','repair_date',fields.repair_date,'maxlength="10" autocomplete="off"')}</div>
            ${serviceReviewFlag(fields,'repair_date','维修日期')}
          </div>
          <details ${showExtra?'open':''}><summary>处理方法、配件与实际结果</summary>
            <div class="fields">${extra.map(item=>serviceReviewField(fields,item)).join('')}</div>
          </details>
          ${writable?'<div class="actions"><button class="primary" type="submit">保存草稿</button></div>':''}
        </fieldset>
        <p id="service-review-status" class="section-note" role="status">${draft&&!draft.archive?'已保存 · 第 '+esc(draft.version)+' 版':''}</p>
        <button type="button" id="service-review-reload" hidden>放弃本次修改，载入最新版</button>
      </form>
      <div id="service-archive-actions" class="section-note" hidden></div>
    </section></div>`,'',true);
  bindSourcePhoto(source);
  const form=$('#service-review-form'), status=$('#service-review-status'), reload=$('#service-review-reload');
  const archivePanel=$(draft?.archive?'#service-archive-receipt':'#service-archive-actions');
  renderArchiveControls(archivePanel,source,draft,form);
  const precision=form.elements.repair_date_precision, date=form.elements.repair_date;
  const setPrecision=()=>{
    const format=repairDateFormats[precision.value];
    $('#service-repair-date').hidden=!format;
    date.disabled=!format;
    date.required=Boolean(format);
    date.pattern=format?.[2]||'';
    date.placeholder=format?.[1]||'';
  };
  precision.onchange=setPrecision;
  setPrecision();
  if(!writable)return;
  form.oninput=()=>{
    archivePanel.hidden=true;
    archivePanel.replaceChildren();
  };
  reload.onclick=()=>render();
  let requestId, previousFields;
  form.onsubmit=async event=>{
    event.preventDefault();
    const input=new FormData(form);
    const values=Object.fromEntries(serviceReviewFields.map(([name])=>[name,input.get(name)?.trim()?input.get(name):null]));
    values.repair_date_precision=precision.value;
    values.repair_date=input.get('repair_date');
    values.uncertain_fields=[...form.querySelectorAll('[data-uncertain]:checked')].map(control=>control.dataset.uncertain);
    const contents=JSON.stringify(values);
    if(previousFields!==contents){previousFields=contents;requestId=crypto.randomUUID();}
    status.className='section-note';
    status.textContent='正在保存草稿…';
    reload.hidden=true;
    try{
      const result=await FormState.freezeWhile(form,()=>draft
        ?api(draftsPath+'/'+encodeURIComponent(draft.id),'PUT',{version:draft.version,fields:values})
        :api(draftsPath,'POST',{request_id:requestId,fields:values}));
      if(!result?.id||!Number.isInteger(result.version))throw new Error('Incomplete draft response');
      if(!form.isConnected||route!==location.hash)return;
      draft=result;
      route=serviceReviewLink(source.id,draft.id);
      history.replaceState(history.state,'',route);
      status.className='section-note state success';
      status.textContent='草稿已保存 · 第 '+draft.version+' 版';
      renderArchiveControls(archivePanel,source,draft,form);
    }catch(error){
      if(!form.isConnected||route!==location.hash)return;
      status.className='section-note state warning';
      if(error.status===409&&draft){
        status.textContent='另一处已更新草稿。当前输入仍在，请核对后载入最新版。';
        reload.hidden=false;
      }else if(error.status===422){
        status.textContent='请核对日期和字段格式。当前输入已保留。';
      }else{
        status.textContent='保存结果尚未核实。请重试，或返回来源查看已保存的草稿。';
      }
    }
  };
}
