'use strict';

const knowledgePath='/knowledge/versions';
const knowledgeStates={pending_review:'待审核',reviewed:'已核对',published:'已发布',retired:'已停用'};
const knowledgeActions={review:'确认核对',publish:'确认发布',retire:'确认停用'};

function scanFields(){
  return `<fieldset class="reservation fields" data-manual-scan><legend>扫描件</legend>
    <label class="field"><span>原始图片</span><input name="scan" type="file" accept="image/png,image/jpeg" required></label>
    <div class="grid two">
      ${field('起始印刷页码','first_page',1,'required min="1" max="9999"','number')}
      ${field('结束印刷页码','last_page',1,'required min="1" max="9999"','number')}
      ${field('开头无页码页数','leading_pages',0,'required min="0" max="20"','number')}
      ${field('末尾无页码页数','trailing_pages',0,'required min="0" max="20"','number')}
    </div><div><button type="button" data-remove-manual-scan>移除此扫描件</button></div>
  </fieldset>`;
}

function manualImport(){
  return `<section class="panel"><details><summary>导入说明书</summary><form id="knowledge-import" class="fields">
    ${field('资料名称','title','','required maxlength="200"')}
    <div class="grid two">
      ${field('资料编号','document_code','','required maxlength="80"')}
      ${field('版次','edition','','required maxlength="80" placeholder="例如 B 或 未知"')}
    </div>
    <label class="field"><span>适用型号（每行一款，照封面填写）</span><textarea name="models" rows="3" maxlength="3200" required></textarea></label>
    <p class="muted">上传 PNG 或 JPEG，每张最多 8 MiB，合计最多 20 MiB。长图的每一页需等高，按印刷页码顺序添加。</p>
    <div data-manual-scans>${scanFields()}</div>
    <div><button type="button" data-add-manual-scan>添加扫描件</button></div>
    ${check('已核对文件顺序、版次和印刷页码。')}
    <button class="primary" type="submit">保存并提交审核</button>
    <p role="status" data-manual-status></p>
  </form></details></section>`;
}

function bindManualImport(form){
  const scans=form.querySelector('[data-manual-scans]');
  const add=form.querySelector('[data-add-manual-scan]');
  const status=form.querySelector('[data-manual-status]');
  const refresh=()=>{
    scans.querySelectorAll('[data-remove-manual-scan]').forEach(button=>{button.hidden=scans.children.length===1;});
    add.disabled=scans.children.length>=40;
  };
  refresh();
  add.onclick=()=>{scans.insertAdjacentHTML('beforeend',scanFields());refresh();scans.lastElementChild.querySelector('input').focus();};
  scans.onclick=event=>{
    const remove=event.target.closest('[data-remove-manual-scan]');
    if(remove&&scans.children.length>1){remove.closest('[data-manual-scan]').remove();refresh();add.focus();}
  };
  let previous, requestId;
  form.onsubmit=async event=>{
    event.preventDefault();
    const data=new FormData(form);
    const rows=[...scans.children];
    const files=rows.map(row=>row.querySelector('input[type=file]').files[0]);
    const limit=1024*1024;
    if(files.some(file=>!file||file.size>8*limit)||files.reduce((sum,file)=>sum+file.size,0)>20*limit){
      status.textContent='扫描件大小超出限制。';
      return;
    }
    status.textContent='正在检查并保存扫描件…';
    try{
      const saved=await FormState.freezeWhile(form,async()=>{
        const parts=[];
        for(const [index,row] of rows.entries()){
          const metadata=Object.fromEntries(['first_page','last_page','leading_pages','trailing_pages']
            .map(name=>[name,Number(row.querySelector(`input[name="${name}"]`).value)]));
          parts.push({...metadata,image_base64:await photoBase64(files[index])});
        }
        const body={title:data.get('title'),document_code:data.get('document_code'),edition:data.get('edition'),
          models:String(data.get('models')).split(/\r?\n/).map(line=>line.trim()).filter(Boolean),
          confirmed:data.has('confirmed'),scans:parts};
        const fingerprint=JSON.stringify(body);
        if(previous!==fingerprint){previous=fingerprint;requestId=crypto.randomUUID();}
        return api(knowledgePath,'POST',{...body,request_id:requestId});
      });
      if(form.isConnected)location.hash='knowledge?id='+encodeURIComponent(saved.id);
    }catch(error){
      if(form.isConnected)status.textContent=error.status===422?'请核对图片格式、连续页码和长图的等高页数。'
        :error.status===409?'此编号和版次已登记，请核对现有资料。':error.message;
    }
  };
}

