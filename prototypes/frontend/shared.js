const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const icon = name => `<svg class="icon" aria-hidden="true"><use href="../ui-sample/assets/icons.svg#${name}"></use></svg>`;
const routes = {
  home: ['工作台', 'home'], pending: ['待核对', 'file'],
  'service-search': ['售后档案', 'wrench'], inventory: ['库存', 'box'],
  'service-draft': ['售后核对', 'file'], 'service-detail': ['售后档案详情', 'file'],
  'repair-assistant': ['维修辅助', 'wrench'], 'reserved-pickup': ['预留提货', 'box'],
  'inbound-statistics': ['进货统计', 'history'], settings: ['资料与设置', 'settings']
};
const customers = [
  { id: '1', name: '示例客户甲', phone: '138****0001', address: '示例小区1号楼101', model: '示例型号A', date: '2026-10-24' },
  { id: '2', name: '示例客户甲', phone: '138****0001', address: '示例小区2号楼202', model: '', date: '2026-10-18' }
];
const sampleSource = '示例客户甲\n138 0000 000?\n示例小区1号楼101\n设备无法正常启动\n示例型号A\n日期未记';
const draft = { name: '示例客户甲', phone: '138****000?', address: '示例小区1号楼101', problem: '设备无法正常启动', model: '示例型号A', code: '', date: '', association: '', source: sampleSource, method: '', parts: '', result: '' };
const session = { archived: false, pickup: null, stock: { onHand:10, reserved:3, remaining:3 }, supplements: {}, query: '138****0001', warehouse: 'all', model: 'A', pendingFilter: 'all', stats: { start: '2026-10-01', end: '2026-10-26', warehouse: 'all', model: 'A', group: 'date' }, repair: { model: '示例型号A', code: '', problem: '设备无法正常启动' }, photoUrl: '', photoName: '', task: '' };
let toastTimer;
function notify(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4000);
}
function reader(title, html) {
  $('#reader-title').textContent = title;
  $('#reader-content').innerHTML = html;
  if (!$('#reader').open) $('#reader').showModal();
  $('#reader-close').focus();
}
function header(title, { back = '', meta = '示例数据 · 本地交互样板', content = '', action = '' } = {}) {
  return `<header class="page-header material-ink"><div class="page-heading">${back ? `<a class="back-link" href="${back}" aria-label="返回">${icon('back')}</a>` : ''}<div><h1>${title}</h1><p class="meta">${meta}</p></div>${action}</div>${content}</header>`;
}
function field(label, name, value, options = {}) {
  const id = options.id || name;
  const control = options.textarea ? `<textarea class="field" id="${id}" name="${name}" ${options.attrs || ''}>${esc(value)}</textarea>` : `<input class="field" id="${id}" name="${name}" type="${options.type || 'text'}" value="${esc(value)}" ${options.attrs || ''}>`;
  return `<div class="form-field"><label for="${id}">${label}</label>${control}${options.help ? `<p class="helper">${options.help}</p>` : ''}</div>`;
}
function message(text, kind = '', id = '') {
  return `<div ${id ? `id="${id}"` : ''} class="state-message ${kind ? `state-${kind}` : ''}">${icon(kind === 'warning' || kind === 'danger' ? 'warning' : 'file')}<span>${text}</span></div>`;
}
function metrics(onHand, reserved, total = false) {
  return `<dl class="inventory-grid ${total ? 'total-metrics' : ''}"><div><dt>实物在库</dt><dd>${onHand}<small>台</small></dd></div><div><dt>已预留</dt><dd>${reserved}<small>台</small></dd></div><div><dt>可售</dt><dd>${onHand - reserved}<small>台</small></dd></div></dl>`;
}
function footer(left, right, note = '') {
  return `<footer class="action-footer">${note ? `<p class="helper" id="footer-note" aria-live="polite">${note}</p>` : ''}<div class="footer-buttons">${left}${right}</div></footer>`;
}
function sourceView(source = sampleSource, custom = false) {
  return `<p class="helper">${custom ? '本次输入原文 · 来源名称、页码和消息时间未提供' : '示例纸本第3页 · 原件照片尚未提供，以下为示例原文'}</p><pre class="source-paper">${esc(source)}</pre><p class="helper">${custom ? '维修日期按原文核对，未知时保留未知。' : '日期未记；不以提交或归档时间替代维修日期。'}</p>`;
}
function readSource() {
  let source = sampleSource;
  if (location.hash.startsWith('#service-detail')) {
    const customer = selectedCustomer();
    source = sampleSource.replace(customers[0].address,customer.address).replace('示例型号A',customer.model || '型号未记');
  }
  reader('查看来源原文', location.hash.startsWith('#service-draft') ? sourceView(draft.source,session.customSource) : sourceView(source));
}
function warehouseOptions(selected = 'all') {
  return [['all', '全部库房'], ['2', '2号库'], ['3', '3号库'], ['4', '4号库 · 未建账']].map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('');
}
function modelOptions(selected = 'A') {
  return [['all', '全部型号'], ['A', '示例型号A'], ['B', '示例型号B（长型号对照 / 24kW）']].map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('');
}
