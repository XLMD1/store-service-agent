const pageViews = { home:homePage, pending:pendingPage, 'service-draft':serviceDraftPage, 'service-search':serviceSearchPage, 'service-detail':serviceDetailPage, 'repair-assistant':repairPage, inventory:inventoryPage, 'reserved-pickup':pickupPage, 'inbound-statistics':statisticsPage, settings:settingsPage };
let currentRoute = '';
function render() {
  const requested = location.hash.slice(1).split('?')[0] || 'home';
  const route = routes[requested] ? requested : 'home';
  const routeChanged = currentRoute !== route;
  if (routeChanged && route === 'repair-assistant') {
    const model = new URLSearchParams(location.hash.split('?')[1] || '').get('model');
    if (model) session.repair.model = model === 'A' ? '示例型号A' : '';
  }
  currentRoute = route;
  const root = ['home','pending','service-search','inventory'].includes(route);
  document.body.classList.toggle('root-page',root);
  document.body.classList.toggle('task-page',!root);
  document.title = '门店助手 · ' + routes[route][0];
  $('#breadcrumb').textContent = routes[route][0];
  const selected = ['service-detail','repair-assistant'].includes(route) ? 'service-search' : route === 'service-draft' ? 'pending' : ['reserved-pickup','inbound-statistics'].includes(route) ? 'inventory' : route;
  for (const selector of ['#desktop-nav','#mobile-nav']) $(selector).innerHTML = ['home','pending','service-search','inventory'].map(key => `<a href="#${key}" ${key === selected ? 'aria-current="page"' : ''}>${icon(routes[key][1])}<span>${key === 'service-search' ? '售后' : routes[key][0]}</span></a>`).join('');
  $('#page-root').innerHTML = pageViews[route]();
  bindWorkbench(); bindService(); bindInventory();
  window.scrollTo(0,0);
  $('#page-content')?.focus({preventScroll:true});
}
const actions = {
  source: readSource,
  'record-source'() { const customer = selectedCustomer(); reader('保存的示例群原文', `<p class="helper">来源：示例群记录 · 消息日期 ${customer.date} · 群名未提供</p><p class="preview-text">${esc(customer.name)}，${esc(customer.phone)}\n${esc(customer.address)}\n设备无法正常启动；已完成现场检查。配件未记录，最终结果待补充。</p><p class="helper">此处为构造的示例原文；不跳转微信群。</p>`); },
  'unknown-phone'() { $('#phone').value = ''; updateDraft(); $('#phone').focus(); notify('手机号已明确标为未知，原始表达仍保留'); },
  'confirm-archive'() { if (FrontendRules.archiveIssues(draft).length) return; session.archived = true; $('#reader').close(); render(); },
  'edit-query'() { $('#history-query').focus(); },
  revisions() {
    const revisions = session.supplements[selectedCustomer().id] || [];
    reader('修订记录 · 示例', '<p>第1版 · 原始归档样例</p><p class="helper">示例接单员 · 样例登记时间2026-10-26 10:20</p><p class="preview-text">处理方法：已完成现场检查<br>最终结果：待师傅补充</p>' + (revisions.length ? revisions.map((item,index) => `<article class="pending-card"><h3>第${index+2}版 · 本次模拟补充</h3><p class="preview-text">${esc(item.result)}</p><p>新增来源</p><p class="preview-text">${esc(item.source)}</p></article>`).join('') : '<p class="helper">尚无后续修订；不虚构修改记录。</p>'));
  },
  supplement(button) {
    reader('补充处理结果 · 草稿', `<p>示例客户甲 · ${button.dataset.customer === '2' ? customers[1].address : customers[0].address}</p><p class="helper">为 ${button.dataset.customer === '2' ? customers[1].date : customers[0].date} 报修追加内容。</p><form id="supplement-form" data-customer="${button.dataset.customer}">${field('实际处理与结果','supplement-result','',{textarea:true,attrs:'required',help:'只记录实际提供的结果，不将维修建议作为事实'})}${field('新增来源原文','supplement-source','',{textarea:true,attrs:'required',help:'保留本次处理结果的来源内容'})}<button class="button button-primary wide">预览补充内容</button></form>`);
  },
  'confirm-supplement'(button) {
    if (!session.supplements[button.dataset.customer]) session.supplements[button.dataset.customer] = [];
    session.supplements[button.dataset.customer].push({ result:button.dataset.result, source:button.dataset.source });
    $('#reader').close(); render(); notify('模拟补充完成，未写入正式档案');
  },
  async paste() {
    try { const value = await navigator.clipboard.readText(); if (value) { session.task = value; $('#task-input').value = value; } else notify('剪贴板没有文字，请手动输入'); }
    catch { notify('请在输入框中手动粘贴文字'); }
    $('#task-input').focus();
  },
  upload() { $('#photo-input').click(); },
  'remove-photo'() { if (session.photoUrl) URL.revokeObjectURL(session.photoUrl); session.photoUrl = ''; session.photoName = ''; $('#photo-input').value = ''; $('#attachment').hidden = true; },
  'task-to-draft'() { session.customSource = true; draft.source = session.task.trim() || '本次选择的照片；文字未识别，请对照照片手工填写。'; session.archived = false; Object.assign(draft,{ name:'', phone:'', address:'', problem:'', model:'', code:'', date:'', association:'', method:'', parts:'', result:'' }); $('#reader').close(); location.hash = 'service-draft'; },
  'inventory-actions'() { reader('登记库存变动', `<p class="helper">本轮完整交互样板覆盖“预留提货”，其他库存写入表单后续实施。</p><a class="button button-primary wide" href="#reserved-pickup" data-close-reader style="margin-top:16px">预留提货</a><div style="margin-top:16px">${message('入库、普通出库、留货、取消留货需接入对应草稿与后端确认流程。当前不执行这些操作。')}</div>`); },
  'reload-pickup'() { location.hash = 'inventory'; notify('已返回样例库存，正式系统需从后端获取最新数量'); },
  'check-result'() { $('#pickup-impact').innerHTML = message('演示核验结果：仍未取得回执，保持待核验。真实系统需查询原操作结果；当前不能判定成功或失败。','warning') + '<a class="button wide" href="#pending" style="margin-top:16px">返回待核对</a>'; },
  'inbound-documents'() {
    const result = currentStatistics();
    reader('对应入库单 · 示例', result.rows.length ? result.rows.map(row => `<article class="pending-card"><h3>${row.id} · ${row.date}</h3><p>${row.warehouse}号库 · 示例型号${row.model} · 有效入库 ${row.effective}台</p><p class="helper">业务发生：${row.date}（仅日期）<br>示例登记：${row.date} 10:20 · 示例进出货员${row.original !== row.effective ? `<br>原录入${row.original}台 → 更正后有效${row.effective}台，关联 GZ-001；不另计一次进货。` : ''}</p></article>`).join('') : '<p>当前查询范围内没有有效入库单。</p>');
  }
};
document.addEventListener('click', event => {
  if (event.target.closest('.skip-link')) { event.preventDefault(); $('#page-content').focus(); $('#page-content').scrollIntoView(); return; }
  const button = event.target.closest('[data-action]');
  if (button && actions[button.dataset.action]) actions[button.dataset.action](button);
  if (event.target.closest('[data-close-reader]')) $('#reader').close();
  const citation = event.target.closest('[data-citation]');
  if (citation) reader('示例手册 v1 · 第' + citation.dataset.citation + '页', `<span class="status status-warning">虚构资料 · 非实际维修依据</span><h3 style="margin-top:16px">适用：示例型号A</h3><p class="preview-text">${citation.dataset.citation === '12' ? '当前现象需结合现场检查进一步判断。\n先确认具体机型及现场条件。' : '若检查结果符合手册条件，再参考对应处理步骤。'}</p><p class="helper">仅演示版本与页码对应关系，未接入真实手册，不含实际维修步骤。</p>`);
  const feedback = event.target.closest('[data-feedback]');
  if (feedback) { document.querySelectorAll('[data-feedback]').forEach(item => item.setAttribute('aria-pressed',String(item === feedback))); notify('已记录本次演示反馈：' + feedback.dataset.feedback); }
  const group = event.target.closest('[data-group]');
  if (group) { session.stats.group = group.dataset.group; renderStatistics(); }
  const ledger = event.target.closest('[data-ledger]');
  if (ledger) reader(ledger.dataset.ledger + '号库 · 流水示例', `<p class="helper">示例型号A · 展示字段结构，非完整对账台账。</p><article class="pending-card"><h3>期初建账 · QC-00${ledger.dataset.ledger}</h3><p>发生：2026-10-01 00:00<br>登记：2026-10-01 00:10<br>操作者：示例负责人</p><p class="helper">期初不计入进货。本样板各流程数据为独立验收场景，不构成完整流水。</p></article>${session.pickup && ledger.dataset.ledger === '2' ? `<article class="pending-card"><h3>本次模拟提货 · DEMO-TH-001</h3><p>数量：${session.pickup.quantity}台 · 原预留 YL-001<br>业务发生：${session.pickup.date}（仅日期）<br>登记：本次页面会话 · 示例进出货员</p></article>` : ''}`);
  const reservation = event.target.closest('[data-reservations]');
  if (reservation) {
    const second = reservation.dataset.reservations === '2';
    const remaining = second ? session.pickup?.remaining ?? session.stock.remaining : 2;
    reader(reservation.dataset.reservations + '号库 · 预留明细', `<span class="status">${remaining ? '进行中' : '已结束'}</span><h3 style="margin-top:12px">${second ? 'YL-001 · 示例客户甲' : 'YL-002 · 示例客户乙'}</h3><p class="helper">${reservation.dataset.reservations}号库 · 示例型号A</p><dl class="facts"><div><dt>登记量</dt><dd>${second ? 3 : 2}台</dd></div><div><dt>账期已提</dt><dd>${second ? session.pickup?.quantity ?? 0 : 0}台</dd></div><div><dt>已取消</dt><dd>0台</dd></div><div><dt>剩余</dt><dd>${remaining}台</dd></div><div><dt>依据</dt><dd>口头约定（示例）</dd></div></dl><p class="helper">期初预留，登记量为建账时剩余量，不代表最早约定总量。</p>${second && remaining ? '<a class="button button-primary wide" href="#reserved-pickup" data-close-reader>办理该单提货</a>' : '<p class="helper">当前演示提货页仅覆盖 YL-001。</p>'}`);
  }
});
document.addEventListener('submit', event => {
  if (event.target.id === 'followup-form') { event.preventDefault(); if (!$('#followup').value.trim()) { notify('请填写现场检查结果'); return; } reader('补充检查结果 · 演示', `<p class="preview-text">${esc($('#followup').value)}</p>${message('已展示补充内容；尚未接入模型或真实资料，不能生成新的维修结论。','warning')}`); }
  if (event.target.id === 'supplement-form') {
    event.preventDefault();
    reader('补充内容预览', `<p class="preview-text">${esc($('#supplement-result').value)}</p><p>新增来源</p><p class="preview-text">${esc($('#supplement-source').value)}</p><p class="helper">原记录与原来源保留，仅模拟追加结果。</p><button class="button button-primary wide" data-action="confirm-supplement" data-customer="${event.target.dataset.customer}" data-result="${esc($('#supplement-result').value)}" data-source="${esc($('#supplement-source').value)}">确认补充（演示）</button>`);
  }
});
$('#reader-close').addEventListener('click', () => $('#reader').close());
window.addEventListener('hashchange', () => { if ($('#reader').open) $('#reader').close(); render(); });
render();