async function knowledgePage(params,keepViewer=false){
  if(!hasPermission('knowledge.read'))throw new Error('当前账号无权查看维修资料。');
  const route=location.hash, id=params.get('id');
  if(id){
    const viewer=keepViewer?$('#knowledge-page-number'):null;
    if(viewer?.dataset.manualId===id)viewer.showPage(params.get('page'));
    else await knowledgeDetail(id,params,route);
    return;
  }
  const offset=Math.max(0,Number.parseInt(params.get('offset'),10)||0);
  const [data,searchData]=await Promise.all([
    api(knowledgePath+'?offset='+offset),
    hasPermission('knowledge.search')?api('/knowledge/search/models'):null,
  ]);
  if(route!==location.hash)return;
  const canImport=hasPermission('knowledge.review')||hasPermission('knowledge.publish');
  shell('维修资料','查阅说明书和适用型号',`${searchData?manualSearch(searchData.models):''}<section class="panel"><h2>资料版本</h2>
    ${data.items.map(row=>`<article class="row"><div><h3>${esc(row.title)}</h3>
      <p>${esc(row.document_code)} · ${esc(row.edition)} · ${knowledgeStates[row.state]}</p>
      <p>${esc(row.models.join('、'))}</p></div>
      <a class="button" href="#knowledge?id=${encodeURIComponent(row.id)}">查看资料</a></article>`).join('')
      ||'<p class="state">当前没有可查看的资料。</p>'}
    <div class="actions">${offset?'<a class="button" href="#knowledge?offset='+Math.max(0,offset-50)+'">上一页</a>':''}
      ${data.next_offset!=null?'<a class="button" href="#knowledge?offset='+esc(data.next_offset)+'">下一页</a>':''}</div>
    </section>${experiencePanel()}${canImport?manualImport():''}`,'',true);
  bindExperiencePanel($('#repair-cases'));
  if(canImport)bindManualImport($('#knowledge-import'));
  if(searchData?.models.length)bindManualSearch($('#knowledge-search'));
}

const caseStates={pending_review:'待核对',reviewed:'已核对',rejected:'未通过'};

function experiencePanel(){
  const manage=hasPermission('knowledge.review');
  return `<section class="panel"><details id="repair-cases"><summary>维修经验案例</summary>
    <p class="muted">按完整型号查门店案例。厂家处理建议可在维修辅助中查看。</p>
    ${manage?`<details><summary>提交案例</summary><form class="fields" data-case-submit>
      ${field('完整型号','model','','required maxlength="100"')}
      ${field('故障码或现象','problem','','required maxlength="2000"')}
      <label class="field"><span>现场检查条件</span><textarea required name="conditions" maxlength="2000"></textarea></label>
      <label class="field"><span>处理经过及实际结果</span><textarea required name="outcome" maxlength="2000"></textarea></label>
      ${check('已核对事实，并去除客户姓名、电话和详细地址。')}
      <button class="primary">保存并提交核对</button><p role="status"></p>
    </form></details>`:''}
    <form class="fields" data-case-search><div class="grid two">
      ${field('按完整型号筛选','model','','maxlength="100"')}
      <label class="field"><span>核对状态</span><select name="state">
        ${(manage?['pending_review','reviewed','rejected']:['reviewed']).map(key=>`<option value="${key}">${caseStates[key]}</option>`).join('')}
      </select></label></div><div><button>查询案例</button></div></form>
    <p role="status" data-case-status></p><div data-case-list></div>
    <button type="button" data-case-next hidden>下一页案例</button>
  </details></section>`;
}

