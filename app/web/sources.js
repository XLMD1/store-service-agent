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

async function sourcesPage(params){
  const route=location.hash;
  if(!hasPermission('service.read'))throw new Error('当前账号无权查看售后来源。');
  const offset=Math.max(0,Number.parseInt(params.get('offset'),10)||0);
  const [policy,result]=await Promise.all([
    hasPermission('service.draft')?api('/sources/policy'):null,
    api('/sources?offset='+offset),
  ]);
  if(route!==location.hash)return;
  const rows=result.items.map(row=>`<article class="row">
    <div><h3>${esc(row.source_label||sourceKinds[row.source_kind]||(row.material_type==='photo'?'售后照片':'售后原文'))}</h3>
    <p>保存于 ${stamp(row.submitted_at)}${row.page_label?' · '+esc(row.page_label):''}</p></div>
    <a class="button" href="#source?id=${encodeURIComponent(row.id)}">查看原件</a>
  </article>`).join('');
  shell('售后来源','保存和查阅自己提交的文字和照片',`<div class="grid opening-grid">${policy?sourceForm(policy):''}
    <section class="panel"><h2>我的来源</h2>${rows||'<p class="state">这一页没有来源。</p>'}
      <div class="actions">${offset>0?`<a class="button" href="#sources?offset=${Math.max(0,offset-50)}">上一页</a>`:''}
      ${result.next_offset!==null?`<a class="button" href="#sources?offset=${result.next_offset}">下一页</a>`:''}</div>
    </section></div>`,'',true);
  if(!policy)return;
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
  const entries=drafts?.items.map(draft=>`<article class="row"><div><h3>${esc(draft.fields.problem?.trim().slice(0,80)||'问题未填写')}</h3>
    <p>${stamp(draft.created_at)} · 第 ${esc(draft.version)} 版</p></div>
    <a class="button" data-draft-link href="${serviceReviewLink(row.id,draft.id)}">打开草稿</a></article>`).join('');
  const draftPage='#source?id='+encodeURIComponent(row.id)+'&amp;offset=';
  shell('来源原件',photo?'售后来源照片':'售后来源文字',`<div class="grid opening-grid">
    <section class="panel">${sourceMaterial(row)}</section>
    <div class="grid"><section class="panel"><h2>该来源的草稿</h2>
      ${drafts?entries||'<p class="muted">这一页没有草稿。</p>':'<p class="state warning" role="status">草稿列表暂时无法读取。</p>'}
      <div class="actions">
        ${hasPermission('service.draft')?`<a class="button primary" id="new-service-draft" href="${serviceReviewLink(row.id)}">新建草稿</a>`:''}
        ${offset>0?`<a class="button" href="${draftPage+Math.max(0,offset-50)}">上一页</a>`:''}
        ${drafts?.next_offset!=null?`<a class="button" href="${draftPage+esc(drafts.next_offset)}">下一页</a>`:''}
        ${drafts?'':'<button id="source-drafts-retry" type="button">重试草稿列表</button>'}
      </div>
    </section><section class="panel"><h2>来源信息</h2><dl>
      <dt>来源类型</dt><dd>${sourceKinds[row.source_kind]||'未提供'}</dd>
      <dt>群名或纸本名称</dt><dd>${esc(row.source_label||'未提供')}</dd>
      <dt>纸本页码</dt><dd>${esc(row.page_label||'未提供')}</dd>
      <dt>消息时间（北京时间）</dt><dd>${row.message_time?stamp(row.message_time):'未提供'}</dd>
      <dt>保存时间（北京时间）</dt><dd>${stamp(row.submitted_at)}</dd>
      ${row.note?`<dt>备注</dt><dd>${esc(row.note)}</dd>`:''}
    </dl></section></div></div>`,'',true);
  bindSourcePhoto(row);
  const retry=$('#source-drafts-retry');
  if(retry)retry.onclick=render;
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
  const writable=hasPermission('service.draft');
  if(!sourceId||!hasPermission('service.read')||(!draftId&&!writable)){
    throw new Error('请从有权查看的售后来源进入草稿。');
  }
  const sourcePath='/sources/'+encodeURIComponent(sourceId), draftsPath=sourcePath+'/drafts';
  const [source,saved]=await Promise.all([api(sourcePath),draftId?api(draftsPath+'/'+encodeURIComponent(draftId)):null]);
  if(route!==location.hash)return;
  let draft=saved;
  const fields=draft?.fields||{};
  const extra=serviceReviewFields.slice(6);
  const showExtra=extra.some(([name])=>fields[name]||fields.uncertain_fields?.includes(name));
  shell('售后草稿核对','对照原件填写，每条记录单独保存',`<div class="grid service-compare service-review">
    <section class="panel service-review-original">${sourceMaterial(source)}
      ${source.source_label||source.page_label?`<p class="muted">${esc([source.source_label,source.page_label].filter(Boolean).join(' · '))}</p>`:''}
    </section>
    <section class="panel"><h2>待核对字段</h2>
      <form id="service-review-form">
        <fieldset class="service-review-fields fields" aria-label="待核对字段" ${writable?'':'disabled'}>
          <p class="muted">不确定的字段可以留空或标记为待核对。</p>
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
          <div class="actions"><button class="primary" type="submit">保存草稿</button></div>
        </fieldset>
        <p id="service-review-status" class="section-note" role="status">${draft?'已保存 · 第 '+esc(draft.version)+' 版':''}</p>
        <button type="button" id="service-review-reload" hidden>放弃本次修改，载入最新版</button>
      </form>
    </section></div>`,'',true);
  bindSourcePhoto(source);
  const form=$('#service-review-form'), status=$('#service-review-status'), reload=$('#service-review-reload');
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
