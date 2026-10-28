const dialog = document.querySelector('#sample-dialog');
const dialogBody = document.querySelector('#dialog-body');
const taskInput = document.querySelector('#task-input');
const photoInput = document.querySelector('#photo-input');
const errorNode = document.querySelector('#task-error');
let photoUrl = '';
let toastTimer;

function icon(name) {
  return '<svg class="icon icon-small" aria-hidden="true"><use href="#' + name + '"></use></svg>';
}
function escapeText(value) {
  return String(value).replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
}
function openPanel(title, content) {
  document.querySelector('#dialog-title').textContent = title;
  dialogBody.innerHTML = content;
  if (!dialog.open) dialog.showModal();
}
function notify(message) {
  const node = document.querySelector('#toast');
  clearTimeout(toastTimer);
  node.textContent = message;
  node.hidden = false;
  toastTimer = setTimeout(() => { node.hidden = true; }, 3500);
}
function inputTask(text) {
  taskInput.value = text;
  taskInput.focus();
  errorNode.hidden = true;
  taskInput.removeAttribute('aria-invalid');
}
function resetPhoto() {
  if (photoUrl) URL.revokeObjectURL(photoUrl);
  photoUrl = '';
  photoInput.value = '';
  document.querySelector('#attachment').hidden = true;
}
const sampleCustomers = [
  {name: '示例客户甲', phone: '138****0001', address: '示例小区1号楼101', date: '2026-10-24'},
  {name: '示例客户甲', phone: '138****0001', address: '示例小区2号楼202', date: '2026-10-18'}
];
function renderCandidates(query = '') {
  const list = document.querySelector('#candidate-list');
  const matched = sampleCustomers.filter(item => (item.name + item.phone + item.address).includes(query.trim()));
  list.innerHTML = matched.length ? matched.map((item) =>
    '<article class="candidate"><h3>' + item.name + '</h3><p class="muted small">' + item.phone + '</p><p class="address">' + item.address + '</p><p class="muted small">最近记录 ' + item.date + '</p><button class="text-link" data-address="' + item.address + '">查看该地址档案' + icon('chevron') + '</button></article>'
  ).join('') : '<p class="state-message">当前示例档案中没有匹配项，请修改手机号或地址。</p>';
}
function showHistory() {
  openPanel('查上次记录', '<form id="history-form" class="search-bar"><label class="sr-only" for="history-query">手机号或地址</label><input class="field" id="history-query" placeholder="手机号 / 地址关键词"><button class="button button-primary">查找</button></form><p class="helper" style="margin-top:12px">示例档案：138****0001，请先选择服务地址。</p><div id="candidate-list"></div>');
  renderCandidates();
}
function showInventory() {
  openPanel('查库存', '<div class="form-field"><label for="warehouse-select">库房 · 示例型号A</label><select class="field" id="warehouse-select"><option value="all">全部库房</option><option value="2">2号库</option><option value="3">3号库</option></select></div><div id="inventory-results"></div><p class="helper" style="margin-top:12px">示例数据 · 查询截至 2026-10-26 10:30</p>');
  renderInventory('all');
}
function renderInventory(warehouse) {
  const rows = [{id:'2',onHand:10,reserved:3}, {id:'3',onHand:6,reserved:2}].filter(row => warehouse === 'all' || row.id === warehouse);
  document.querySelector('#inventory-results').innerHTML = rows.map(row => '<section class="inventory-summary"><h3>' + row.id + '号库 · 示例型号A</h3><dl class="inventory-grid"><div><dt>在库</dt><dd>' + row.onHand + '</dd></div><div><dt>预留</dt><dd>' + row.reserved + '</dd></div><div><dt>可售</dt><dd>' + (row.onHand-row.reserved) + '</dd></div></dl></section>').join('');
}
const actions = {
  home() { window.scrollTo({top: 0, behavior: 'auto'}); },
  close() { dialog.close(); },
  settings() {
    openPanel('资料与设置', '<p class="muted">当前为示例门店的视觉样板。</p><div class="kit-stack" style="margin-top:16px"><a class="button" href="ui-kit.html">查看视觉组件</a><a class="button" href="../../docs/design/mobile-pages-c-v1.html">查看七页概念图</a></div>');
  },
  async paste() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) { inputTask(text); notify('已粘贴，请核对内容'); }
      else { taskInput.focus(); notify('剪贴板暂无文字，可在输入框填写'); }
    } catch {
      taskInput.focus();
      notify('请在输入框中粘贴文字');
    }
  },
  upload() { photoInput.click(); },
  'remove-photo': resetPhoto,
  organize() { inputTask('整理这条售后记录：'); },
  history: showHistory,
  inventory: showInventory,
  repair() {
    openPanel('维修辅助', '<div class="form-field"><label for="repair-model">设备型号</label><input class="field" id="repair-model" value="示例型号A"></div><div class="form-field"><label for="repair-problem">问题与报错码</label><textarea class="field" id="repair-problem" placeholder="描述现场现象和设备报错码"></textarea></div><div class="state-message state-warning">' + icon('warning') + '此样板展示资料缺口状态；当前没有接入维修手册，需先补充资料依据。</div>');
  },
  pending() {
    openPanel('待核对 · 2 条', '<div class="record-list"><div class="record-row pending">' + icon('file') + '<div class="record-main"><strong>售后草稿</strong><p>示例客户甲 · 手机号待核对</p></div><button class="text-link" data-action="draft">继续核对</button></div><div class="record-row pending">' + icon('box') + '<div class="record-main"><strong>提货草稿</strong><p>2号库 · 示例型号A</p></div><button class="text-link" data-action="pickup">继续核对</button></div></div>');
  },
  draft() {
    openPanel('售后核对 · 示例草稿', '<div class="state-message state-warning">' + icon('warning') + '手机号有一处不清，请对照原件核对。</div><div class="form-field" style="margin-top:16px"><label for="draft-phone">手机号 · 待核对</label><input class="field field-warning" id="draft-phone" value="138****000?"><p class="helper">原件及完整页面见概念图册。</p></div><div class="button-row"><button class="button button-primary" disabled>确认归档</button><a class="text-link" href="../../docs/design/assets/mobile-c/01-service-draft.png">查看完整概念图</a></div>');
  },
  pickup() {
    openPanel('预留提货 · 示例预览', '<p>示例客户甲 · 2号库 · 示例型号A</p><p class="helper">本次提货 2 台 · 尚未登记</p><dl class="inventory-grid"><div><dt>在库</dt><dd>10→8</dd></div><div><dt>预留</dt><dd>3→1</dd></div><div><dt>可售</dt><dd>7→7</dd></div></dl><div class="state-message" style="margin-top:16px">提货同时减少在库和对应预留，可售不重复扣减。</div><a class="text-link" href="../../docs/design/assets/mobile-c/06-reserved-pickup.png">查看完整确认页概念图</a>');
  }
};
document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (button && actions[button.dataset.action]) actions[button.dataset.action]();
  const candidate = event.target.closest('[data-address]');
  if (candidate) {
    const selected = sampleCustomers.find(item => item.address === candidate.dataset.address);
    openPanel('售后档案 · 示例记录', '<h3>' + escapeText(candidate.dataset.address) + '</h3><p class="muted small">示例客户甲 · 138****0001</p><div class="record-list" style="margin-top:16px"><article class="candidate"><h3>设备无法正常启动</h3><p class="helper">示例记录 · ' + selected.date + '</p><p class="address">处理方法：已完成现场检查</p><span class="status status-warning">最终结果待师傅补充</span></article></div><a class="text-link" href="../../docs/design/assets/mobile-c/03-service-detail.png">查看档案详情概念图</a>');
  }
});
document.addEventListener('submit', event => {
  if (event.target.id === 'history-form') {
    event.preventDefault();
    renderCandidates(document.querySelector('#history-query').value);
  }
});
document.addEventListener('change', event => {
  if (event.target.id === 'warehouse-select') renderInventory(event.target.value);
});
photoInput.addEventListener('change', () => {
  const file = photoInput.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { resetPhoto(); notify('请选择图片文件'); return; }
  if (photoUrl) URL.revokeObjectURL(photoUrl);
  photoUrl = URL.createObjectURL(file);
  document.querySelector('#attachment-name').textContent = file.name;
  document.querySelector('#attachment').hidden = false;
  errorNode.hidden = true;
  taskInput.removeAttribute('aria-invalid');
});
taskInput.addEventListener('input', () => { errorNode.hidden = true; taskInput.removeAttribute('aria-invalid'); });
document.querySelector('#task-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!taskInput.value.trim() && !photoUrl) {
    errorNode.textContent = '请先填写任务内容，或上传一张照片。';
    errorNode.hidden = false;
    taskInput.setAttribute('aria-invalid', 'true');
    taskInput.focus();
    return;
  }
  taskInput.removeAttribute('aria-invalid');
  const content = '<span class="status status-warning">演示草稿 · 尚未归档</span>' +
    (taskInput.value.trim() ? '<p class="preview-text">' + escapeText(taskInput.value) + '</p>' : '') +
    (photoUrl ? '<img class="preview-image" src="' + photoUrl + '" alt="本次上传的照片预览">' : '') +
    '<p class="helper">内容仅在本次预览中显示。后续业务页面将继续核对对象、字段及依据。</p>';
  openPanel('任务内容预览', content);
});
dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const box = dialog.getBoundingClientRect();
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
});