function caseRow(row){
  const review=row.state==='pending_review'&&hasPermission('knowledge.review');
  return `<article class="service-row"><h3>${esc(row.problem)}</h3>
    <p>${esc(row.model)} · ${esc(caseStates[row.state])} · ${esc(row.submitted_by)} 提交</p>
    <dl><dt>检查条件</dt><dd>${esc(row.conditions)}</dd><dt>经过及结果</dt><dd>${esc(row.outcome)}</dd></dl>
    ${row.reviewed_at?`<p>核对人 ${esc(row.reviewed_by)} · ${esc(stamp(row.reviewed_at))}</p><p>${esc(row.review_note)}</p>`:''}
    ${review?`<form class="fields" data-case-review="${esc(row.id)}">
      <label class="field"><span>核对结果</span><select required name="decision"><option value="">请选择</option>
        <option value="reviewed">通过</option><option value="rejected">未通过</option></select></label>
      ${field('核对依据','note','','required maxlength="1000"')}${check('已核对型号、条件和结果。')}
      <button>保存核对结果</button><p role="status"></p></form>`:''}</article>`;
}

function bindExperiencePanel(panel){
  const search=panel.querySelector('[data-case-search]'),list=panel.querySelector('[data-case-list]');
  const next=panel.querySelector('[data-case-next]'),status=panel.querySelector('[data-case-status]');
  let generation=0,query,nextOffset;
  async function load(offset=0){
    const current=++generation;
    const params=new URLSearchParams(query);
    params.set('offset',String(offset));
    next.hidden=true;
    status.textContent='正在查询案例…';
    try{
      const result=await api('/repair/cases?'+params);
      if(current!==generation)return;
      list.innerHTML=result.items.map(caseRow).join('');
      status.textContent=result.items.length?'':'此条件下暂无案例。';
      nextOffset=result.next_offset;
      next.hidden=nextOffset==null;
    }catch(error){if(current===generation){list.replaceChildren();status.textContent=error.message;}}
  }
  function searchCases(){
    query=new URLSearchParams({state:search.elements.state.value});
    const model=search.elements.model.value.trim();
    if(model)query.set('model',model);
    return load();
  }
  panel.ontoggle=event=>{if(event.target===panel&&panel.open&&!query)searchCases();};
  search.onsubmit=event=>{event.preventDefault();searchCases();};
  next.onclick=()=>load(nextOffset);
  panel.addEventListener('submit',async event=>{
    const form=event.target;
    if(form===search||form.tagName!=='FORM')return;
    event.preventDefault();
    const review=form.dataset.caseReview;
    const payload=Object.fromEntries(new FormData(form));
    payload.confirmed=form.elements.confirmed.checked;
    const fingerprint=JSON.stringify(payload);
    if(form.dataset.fingerprint!==fingerprint){
      form.dataset.fingerprint=fingerprint;
      form.dataset.requestId=crypto.randomUUID();
    }
    const message=form.querySelector('[role=status]');
    try{
      await FormState.freezeWhile(form,()=>api(review?'/repair/cases/'+encodeURIComponent(review)+'/review':'/repair/cases',
        'POST',{...payload,request_id:form.dataset.requestId}));
      form.reset();
      message.textContent='';
      delete form.dataset.fingerprint;
      if(!review){search.elements.state.value='pending_review';search.elements.model.value=String(payload.model);}
      await searchCases();
      const receipt=review?'核对结果已保存。':'案例已保存，等待核对。';
      status.textContent=receipt+status.textContent;
    }catch(error){
      if(review&&error.status===409){
        await searchCases();
        status.textContent='此案例的核对状态已变化。'+status.textContent;
      }else message.textContent=error.message;
    }
  });
}

