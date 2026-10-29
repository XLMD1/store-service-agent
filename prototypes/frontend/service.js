function serviceDraftPage() {
  if (session.archived) return header('售后核对', { back: '#pending' }) + `<main id="page-content" tabindex="-1" class="page-body"><section class="panel receipt">${icon('check')}<h2>模拟归档完成</h2><p>演示编号 DEMO-SH-001 · 未写入正式档案</p><dl class="facts"><div><dt>服务地址</dt><dd>${esc(draft.address || '未提供')}</dd></div><div><dt>维修日期</dt><dd>${esc(draft.date || '未知')}</dd></div><div><dt>关联方式</dt><dd>${draft.association === 'new' ? '明确新建' : '已核对候选地址'}</dd></div></dl><p class="helper">仅保存本次页面会话，刷新后恢复初始样例。</p><a class="button button-primary" href="#pending">返回待核对</a></section></main>`;
  return header('售后核对', { back: '#pending', meta: '售后草稿 · 示例数据 · 尚未归档' }) + `<main id="page-content" tabindex="-1" class="page-body two-column"><section class="panel source-column"><div class="panel-heading"><h2>来源原件</h2><button class="text-link" data-action="source">展开阅读 ${icon('chevron')}</button></div>${sourceView(draft.source,session.customSource)}${session.photoUrl ? `<p class="helper">本次选择的照片 · 未上传服务器</p><img class="preview-image" src="${session.photoUrl}" alt="本次选择的来源照片">` : ''}<div class="state-message state-warning">${icon('warning')}<span>${session.customSource ? '请对照本次原文手工填写，未知字段保持未知。样板未执行自动识别。' : '原文手机号有一处不清。请核对完整号码，或明确标为未知；不要推测补位。'}</span></div></section>
    <form id="draft-form" class="panel"><h2>核对档案字段</h2><div class="form-field"><label for="association">客户与地址关联</label><select class="field" id="association" name="association"><option value="">请核对后选择</option><option value="1" ${draft.association === '1' ? 'selected' : ''}>示例客户甲 · 示例小区1号楼101</option><option value="2" ${draft.association === '2' ? 'selected' : ''}>示例客户甲 · 示例小区2号楼202</option><option value="new" ${draft.association === 'new' ? 'selected' : ''}>明确新建客户与地址档案</option></select><p class="helper">同一手机号存在两个地址，不自动选择；选择候选会带入该地址。</p></div>
    ${field('姓名 / 称呼','name',draft.name)}${field('手机号','phone',draft.phone,{ type: 'tel', attrs: 'inputmode="tel" aria-describedby="phone-help"', help: '<span id="phone-help">识别不清的号码不能作为已核对字段。</span>' })}<div class="field-tools"><span class="helper">可用服务地址识别客户</span><button type="button" class="text-link" data-action="unknown-phone">标为未知</button></div>
    ${field('服务地址','address',draft.address,{textarea:true})}${field('问题描述 · 必填','problem',draft.problem,{textarea:true})}<div class="split-fields">${field('设备型号','model',draft.model,{help:'原文未提供时可留空'})}${field('故障码','code',draft.code,{help:'未提供可保持未知'})}</div>${field('维修日期','date',draft.date,{type:'date',help:'留空表示未知，不使用今天日期替代'})}<details class="review-details"><summary>处理方法、配件与结果</summary>${field('处理方法','method',draft.method,{textarea:true})}${field('更换配件','parts',draft.parts)}${field('实际维修结果','result',draft.result,{textarea:true,help:'原文没说修好，就不记录为已修好'})}</details><div id="draft-issues" aria-live="polite"></div></form></main>` + footer('<a class="button" href="#pending">稍后核对</a>','<button class="button button-primary" id="archive-button" disabled>预览归档内容</button>','草稿尚未归档 · 请先核对标记字段');
}
function serviceSearchPage() {
  return header('售后档案', { content: `<form class="search-bar" id="history-form"><div style="flex:1;min-width:0"><label class="sr-only" for="history-query">手机号 / 地址关键词</label><input class="field" id="history-query" value="${esc(session.query)}" placeholder="手机号 / 地址关键词"></div><button class="button button-primary">查找</button></form>` }) + `<main id="page-content" tabindex="-1" class="page-body"><section class="panel" id="candidate-list" aria-live="polite"></section><p class="helper">仅查询当前已归档范围。未找到，不代表没有维修历史。</p></main>`;
}
function renderSearch() {
  const query = session.query.trim().replace(/\s/g,'');
  const matched = customers.filter(item => (item.phone + item.name + item.address).includes(query));
  $('#candidate-list').innerHTML = matched.length ? `<h2>找到 ${matched.length} 个服务地址</h2><p class="muted">请选择本次要查看的地址</p>${matched.map(item => `<article class="customer-card"><h3>${icon('pin')}${item.name}</h3><p class="muted">${item.phone}</p><p class="address">${item.address}</p><p class="helper">最近记录：${item.date}</p><a class="button wide" href="#service-detail?customer=${item.id}">查看该地址档案</a></article>`).join('')}` : `<div class="empty-state">${icon('search')}<h2>当前已归档范围内未找到</h2><p class="muted">保留查询条件，可换用完整手机号或更具体的地址。</p><button class="button" data-action="edit-query">修改查询条件</button></div>`;
}
function selectedCustomer() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  return customers.find(item => item.id === params.get('customer')) || customers[0];
}
function serviceDetailPage() {
  const customer = selectedCustomer();
  const supplement = session.supplements[customer.id]?.at(-1);
  return header('售后档案', { back:'#service-search', content:`<div class="customer-identity"><h2>${customer.name} <span class="status">已归档样例</span></h2><p>${customer.phone}</p><p>${customer.address}</p><p class="helper">设备型号：${customer.model || '未提供'}</p></div>` }) + `<main id="page-content" tabindex="-1" class="page-body"><h2>历史记录</h2><div class="timeline"><details class="panel" open><summary><span class="eyebrow">${customer.date}</span><strong>设备无法正常启动</strong></summary><dl class="facts"><div><dt>问题</dt><dd>设备无法正常启动</dd></div><div><dt>故障码</dt><dd>未提供</dd></div><div><dt>处理方法</dt><dd>已完成现场检查</dd></div><div><dt>更换配件</dt><dd>未记录</dd></div><div><dt>最终结果</dt><dd class="warning-text">${supplement ? esc(supplement.result) + '（本次模拟补充）' : '待师傅补充'}</dd></div></dl><div class="button-row"><button class="text-link" data-action="record-source">${icon('file')}查看对应原文</button><button class="text-link" data-action="revisions">${icon('history')}查看修订</button></div><p class="helper">本条来源为保存的示例群原文；日期与历史纸本原文分开保留。</p></details><details class="panel"><summary><span class="eyebrow">日期未知</span><strong>历史报修记录</strong></summary><p>原文记录设备无法正常启动，具体维修日期及最终结果未提供。</p><button class="text-link" data-action="source">查看保存的纸本原文</button><p class="helper">不按归档时间推断维修先后。</p></details></div></main>` + footer(`<a class="button" href="#repair-assistant?model=${customer.model ? 'A' : 'unknown'}">查维修依据</a>`,`<button class="button button-primary" data-action="supplement" data-customer="${customer.id}">补充处理结果</button>`);
}
function repairPage() {
  return header('维修辅助', { back:'#home', meta:'示例资料 · 非实际维修指引' }) + `<main id="page-content" tabindex="-1" class="page-body two-column"><div class="stack"><form class="panel" id="repair-form"><h2>确认查询条件</h2>${field('设备准确型号','repair-model',session.repair.model)}${field('故障码','repair-code',session.repair.code,{help:'没有报错码可留空'})}${field('故障表现','repair-problem',session.repair.problem,{textarea:true})}<button class="button button-primary wide">查维修依据</button><p class="helper" style="margin-top:10px">修改条件后需重新查询，旧回答不沿用。</p></form><section class="panel" id="repair-answer" aria-live="polite"></section></div><aside class="panel source-column"><h2>资料依据</h2><p class="helper">虚构示例手册 v1，仅展示引用结构。</p><div class="reference-row">${icon('file')}<span>[1] 示例手册 · 第12页</span><button class="text-link" data-citation="12">查看原文</button></div><div class="reference-row">${icon('file')}<span>[2] 示例手册 · 第13页</span><button class="text-link" data-citation="13">查看原文</button></div><div style="margin-top:16px">${message('当前没有接入真实手册或知识检索服务。示例文字不能用于实际维修。','warning')}</div><h3 style="margin-top:20px">本示例是否有帮助？</h3><div class="feedback"><button class="button" data-feedback="有用" aria-pressed="false">有用</button><button class="button" data-feedback="不适用 / 出处错误" aria-pressed="false">不适用 / 出处错误</button></div></aside></main>`;
}
function renderRepairAnswer() {
  const { model, problem } = session.repair;
  if (model.trim() !== '示例型号A' || !problem.trim()) {
    $('#repair-answer').innerHTML = `<h2>资料不足</h2>${message(!model.trim() ? '请先补充设备准确型号，再核对适用资料。' : '当前样板只包含示例型号A的虚构资料；请补充准确机型、现象和已核对手册。','warning')}`;
    return;
  }
  $('#repair-answer').innerHTML = `${message('依据：示例手册 v1 · 仅适用示例型号A')}<section class="answer-item"><div class="panel-heading"><h3>故障说明</h3><button class="citation" data-citation="12" aria-label="故障说明出处，第12页">[1]</button></div><p>当前现象需结合现场检查进一步判断。</p></section><section class="answer-item"><div class="panel-heading"><h3>检查前提</h3><button class="citation" data-citation="12" aria-label="检查前提出处，第12页">[1]</button></div><p>先确认具体机型及现场条件。</p></section><section class="answer-item"><div class="panel-heading"><h3>条件化修理建议</h3><button class="citation" data-citation="13" aria-label="修理建议出处，第13页">[2]</button></div><p>若检查结果符合手册条件，再参考对应处理步骤。</p></section>${message('待补充：现场检查结果。建议不作为实际维修结果。','warning')}<form id="followup-form" style="margin-top:16px">${field('补充检查结果','followup','',{textarea:true,help:'仅展示补充内容，不调用模型'})}<button class="button wide">补充并继续询问</button></form>`;
}
function updateDraft() {
  const form = $('#draft-form');
  if (!form) return;
  for (const name of ['name','phone','address','problem','model','code','date','method','parts','result','association']) draft[name] = form.elements[name].value;
  const candidate = customers.find(item => item.id === draft.association);
  if (candidate && candidate.address !== draft.address) { draft.association = ''; form.elements.association.value = ''; }
  const issues = FrontendRules.archiveIssues(draft);
  $('#archive-button').disabled = issues.length > 0;
  $('#draft-issues').innerHTML = issues.length ? message(issues.map(esc).join('<br>'),'warning') : message('最低归档条件已满足，请预览并核对本次内容。','success');
  $('#footer-note').textContent = issues.length ? '草稿尚未归档 · 请先核对标记字段' : '日期未知可保留 · 确认前请再次预览';
  form.elements.phone.classList.toggle('field-warning', !!draft.phone && !/^1\d{10}$/.test(draft.phone));
  form.elements.phone.setAttribute('aria-invalid', String(!!draft.phone && !/^1\d{10}$/.test(draft.phone)));
}
function bindService() {
  if ($('#draft-form')) {
    $('#draft-form').addEventListener('submit', event => event.preventDefault());
    $('#draft-form').addEventListener('input', updateDraft);
    $('#association').addEventListener('change', event => {
      const selected = customers.find(item => item.id === event.target.value);
      if (selected) { $('#draft-form').elements.address.value = selected.address; $('#draft-form').elements.name.value = selected.name; }
      updateDraft();
    });
    $('#archive-button').addEventListener('click', () => {
      updateDraft();
      if (FrontendRules.archiveIssues(draft).length) return;
      reader('归档内容预览', `${message('演示预览 · 尚未归档','warning')}<dl class="facts">${[['姓名',draft.name],['手机号',draft.phone || '未知'],['服务地址',draft.address || '未知'],['问题',draft.problem],['型号',draft.model || '未知'],['维修日期',draft.date || '未知'],['处理方法',draft.method || '未记录'],['配件',draft.parts || '未记录'],['实际结果',draft.result || '未记录'],['关联',draft.association === 'new' ? '明确新建' : customers.find(x => x.id === draft.association).address]].map(([label,value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl><p class="helper">来源原文和可选处理字段均随本次演示保留，不执行正式写入。</p><button class="button button-primary wide" data-action="confirm-archive">确认归档（演示）</button>`);
    });
    updateDraft();
  }
  if ($('#history-form')) { renderSearch(); $('#history-form').addEventListener('submit', event => { event.preventDefault(); session.query = $('#history-query').value; renderSearch(); }); }
  if ($('#repair-form')) {
    renderRepairAnswer();
    $('#repair-form').addEventListener('input', () => { $('#repair-answer').innerHTML = message('查询条件已修改，请重新查维修依据。','warning'); });
    $('#repair-form').addEventListener('submit', event => { event.preventDefault(); session.repair = { model: $('#repair-model').value, code: $('#repair-code').value, problem: $('#repair-problem').value }; renderRepairAnswer(); });
  }
}
