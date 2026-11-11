'use strict';

const sourceKinds={chat:'群消息',paper:'纸本',other:'其他'};

async function sourcesPage(params){
  const route=location.hash;
  if(!hasPermission('service.read'))throw new Error('当前账号无权查看售后来源。');
  const offset=Math.max(0,Number.parseInt(params.get('offset'),10)||0);
  const [policy,result]=await Promise.all([
    hasPermission('service.draft')?api('/sources/policy'):null,
    api('/sources?offset='+offset),
  ]);
  if(route!==location.hash)return;
  const upload=policy?`<section class="panel">
    <h2>提交原文</h2>
    <form id="source-form" class="fields">
      <label class="field"><span>售后原文</span><textarea name="text" rows="7" required maxlength="${esc(policy.text_max_chars)}" aria-describedby="source-limit"></textarea></label>
      <p class="muted" id="source-limit">每份最多 ${esc(policy.text_max_chars)} 字符，保存后可从我的来源查看。</p>
      <details><summary>填写来源信息（可选）</summary>
        <div class="fields section-note">
          <label class="field"><span>来源类型</span><select name="source_kind"><option value="">未提供</option>${Object.entries(sourceKinds).map(([id,label])=>`<option value="${id}">${label}</option>`).join('')}</select></label>
          ${field('群名或纸本名称','source_label','','maxlength="100"')}
          ${field('纸本页码','page_label','','maxlength="40"')}
          ${field('消息时间（北京时间）','message_time','','','datetime-local')}
          ${field('备注','note','','maxlength="500"')}
        </div>
      </details>
      <div class="actions"><button class="primary">保存原文</button></div>
    </form>
  </section>`:'';
  const rows=result.items.map(row=>`<article class="row">
    <div><h3>${esc(row.source_label||sourceKinds[row.source_kind]||'售后原文')}</h3>
    <p>保存于 ${stamp(row.submitted_at)}${row.page_label?' · '+esc(row.page_label):''}</p></div>
    <a class="button" href="#source?id=${encodeURIComponent(row.id)}">查看原件</a>
  </article>`).join('');
  shell('售后来源','保存和查阅自己提交的售后原文',`<div class="grid opening-grid">${upload}
    <section class="panel"><h2>我的来源</h2>${rows||'<p class="state">这一页没有来源。</p>'}
      <div class="actions">${offset>0?`<a class="button" href="#sources?offset=${Math.max(0,offset-50)}">上一页</a>`:''}
      ${result.next_offset!==null?`<a class="button" href="#sources?offset=${result.next_offset}">下一页</a>`:''}</div>
    </section></div>`,'',true);
  if(!policy)return;
  const form=$('#source-form');
  let previousBody, requestId;
  form.onsubmit=async event=>{
    event.preventDefault();
    const body=Object.fromEntries(new FormData(form));
    if(!body.text.trim()){notify('请填写售后原文。');return;}
    for(const name of ['source_kind','source_label','page_label','message_time','note']){
      body[name]=body[name].trim()||null;
    }
    if(body.message_time)body.message_time+='+08:00';
    const contents=JSON.stringify(body);
    if(previousBody!==contents){previousBody=contents;requestId=crypto.randomUUID();}
    try{
      const saved=await FormState.freezeWhile(form,()=>api('/sources','POST',{...body,request_id:requestId}));
      if(!saved?.id)throw new Error('Incomplete source response');
      if(form.isConnected)location.hash='source?id='+encodeURIComponent(saved.id);
    }catch{
      if(form.isConnected)notify('尚未核实原文保存结果。输入已保留，可用相同内容重试，或查看我的来源。');
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
  shell('来源原件','已保存的售后原文',`<div class="grid opening-grid">
    <section class="panel"><h2>原文</h2><pre class="service-source">${esc(row.text)}</pre></section>
    <section class="panel"><h2>来源信息</h2><dl>
      <dt>来源类型</dt><dd>${sourceKinds[row.source_kind]||'未提供'}</dd>
      <dt>群名或纸本名称</dt><dd>${esc(row.source_label||'未提供')}</dd>
      <dt>纸本页码</dt><dd>${esc(row.page_label||'未提供')}</dd>
      <dt>消息时间（北京时间）</dt><dd>${row.message_time?stamp(row.message_time):'未提供'}</dd>
      <dt>保存时间（北京时间）</dt><dd>${stamp(row.submitted_at)}</dd>
      ${row.note?`<dt>备注</dt><dd>${esc(row.note)}</dd>`:''}
    </dl><a class="button" href="#sources">返回我的来源</a></section></div>`,'',true);
}