function manualSearch(models){
  return `<section class="panel"><h2>查说明书原页</h2>
    ${models.length?`<form id="knowledge-search" class="fields">
      <div class="grid two"><label class="field"><span>完整型号</span><select name="model" required>
        <option value="">请选择型号</option>
        ${models.map(model=>`<option value="${esc(model)}">${esc(model)}</option>`).join('')}
      </select></label>
      ${field('故障码或关键词','query','','required maxlength="200" placeholder="例如 E3 或 温度"')}</div>
      <div><button type="submit" class="primary">查找原页</button></div>
    </form><p data-search-status class="section-note" role="status"></p><div data-search-results></div>`
      :'<p class="muted">资料发布后，才会列出可检索的型号。</p>'}</section>`;
}

function bindManualSearch(form){
  const status=form.parentElement.querySelector('[data-search-status]');
  const results=form.parentElement.querySelector('[data-search-results]');
  form.oninput=()=>{
    status.textContent='';
    results.replaceChildren();
  };
  form.onsubmit=async event=>{
    event.preventDefault();
    const query=form.elements.query.value.trim();
    if(!query){status.textContent='请填写故障码或关键词。';return;}
    const model=form.elements.model.value;
    status.textContent='正在查找原页…';
    results.replaceChildren();
    try{
      const data=await FormState.freezeWhile(form,()=>api('/knowledge/search','POST',{model,query}));
      if(!form.isConnected)return;
      status.textContent={
        unsupported_model:'该型号当前没有已发布资料。',no_index:'该型号的资料暂未登记可检索页面。',
        no_match:'在该型号已登记的页面中未找到匹配项。',
      }[data.status]||`找到 ${data.items.length} 条${data.has_more?'，可加关键词缩小范围':''}。`;
      results.innerHTML=data.items.map(row=>`<article class="row"><div><h3>${esc(row.page_title)}</h3>
        <p>${esc(row.title)} · ${esc(row.edition)} · 印刷第 ${esc(row.page)} 页</p>
        <p>${esc(row.keywords)}</p></div><a class="button" target="_blank" rel="noopener"
        href="#knowledge?id=${encodeURIComponent(row.version_id)}&amp;page=${encodeURIComponent(row.page)}">查看引用原页</a></article>`).join('');
    }catch(error){
      if(form.isConnected)status.textContent=error.message;
    }
  };
}

function manualIndexEditor(){
  return `<details id="manual-page-index"><summary>登记本页检索词</summary>
    <p class="muted" data-index-status role="status"></p>
    <form class="fields" hidden>
      ${field('原页标题','title','','required maxlength="200"')}
      <label class="field"><span>故障码或关键词</span><textarea name="keywords" rows="3" required maxlength="2000"></textarea></label>
      ${check('已对照本页原文核实标题和关键词。')}
      <button type="submit" class="primary">保存本页检索词</button>
    </form></details>`;
}

function bindManualIndex(editor,path){
  const form=editor.querySelector('form'), status=editor.querySelector('[data-index-status]');
  let page, revision, request=0;
  editor.ontoggle=async()=>{
    if(!editor.open)return;
    const current=++request;
    form.hidden=true;
    status.textContent='正在读取本页检索词…';
    try{
      const entry=await api(path+'/pages/'+page+'/index');
      if(current!==request||!editor.open||!editor.isConnected)return;
      revision=entry.revision;
      form.elements.title.value=entry.title;
      form.elements.keywords.value=entry.keywords;
      form.elements.confirmed.checked=false;
      form.hidden=false;
      status.textContent='印刷第 '+page+' 页';
    }catch(error){
      if(current===request&&editor.isConnected)status.textContent=error.message;
    }
  };
  form.onsubmit=async event=>{
    event.preventDefault();
    const current=request, payload={revision,title:form.elements.title.value.trim(),
      keywords:form.elements.keywords.value.trim(),confirmed:form.elements.confirmed.checked};
    try{
      const saved=await FormState.freezeWhile(form,()=>api(path+'/pages/'+page+'/index','PUT',payload));
      if(current!==request||!editor.isConnected)return;
      revision=saved.revision;
      form.elements.confirmed.checked=false;
      status.textContent='已保存印刷第 '+page+' 页的检索词。';
    }catch(error){
      if(current===request&&editor.isConnected)status.textContent=error.status===409
        ?'资料状态或本页词条已变化，请关闭后重新打开核对。':error.message;
    }
  };
  return number=>{
    if(page===number)return;
    page=number;
    request++;
    editor.open=false;
    form.hidden=true;
  };
}

