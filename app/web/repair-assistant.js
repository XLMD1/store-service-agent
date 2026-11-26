'use strict';

const repairPointLabels={meaning:'故障说明',candidate:'可能原因',check:'检查前提',action:'条件化建议',manufacturer:'厂家处理建议'};
const repairRatingLabels={useful:'有用',not_applicable:'不适用',wrong_source:'出处错误'};

async function repairAssistantPage(){
  if(!hasPermission('repair.answer'))throw new Error('当前账号暂无法使用维修辅助。');
  const route=location.hash;
  const {models}=await api('/knowledge/search/models');
  if(route!==location.hash)return;
  shell('维修辅助','查故障含义，结合现场情况继续追问',`<div class="grid service-compare">
    <section class="panel"><form id="repair-ask" class="fields">
      <label class="field"><span>完整型号</span><select name="model"><option value="">型号待确认</option>
        ${models.map(model=>`<option value="${esc(model)}">${esc(model)}</option>`).join('')}
      </select></label>
      <label class="field"><span>故障码或现象</span><textarea name="problem" maxlength="500" required rows="3" placeholder="例如 壁挂炉报 E3"></textarea></label>
      <button type="submit" class="primary">查维修依据</button>
      <p class="muted">请只填写设备现象和检查结果。<a href="#knowledge">直接查说明书原页</a></p>
    </form></section>
    <section class="panel" data-repair-result aria-live="polite"><p class="muted">填写故障现象后查看说明书依据。</p></section>
  </div>
  ${hasPermission('knowledge.publish')?`<details class="panel section-note" id="repair-feedback-review">
    <summary>查看评测反馈</summary>
    <p class="muted">按答复时间排序。每条答复显示最后一次评价。</p>
    <p role="status"></p><div data-feedback-entries></div>
    <div class="actions"><button type="button" data-feedback-refresh>刷新</button>
      <button type="button" data-feedback-more hidden>加载更多</button></div>
  </details>`:''}`,'',true);
  const form=$('#repair-ask'), result=$('[data-repair-result]');
  result.addEventListener('click',openManualPreview);
  const review=$('#repair-feedback-review');
  if(review)bindRepairFeedbackReview(review);
  let active=null;
  form.oninput=()=>{active=null;result.replaceChildren();};
  form.onchange=form.oninput;
  form.onsubmit=async event=>{
    event.preventDefault();
    const input=Object.fromEntries(new FormData(form));
    if(!input.problem.trim()){result.textContent='请填写故障码或现象。';return;}
    if(active?.model===input.model && active.problem===input.problem)return;
    active=input;
    result.textContent='正在查找适用的说明书依据…';
    try{
      const answer=await FormState.freezeWhile(form,()=>api('/repair/ask','POST',input));
      if(!form.isConnected||active!==input)return;
      showRepairResult(result,answer);
      if(['answered','source_only','insufficient'].includes(answer.status))bindRepairFollowup(result,input,answer.answer_id);
      if(answer.status!=='answered')active=null;
    }catch(error){if(form.isConnected&&active===input){active=null;result.textContent=error.message;}}
  };
}

function bindRepairFeedbackReview(panel){
  const entries=panel.querySelector('[data-feedback-entries]'), status=panel.querySelector('[role=status]');
  const refresh=panel.querySelector('[data-feedback-refresh]'), more=panel.querySelector('[data-feedback-more]');
  let loaded=false, nextOffset=null;
  const load=async offset=>{
    if(refresh.disabled)return;
    refresh.disabled=more.disabled=true;
    status.textContent='正在读取评测反馈…';
    try{
      const {items,next_offset}=await api('/repair/feedback?offset='+offset);
      if(!panel.isConnected)return;
      const cards=items.map(row=>{
        const points=[...row.points,...(row.manufacturer_guidance||[]).map(item=>({...item,kind:'manufacturer'}))];
        return `<article class="service-row">
          <h3>${esc(repairRatingLabels[row.feedback.rating])} · ${esc(row.model)}</h3>
          <p class="muted">${esc(row.actor)} · 答复于 ${esc(stamp(row.answered_at))}</p>
          ${row.feedback.note?`<p>${esc(row.feedback.note)}</p>`:''}
          <details><summary>查看对应答复</summary>${points.map(point=>`<p><strong>${esc(repairPointLabels[point.kind])}</strong>
            ${point.condition?`<br>适用条件 · ${esc(point.condition)}`:''}<br>${esc(point.quote)}
            <br>${repairCitation(row.sources[point.source-1])}</p>`).join('')}</details>
        </article>`;
      }).join('');
      if(offset===0)entries.replaceChildren();
      entries.insertAdjacentHTML('beforeend',cards);
      nextOffset=next_offset;
      more.hidden=nextOffset==null;
      loaded=true;
      status.textContent=cards?'':'暂无评测反馈。';
    }catch(error){if(panel.isConnected)status.textContent=error.message;}
    finally{refresh.disabled=more.disabled=false;}
  };
  panel.addEventListener('click',openManualPreview);
  panel.ontoggle=()=>{if(panel.open&&!loaded)load(0);};
  refresh.onclick=()=>load(0);
  more.onclick=()=>load(nextOffset);
}

