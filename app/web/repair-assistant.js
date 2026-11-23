'use strict';

const repairPointLabels={meaning:'故障说明',candidate:'可能原因',check:'检查前提',action:'条件化建议'};

async function repairAssistantPage(){
  if(!hasPermission('repair.answer'))throw new Error('当前账号暂无法使用维修辅助。');
  const route=location.hash;
  const {models}=await api('/knowledge/search/models');
  if(route!==location.hash)return;
  shell('维修辅助','按设备型号查说明书，由 AI 整理带引用的答案',`<div class="grid service-compare">
    <section class="panel"><form id="repair-ask" class="fields">
      <label class="field"><span>完整型号</span><select name="model"><option value="">型号待确认</option>
        ${models.map(model=>`<option value="${esc(model)}">${esc(model)}</option>`).join('')}
      </select></label>
      <label class="field"><span>故障码或现象</span><textarea name="problem" maxlength="500" required rows="3" placeholder="例如 壁挂炉报 E3"></textarea></label>
      <label class="field"><span>现场检查结果（选填）</span><textarea name="condition" maxlength="500" rows="2"></textarea></label>
      <button type="submit" class="primary">查维修依据</button>
      <p class="muted">请只填写设备现象和检查结果。<a href="#knowledge">直接查说明书原页</a></p>
    </form></section>
    <section class="panel" data-repair-result aria-live="polite"><p class="muted">填写故障现象后查看说明书依据。</p></section>
  </div>`,'',true);
  const form=$('#repair-ask'), result=$('[data-repair-result]');
  result.addEventListener('click',openManualPreview);
  form.oninput=()=>result.replaceChildren();
  form.onchange=form.oninput;
  form.onsubmit=async event=>{
    event.preventDefault();
    const input=Object.fromEntries(new FormData(form));
    if(!input.problem.trim()){result.textContent='请填写故障码或现象。';return;}
    result.textContent='正在查找适用的说明书依据…';
    try{
      const answer=await FormState.freezeWhile(form,()=>api('/repair/ask','POST',input));
      if(!form.isConnected)return;
      showRepairResult(result,answer);
    }catch(error){if(form.isConnected)result.textContent=error.message;}
  };
}

function repairCitation(source){
  return `<a href="#knowledge?id=${encodeURIComponent(source.version_id)}&amp;page=${encodeURIComponent(source.page)}"
    aria-haspopup="dialog" data-manual-preview="${esc(source.original_url)}">${esc(source.title)} · ${esc(source.edition)} 版 · 印刷第 ${esc(source.page)} 页</a>`;
}

function showRepairResult(container,answer){
  if(answer.status!=='answered'){
    container.innerHTML=`<h2>${answer.status==='urgent'?'需要先处理现场风险':'核对或补充依据'}</h2>
      <p class="state warning">${esc(answer.message)}</p>
      ${answer.sources.map(source=>`<p class="section-note">${repairCitation(source)}</p>`).join('')}`;
    return;
  }
  container.innerHTML=`<h2>维修依据</h2><p class="muted">适用型号 · ${esc(answer.model)}</p>
    ${answer.points.some(point=>point.kind==='candidate')?'<p class="state">以下是说明书列出的可能原因，需结合现场检查核对。</p>':''}
    ${answer.points.map(point=>`<article class="service-row"><h3>${repairPointLabels[point.kind]}</h3>
      ${point.condition?`<p>适用条件 · ${esc(point.condition)}</p>`:''}<p>${esc(point.quote)}</p>
      ${repairCitation(answer.sources[point.source-1])}</article>`).join('')}
    <details><summary>评测反馈</summary><form class="fields" data-repair-feedback>
      <label class="field"><span>评价</span><select name="rating" required>
        <option value="">请选择</option><option value="useful">有用</option>
        <option value="not_applicable">不适用</option><option value="wrong_source">出处错误</option>
      </select></label>
      ${field('原因（选填）','note','','maxlength="500"')}
      <button type="submit">提交反馈</button><p role="status"></p>
    </form></details>`;
  const feedback=container.querySelector('[data-repair-feedback]');
  if(typeof FrontendPickers!=='undefined')FrontendPickers.refresh();
  feedback.onsubmit=async event=>{
    event.preventDefault();
    const status=feedback.querySelector('[role=status]');
    const fields=Object.fromEntries(new FormData(feedback));
    try{
      await FormState.freezeWhile(feedback,()=>api('/repair/answers/'+encodeURIComponent(answer.answer_id)+'/feedback','POST',fields));
      if(feedback.isConnected)status.textContent='反馈已保存。';
    }catch(error){if(feedback.isConnected)status.textContent=error.message;}
  };
}