function manualBatchPanel(first,last,page){
  const start=Math.max(first,Math.min(last,page||first));
  const bounds=`required min="${first}" max="${last}"`;
  return `<section class="panel" data-manual-batch><details><summary>批量识别检索词</summary>
    <form class="fields" data-batch-range><div class="grid two">
      ${field('起始印刷页码','first_page',start,bounds,'number')}
      ${field('结束印刷页码','last_page',Math.min(last,start+4),bounds,'number')}
    </div><p class="muted">每次最多选择 30 页。识别后请对照原页核对故障码、关键词和原文摘录。</p>
      <div class="actions"><button type="submit" class="primary">识别页码范围</button>
        <button type="submit" data-batch-load>载入草稿</button></div>
    </form>
    <p data-batch-status role="status" aria-live="polite"></p>
    <form class="fields" data-batch-review hidden><div data-batch-rows></div>
      <div class="fields" data-batch-confirm>${check('我已对照原页核实选中的检索词及保留的原文摘录。')}
        <button type="submit" class="primary">确认选中页</button></div>
    </form>
  </details></section>`;
}

function manualBatchRow(row){
  const failed=row.status==='failed';
  const current=row.current;
  const label=failed?'识别失败':row.status==='needs_review'?'需重点核对':'待核对';
  return `<details data-index-draft="${row.page}" data-revision="${row.revision}" data-status="${esc(row.status)}">
    <summary>印刷第 ${row.page} 页 <span class="badge" data-draft-label>${label}${current?' · 已登记':''}</span></summary>
    <div class="fields">
      <div><a href="${esc(row.original_url)}" target="_blank" rel="noopener">打开第 ${row.page} 页原图</a></div>
      ${row.status!=='ready'?`<div><button type="button" data-batch-retry>重试第 ${row.page} 页</button></div>`:''}
      ${failed?'':`
        ${current?`<p class="muted">已登记检索词 · ${esc(current.keywords)}</p>`:''}
        <label class="check"><input type="checkbox" name="selected"><span>确认第 ${row.page} 页</span></label>
        ${field('原页标题','title',current?.title||row.title,'maxlength="200"')}
        <label class="field"><span>故障码或关键词</span><textarea name="keywords" rows="2" maxlength="2000">${esc(current?.keywords||row.keywords)}</textarea></label>
        ${current&&row.keywords?`<p class="muted">识别候选 · ${esc(row.keywords)}</p>`:''}
        <label class="field"><span>原文摘录（可清空或仅保留已核实段落）</span>
          <textarea name="source_excerpt" rows="5" maxlength="8000">${esc(current?.source_excerpt||row.source_excerpt)}</textarea></label>`}
    </div></details>`;
}

