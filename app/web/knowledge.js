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
  const data=await api(knowledgePath+'?offset='+offset);
  if(route!==location.hash)return;
  const canImport=hasPermission('knowledge.review')||hasPermission('knowledge.publish');
  shell('维修资料','查阅说明书和适用型号',`<section class="panel"><h2>资料版本</h2>
    ${data.items.map(row=>`<article class="row"><div><h3>${esc(row.title)}</h3>
      <p>${esc(row.document_code)} · ${esc(row.edition)} · ${knowledgeStates[row.state]}</p>
      <p>${esc(row.models.join('、'))}</p></div>
      <a class="button" href="#knowledge?id=${encodeURIComponent(row.id)}">查看资料</a></article>`).join('')
      ||'<p class="state">当前没有可查看的资料。</p>'}
    <div class="actions">${offset?'<a class="button" href="#knowledge?offset='+Math.max(0,offset-50)+'">上一页</a>':''}
      ${data.next_offset!=null?'<a class="button" href="#knowledge?offset='+esc(data.next_offset)+'">下一页</a>':''}</div>
    </section>${canImport?manualImport():''}`,'',true);
  if(canImport)bindManualImport($('#knowledge-import'));
}

async function knowledgeDetail(id,params,route){
  const path=knowledgePath+'/'+encodeURIComponent(id);
  const data=await api(path);
  if(route!==location.hash)return;
  const first=data.scans[0].first_page, last=data.scans.at(-1).last_page;
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
        <a class="button" data-manual-original target="_blank" rel="noopener">打开这一页原图</a>
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
    preview.alt='说明书印刷第 '+number+' 页';
    if(preview.getAttribute('src')!==pageLink){error.hidden=true;preview.src=pageLink;}
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
