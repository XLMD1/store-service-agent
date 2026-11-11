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

async function sourcePage(params){
  const route=location.hash;
  if(!hasPermission('service.read'))throw new Error('当前账号无权查看售后来源。');
  const id=params.get('id');
  if(!id)throw new Error('请从我的来源选择原件。');
  const row=await api('/sources/'+encodeURIComponent(id));
  if(route!==location.hash)return;
  const photo=row.material_type==='photo';
  const originalUrl='/api/sources/'+encodeURIComponent(row.id)+'/original';
  const material=photo?`<h2>照片原件</h2><div id="source-image-panel" hidden><img id="source-image" class="service-photo" alt="售后来源照片"></div>
    <div id="source-image-error" hidden><p class="state warning" role="status">原图暂不可查看。</p><button type="button" id="source-image-retry">重试读取</button></div>`
    :`<h2>原文</h2><pre class="service-source">${esc(row.text)}</pre>`;
  shell('来源原件',photo?'售后来源照片':'售后来源文字',`<div class="grid opening-grid">
    <section class="panel">${material}</section>
    <section class="panel"><h2>来源信息</h2><dl>
      <dt>来源类型</dt><dd>${sourceKinds[row.source_kind]||'未提供'}</dd>
      <dt>群名或纸本名称</dt><dd>${esc(row.source_label||'未提供')}</dd>
      <dt>纸本页码</dt><dd>${esc(row.page_label||'未提供')}</dd>
      <dt>消息时间（北京时间）</dt><dd>${row.message_time?stamp(row.message_time):'未提供'}</dd>
      <dt>保存时间（北京时间）</dt><dd>${stamp(row.submitted_at)}</dd>
      ${row.note?`<dt>备注</dt><dd>${esc(row.note)}</dd>`:''}
    </dl></section></div>`,'',true);
  if(photo){
    const image=$('#source-image'), panel=$('#source-image-panel'), error=$('#source-image-error');
    image.onerror=()=>{panel.hidden=true;error.hidden=false;};
    image.onload=()=>{panel.hidden=false;error.hidden=true;};
    $('#source-image-retry').onclick=()=>{image.src=originalUrl+'?retry='+Date.now();};
    image.src=originalUrl;
  }
}