function bindManualBatch(panel,path){
  const range=panel.querySelector('[data-batch-range]'), review=panel.querySelector('[data-batch-review]');
  const rows=panel.querySelector('[data-batch-rows]'), status=panel.querySelector('[data-batch-status]');
  const endpoint=path+'/index-drafts';
  let working=false;
  const run=async action=>{
    if(working)return;
    working=true;
    try{await FormState.freezeWhile(panel,action);}
    catch(error){if(panel.isConnected)status.textContent=error.status===409?'资料或检索词已变化，请载入草稿核对。':error.message;}
    finally{working=false;}
  };
  const recognize=(first,last,retry=false)=>api(endpoint+'/recognize','POST',{first_page:first,last_page:last,retry});
  const show=(items,first,last)=>{
    rows.innerHTML=items.map(manualBatchRow).join('');
    const firstRow=rows.firstElementChild;
    if(firstRow)firstRow.open=true;
    review.hidden=!items.length;
    review.querySelector('[data-batch-confirm]').hidden=!items.some(row=>row.status!=='failed');
    review.elements.confirmed.checked=false;
    const failed=items.filter(row=>row.status==='failed').length;
    status.textContent=items.length?`第 ${first}～${last} 页有 ${items.length} 条草稿${failed?`，${failed} 页可重试`:''}。`:'此范围暂无草稿。';
  };
  range.onsubmit=event=>{
    event.preventDefault();
    const first=Number(range.elements.first_page.value), last=Number(range.elements.last_page.value);
    if(last<first||last-first+1>30){status.textContent='请选择连续的印刷页码，最多 30 页。';return;}
    const load=event.submitter?.hasAttribute('data-batch-load');
    run(async()=>{
      if(!load){
        for(let page=first;page<=last&&panel.isConnected;page+=5){
          const end=Math.min(last,page+4);
          status.textContent=`正在识别第 ${page}～${end} 页…`;
          await recognize(page,end);
        }
      }
      if(!panel.isConnected)return;
      const result=await api(`${endpoint}?first_page=${first}&last_page=${last}`);
      if(panel.isConnected)show(result.items,first,last);
    });
  };
  rows.onclick=event=>{
    const button=event.target.closest('[data-batch-retry]');
    if(!button)return;
    const record=button.closest('[data-index-draft]'), page=Number(record.dataset.indexDraft);
    const edited=[...record.querySelectorAll('input[type=text],textarea')]
      .filter(input=>input.value!==input.defaultValue).map(input=>[input.name,input.value]);
    run(async()=>{
      status.textContent=`正在重试第 ${page} 页…`;
      const {items:[item]}=await recognize(page,page,true);
      if(!panel.isConnected)return;
      record.outerHTML=manualBatchRow(item);
      const updated=rows.querySelector(`[data-index-draft="${page}"]`);
      updated.open=true;
      for(const [name,value] of edited){
        const input=updated.querySelector(`[name="${name}"]`);
        if(input)input.value=value;
      }
      if(item.status!=='failed')review.querySelector('[data-batch-confirm]').hidden=false;
      review.elements.confirmed.checked=false;
      status.textContent=item.status==='failed'?`第 ${page} 页暂未识别，可打开原图手工登记。`:`第 ${page} 页识别完成，请核对。`;
    });
  };
  review.oninput=event=>{
    if(event.target!==review.elements.confirmed)review.elements.confirmed.checked=false;
  };
  review.onsubmit=event=>{
    event.preventDefault();
    const selected=[...rows.querySelectorAll('[data-index-draft]')].filter(row=>row.querySelector('[name=selected]')?.checked);
    if(!selected.length){status.textContent='请选择已核对的页面。';return;}
    const entries=selected.map(row=>({page:Number(row.dataset.indexDraft),revision:Number(row.dataset.revision),
      ...Object.fromEntries(['title','keywords','source_excerpt'].map(key=>[key,row.querySelector(`[name="${key}"]`).value.trim()]))}));
    const incomplete=entries.find(entry=>!entry.title||!entry.keywords);
    if(incomplete){status.textContent=`请填写第 ${incomplete.page} 页的标题和检索词。`;return;}
    run(async()=>{
      const result=await api(endpoint+'/confirm','POST',{confirmed:review.elements.confirmed.checked,entries});
      if(!panel.isConnected)return;
      for(const saved of result.items){
        const row=rows.querySelector(`[data-index-draft="${saved.page}"]`);
        row.dataset.revision=saved.revision;
        row.querySelector('[name=selected]').checked=false;
        row.querySelector('[data-draft-label]').textContent='已登记';
      }
      review.elements.confirmed.checked=false;
      status.textContent=`已确认 ${result.items.length} 页，可按型号和检索词查原页。`;
    });
  };
}