function bindRepairFollowup(container,input,previousAnswer){
  const feedback=container.querySelector('[data-repair-feedback]')?.closest('details');
  (feedback||container).insertAdjacentHTML(feedback?'beforebegin':'beforeend',`<div data-repair-turns></div>
    <details class="repair-action repair-followup" data-followup><summary>${icon('compose')}补充现场情况或追问</summary><form class="fields">
      <label class="field"><span>补充内容</span><select name="kind" data-native-select>
        <option value="condition">现场观察</option><option value="question">想问的问题</option></select></label>
      <label class="field"><span>描述设备情况或问题</span><textarea name="message" maxlength="500" required rows="2" placeholder="例如：开机就显示 E3"></textarea></label>
      <button class="primary">继续查询</button><p role="status"></p>
    </form></details>`);
  const follow=container.querySelector('[data-followup] form'), turns=container.querySelector('[data-repair-turns]');
  let history={condition:'',question:''};
  follow.onsubmit=async event=>{
    event.preventDefault();
    const kind=follow.elements.kind.value, message=follow.elements.message.value.trim(), status=follow.querySelector('[role=status]');
    if(!message)return;
    const next={...history,[kind]:[history[kind],message].filter(Boolean).join('\n')};
    if(next[kind].length>500){status.textContent='本次查询的同类补充最多 500 字，请缩短内容。';return;}
    status.textContent='正在核对说明书依据…';
    try{
      const answer=await FormState.freezeWhile(follow,()=>api('/repair/ask','POST',{...input,...next,previous_answer_id:previousAnswer}));
      if(!follow.isConnected)return;
      if(answer.status==='urgent'){showRepairResult(container,answer);return;}
      const turn=document.createElement('section');
      const prompt=document.createElement('p');
      prompt.textContent=(kind==='question'?'你的追问 · ':'现场观察 · ')+message;
      const reply=document.createElement('div');
      turn.append(prompt,reply);turns.append(turn);
      showRepairResult(reply,answer);
      if(answer.status==='answered' && answer.points.every(point=>point.kind==='meaning')){
        const limit=document.createElement('p');
        limit.textContent='本次依据只能说明故障含义，具体原因仍需现场核实。';
        reply.prepend(limit);
      }
      if(answer.status==='answered'){history=next;previousAnswer=answer.answer_id;follow.elements.message.value='';}
      status.textContent='';
    }catch(error){if(follow.isConnected)status.textContent=error.message;}
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
  const guidance=answer.manufacturer_guidance;
  container.innerHTML=`<h2>维修依据</h2><p class="muted">${answer.origin==='deepseek'?'AI 根据说明书整理':'说明书原文'} · ${esc(answer.model)}</p>
    ${answer.points.some(point=>point.kind==='candidate')?'<p class="state">以下是说明书列出的可能原因，需结合现场检查核对。</p>':''}
    ${answer.points.map(point=>`<article class="service-row"><h3>${repairPointLabels[point.kind]}</h3>
      ${point.condition?`<p>适用条件 · ${esc(point.condition)}</p>`:''}<p>${esc(point.quote)}</p>
      ${repairCitation(answer.sources[point.source-1])}</article>`).join('')}
    ${guidance?.map(item=>`<article class="service-row"><h3>厂家处理建议</h3><p>${esc(item.quote)}</p>
      ${repairCitation(answer.sources[item.source-1])}</article>`).join('')||''}
    ${guidance?.length===0?'<p class="state">已核对的原文未登记该故障码的厂家处理建议。</p>':''}
    <details class="repair-action repair-manual"><summary>${icon('book')}查看说明书原页</summary>
      ${(answer.passages||[]).map(p=>`<p>${esc(p.text)}</p>`).join('')}
      ${answer.sources.map(source=>`<p>${repairCitation(source)}</p><img loading="lazy" class="service-photo" src="${esc(source.original_url)}" alt="印刷第 ${esc(source.page)} 页说明书原文">`).join('')}
    </details>
    <details class="repair-action repair-feedback"><summary>评测反馈</summary><form class="fields" data-repair-feedback>
      <label class="field"><span>评价</span><select name="rating" required>
        <option value="">请选择</option>
        ${Object.entries(repairRatingLabels).map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}
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
      if(feedback.isConnected)status.textContent='反馈已保存，负责人可在「查看评测反馈」中查看。';
    }catch(error){if(feedback.isConnected)status.textContent=error.message;}
  };
}
