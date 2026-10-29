function pendingCards(filter = 'all') {
  const items = [
    ...(!session.archived ? [{ type: 'service', label: '售后草稿', title: session.customSource ? draft.name || '新售后草稿' : '示例客户甲', description: session.customSource ? '本次输入 · 等待手工核对字段' : '手机号识别不清 · 客户关联待确认', time: session.customSource ? '本次会话，未持久保存' : '2026-10-26 10:25', route: 'service-draft', state: '待核对' }] : []),
    ...(!session.pickup ? [{ type: 'inventory', label: '提货草稿', title: '2号库 · 示例型号A', description: `YL-001 · 示例客户甲 · 本次提货${session.pickupPending?.quantity ?? 2}台`, time: '2026-10-26 10:20', route: 'reserved-pickup', state: session.pickupPending ? '结果待核验' : '待确认' }] : [])
  ].filter(item => filter === 'all' || item.type === filter);
  return items.length ? items.map(item => `<article class="pending-card"><div class="panel-heading"><span class="eyebrow">${item.label}</span><span class="status status-warning">${item.state}</span></div><h3>${item.title}</h3><p class="muted">${item.description}</p><p class="helper">样例保存时间 ${item.time}</p><a class="text-link" href="#${item.route}">继续核对 ${icon('chevron')}</a></article>`).join('') : `<div class="empty-state">${icon('check')}<h3>当前没有待核对草稿</h3><p class="muted">本次演示已处理的任务可在相应页面查看。</p><a class="button" href="#home">返回工作台</a></div>`;
}
function homePage() {
  return header('门店助手', { meta: '示例门店 · 示例接单员', action: '<a class="quiet-button on-dark" href="#settings">资料与设置</a>' }) +
    `<main id="page-content" tabindex="-1" class="home-columns"><div class="home-main"><section class="home-task material-ink"><form id="task-form"><h2><label for="task-input">今天要处理什么？</label></h2><textarea class="task-input" id="task-input" rows="3" placeholder="输入要查找或登记的内容…">${esc(session.task)}</textarea><div class="task-actions"><button type="button" class="button button-dark-outline" data-action="paste">${icon('clipboard')}粘贴文字</button><button type="button" class="button button-dark-outline" data-action="upload">${icon('photo')}上传照片</button><button class="button button-primary">开始</button></div><input id="photo-input" type="file" accept="image/jpeg,image/png,image/webp" hidden><div id="attachment" class="attachment" ${session.photoUrl ? '' : 'hidden'}><span id="photo-name">${esc(session.photoName)}</span><button type="button" data-action="remove-photo">移除</button></div><p id="task-error" class="task-error" role="alert" hidden></p><p class="helper">可先整理、后核对。样板不自动识别内容；照片仅在本次会话预览，支持 JPG/PNG/WebP，单张不超过10MB。</p></form></section>
    <section class="shortcuts" aria-label="常用功能">${[['service-draft','clipboard','整理售后'],['service-search','history','查上次记录'],['repair-assistant','wrench','维修辅助'],['inventory','box','查库存']].map(([route, name, title]) => `<a class="shortcut" href="#${route}">${icon(name)}<span>${title}</span></a>`).join('')}</section>
    </div><aside class="panel home-pending"><div class="panel-heading"><h2>待核对 <span class="count">${Number(!session.archived) + Number(!session.pickup)}</span></h2><a class="text-link" href="#pending">查看全部</a></div>${pendingCards()}<div class="home-note">${message('核对对象、字段和来源后，再明确确认。此处全部使用虚构示例。')}</div></aside>
    <section class="recent-list"><div class="section-heading"><h2>最近任务</h2><span class="helper">示例记录</span></div><div class="record-list"><a class="route-row" href="#service-search">${icon('history')}<span>售后历史查询<small class="muted" style="display:block;font-weight:400">已完成 · 样例10月26日 10:20</small></span>${icon('chevron')}</a><a class="route-row" href="#inventory">${icon('box')}<span>2号库库存查询<small class="muted" style="display:block;font-weight:400">已完成 · 样例10月26日 09:45</small></span>${icon('chevron')}</a></div></section></main>`;
}
function pendingPage() {
  return header('待核对', { meta: '继续上次的整理与登记 · 示例数据' }) + `<main id="page-content" tabindex="-1" class="page-body"><div class="segmented" aria-label="草稿分类">${[['all','全部'],['service','售后'],['inventory','库存']].map(([value, label]) => `<button data-pending="${value}" aria-pressed="${session.pendingFilter === value}">${label}</button>`).join('')}</div><section class="panel" id="pending-list">${pendingCards(session.pendingFilter)}</section><p class="helper">仅演示当前账号可处理的两条样例；浏览器刷新后恢复初始数据。</p></main>`;
}
function settingsPage() {
  return header('资料与设置', { back: '#home' }) + `<main id="page-content" tabindex="-1" class="page-body"><section class="panel stack"><h2>本次样板的范围</h2><p>已完成核心业务页面的视觉与本地交互，尚未接入账号、手册或后端。</p>${message('登录、资料发布、库房与型号维护、期初建账、库存更正和账号权限，按后续阶段实施。当前入口不模拟这些管理能力。','warning')}<a class="button wide" href="../ui-sample/ui-kit.html">查看共用视觉组件</a><a class="button wide" href="../../docs/design/design-resources.html">设计资源与核对记录</a><a class="button wide" href="../../docs/design/design-resources.html#concepts">七页原始概念图</a></section></main>`;
}
function bindWorkbench() {
  document.querySelectorAll('[data-pending]').forEach(button => button.addEventListener('click', () => { session.pendingFilter = button.dataset.pending; document.querySelectorAll('[data-pending]').forEach(item => item.setAttribute('aria-pressed',String(item === button))); $('#pending-list').innerHTML = pendingCards(session.pendingFilter); }));
  if (!$('#task-form')) return;
  $('#task-input').addEventListener('input', event => { session.task = event.target.value; $('#task-error').hidden = true; });
  $('#photo-input').addEventListener('change', event => {
    const file = event.target.files[0];
    if (!file) return;
    if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) { event.target.value = ''; notify('请选择10MB以内的 JPG、PNG 或 WebP 图片'); return; }
    if (session.photoUrl) URL.revokeObjectURL(session.photoUrl);
    session.photoUrl = URL.createObjectURL(file); session.photoName = file.name;
    $('#attachment').hidden = false; $('#photo-name').textContent = file.name; $('#task-error').hidden = true;
  });
  $('#task-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!session.task.trim() && !session.photoUrl) { $('#task-error').textContent = '请先填写任务内容，或上传一张照片。'; $('#task-error').hidden = false; $('#task-input').focus(); return; }
    reader('任务内容预览', `${message('演示输入 · 尚未识别或登记','warning')}<p class="preview-text">${esc(session.task)}</p>${session.photoUrl ? `<img class="preview-image" src="${session.photoUrl}" alt="本次选择的照片">` : ''}<p class="helper">本样板不自动判断任务类型。选择下一步，原输入会保留。</p><div class="button-row"><button class="button button-primary" data-action="task-to-draft">继续整理售后</button><a class="button" href="#service-search" data-close-reader>查档案</a><a class="button" href="#inventory" data-close-reader>查库存</a></div>`);
  });
}