function openManualPreview(event){
  const link=event.target.closest('a[data-manual-preview]');
  if(!link||!link.dataset.manualPreview||event.defaultPrevented||event.button!==0||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
  event.preventDefault();
  const title=link.dataset.manualPreviewTitle||link.textContent.trim();
  const dialog=document.createElement('dialog');
  dialog.className='service-reader manual-reader';
  dialog.setAttribute('aria-labelledby','manual-reader-title');
  dialog.innerHTML=`<div class="section-head"><h2 id="manual-reader-title">${esc(title)}</h2>
      <button type="button" autofocus>关闭</button></div>
    <div class="manual-reader-tools"><button type="button" data-manual-size disabled>查看原始大小</button>
      <p class="muted" data-manual-status role="status">正在加载原图…</p></div>
    <div class="manual-reader-viewport" role="region" aria-label="说明书原图" tabindex="0"><img alt="${esc(title)}"></div>`;
  const image=dialog.querySelector('img'), viewport=image.parentElement;
  const size=dialog.querySelector('[data-manual-size]'), status=dialog.querySelector('[data-manual-status]');
  const close=()=>dialog.close();
  dialog.querySelector('[autofocus]').onclick=close;
  size.onclick=()=>{
    const actualSize=viewport.toggleAttribute('data-actual-size');
    size.textContent=actualSize?'适合宽度':'查看原始大小';
  };
  image.onload=()=>{size.disabled=false;status.hidden=true;};
  image.onerror=()=>{
    viewport.hidden=true;
    status.textContent='原图暂不可查看，请关闭后重新打开。';
  };
  window.addEventListener('hashchange',close,{once:true});
  dialog.addEventListener('close',()=>{
    window.removeEventListener('hashchange',close);
    dialog.remove();
    if(link.isConnected)link.focus({preventScroll:true});
  },{once:true});
  document.body.append(dialog);
  dialog.showModal();
  image.src=link.dataset.manualPreview;
}

async function knowledgeDetail(id,params,route){
  const path=knowledgePath+'/'+encodeURIComponent(id);
  const data=await api(path);
  if(route!==location.hash)return;
  const first=data.scans[0].first_page, last=data.scans.at(-1).last_page;
  const canIndex=data.state==='published'&&hasPermission('knowledge.search')&&hasPermission('knowledge.review');
  const url='#knowledge?id='+encodeURIComponent(id)+'&page=';
  const action=data.state==='pending_review'&&hasPermission('knowledge.review')?'review'
    :data.state==='reviewed'&&hasPermission('knowledge.publish')?'publish'
    :data.state==='published'&&hasPermission('knowledge.publish')?'retire':null;
  shell('资料详情',esc(data.title),`<section class="panel"><h2>版本与适用型号</h2>
    <dl class="service-facts"><div><dt>资料编号</dt><dd>${esc(data.document_code)}</dd></div>
      <div><dt>版次</dt><dd>${esc(data.edition)}</dd></div>
      <div><dt>状态</dt><dd>${knowledgeStates[data.state]}</dd></div>
      <div><dt>适用型号</dt><dd>${esc(data.models.join('、'))}</dd></div></dl>
    <a href="#knowledge">返回资料版本</a></section>
    ${canIndex?manualBatchPanel(first,last,Number.parseInt(params.get('page'),10)):''}
    <div class="grid opening-grid">
      <section class="panel"><h2 id="manual-page-title" aria-live="polite"></h2>
        <form id="knowledge-page-number" class="fields" data-manual-id="${esc(id)}">
          ${field('印刷页码','page',first,'required min="'+first+'" max="'+last+'"','number')}
          <div class="actions"><button type="submit" class="primary">跳到此页</button>
            <a class="button" role="link" data-manual-previous>上一页</a>
            <a class="button" role="link" data-manual-next>下一页</a></div>
        </form>
        <div class="manual-page-frame">
          <img class="service-photo" alt="">
          <p id="manual-page-error" class="state warning" role="status" hidden>图片暂不可查看，可重新打开单页。</p>
        </div>
        <a class="button" data-manual-original aria-haspopup="dialog">打开这一页原图</a>
        ${canIndex?manualIndexEditor():''}
      </section>
      <div class="grid"><section class="panel"><h2>原始扫描件</h2>
        <div class="fields">${data.scans.map(scan=>`<a href="/api${path}/scans/${scan.position}" target="_blank" rel="noopener">
          正文第 ${scan.first_page}～${scan.last_page} 页的原图</a>`).join('')}</div>
      </section><section class="panel"><h2>审核与发布</h2>
        ${data.events.map(event=>`<article class="service-row"><strong>${knowledgeActions[event.action]}</strong>
          <small>${esc(event.actor)} · ${stamp(event.created_at)}</small><p>${esc(event.note)}</p></article>`).join('')
          ||'<p class="muted">暂无审核或发布记录。</p>'}
        ${action?`<form id="knowledge-transition" class="fields section-note">
          ${field('核对或变更依据','note','','required maxlength="1000"')}
          ${check('我已核对本版本和本次操作。')}
          <button class="primary" type="submit">${knowledgeActions[action]}</button>
          <p role="status" data-manual-status></p></form>`:''}
      </section></div>
    </div>`,'',true);
  const viewer=$('#knowledge-page-number'), title=$('#manual-page-title');
  const preview=$('.manual-page-frame img'), error=$('#manual-page-error');
  const previous=viewer.querySelector('[data-manual-previous]'), next=viewer.querySelector('[data-manual-next]');
  const original=$('[data-manual-original]');
  original.onclick=openManualPreview;
  const editor=$('#manual-page-index');
  const setIndexPage=editor?bindManualIndex(editor,path):null;
  if(canIndex)bindManualBatch($('[data-manual-batch]'),path);
  function goToPage(number){
    const target=url+number;
    if(location.hash!==target)history.pushState(history.state,'',target);
    viewer.showPage(number);
  }
  function pageStep(link,number,enabled){
    if(enabled){
      link.href=url+number;
      link.removeAttribute('aria-disabled');
      link.onclick=event=>{
        if(event.button!==0||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
        event.preventDefault();
        goToPage(number);
      };
    }else{
      link.removeAttribute('href');
      link.setAttribute('aria-disabled','true');
      link.onclick=null;
    }
  }
  preview.onerror=()=>{error.hidden=false;};
  preview.onload=()=>{error.hidden=true;};
  viewer.showPage=rawPage=>{
    const number=Math.max(first,Math.min(last,Number.parseInt(rawPage,10)||first));
    const pageLink='/api'+path+'/pages/'+number;
    title.textContent='印刷第 '+number+' 页';
    viewer.elements.page.value=number;
    pageStep(previous,number-1,number>first);
    pageStep(next,number+1,number<last);
    original.href=pageLink;
    original.dataset.manualPreview=pageLink;
    original.dataset.manualPreviewTitle=`${data.title} · ${data.edition} 版 · 印刷第 ${number} 页`;
    preview.alt='说明书印刷第 '+number+' 页';
    if(preview.getAttribute('src')!==pageLink){error.hidden=true;preview.src=pageLink;}
    setIndexPage?.(number);
  };
  viewer.onsubmit=event=>{
    event.preventDefault();
    goToPage(viewer.elements.page.value);
  };
  viewer.showPage(params.get('page'));
  if(action)bindKnowledgeTransition($('#knowledge-transition'),path,data,action);
}

function bindKnowledgeTransition(form,path,data,action){
  let lastNote, operationId;
  const status=form.querySelector('[data-manual-status]');
  form.onsubmit=async event=>{
    event.preventDefault();
    const note=form.elements.note.value.trim();
    if(lastNote!==note||!operationId){lastNote=note;operationId=crypto.randomUUID();}
    try{
      await FormState.freezeWhile(form,()=>api(path+'/transition','POST',{
        action,note,version:data.version,operation_id:operationId,confirmed:form.elements.confirmed.checked,
      }));
      if(form.isConnected)await render();
    }catch(error){
      if(form.isConnected)status.textContent=error.status===409?'当前状态已变化，或同编号另有在用版本。请刷新核对。':error.message;
    }
  };
}
