const { test } = require('node:test');
const assert = require('node:assert/strict');
const { archiveIssues, pickupPreview, inboundSummary } = require('./rules.js');

test('模糊手机号待核对；标为未知后有地址仍可归档，日期可未知', () => {
  const draft = { phone: '138****000?', address: '示例小区1号楼101', problem: '无法启动', association: 'new', source: '示例原文', date: '' };
  assert.ok(archiveIssues(draft).some(x => x.includes('手机号')));
  assert.deepEqual(archiveIssues({ ...draft, phone: '' }), []);
  assert.ok(archiveIssues({ ...draft, phone: '', address: '' }).length);
  assert.ok(archiveIssues({ ...draft, phone: '', association: '' }).length);
  assert.ok(archiveIssues({ ...draft, phone: '', source: '' }).length);
});
test('提货同时减少在库及对应预留，不重复扣可售', () => {
  const result = pickupPreview({ onHand: 10, reserved: 3, remaining: 3, quantity: 2, date: '2026-10-26', t0: '2026-10-01' });
  assert.deepEqual(result.after, { onHand: 8, reserved: 1, available: 7, remaining: 1 });
  for (const quantity of [0, -1, 1.5, 4, NaN]) assert.ok(pickupPreview({ onHand: 10, reserved: 3, remaining: 3, quantity, date: '2026-10-26', t0: '2026-10-01' }).error);
});
test('T0之前、同日起点不明和未建账不可确认', () => {
  const input = { onHand: 10, reserved: 3, remaining: 3, quantity: 2, t0: '2026-10-01' };
  assert.ok(pickupPreview({ ...input, date: '2026-09-30' }).error);
  assert.ok(pickupPreview({ ...input, date: '2026-10-01' }).error);
  assert.ok(pickupPreview({ ...input, onHand: null, date: '2026-10-26' }).error);
});
test('进货按有效原单、包含起止日；不累计期初、盘点和更正单', () => {
  const rows = [
    { id: 'a', type: 'inbound', date: '2026-10-01', warehouse: '2', model: 'A', effective: 4 },
    { id: 'b', type: 'inbound', date: '2026-10-26', warehouse: '3', model: 'A', effective: 8 },
    { id: 'c', type: 'opening', date: '2026-10-12', warehouse: '2', model: 'A', effective: 10 },
    { id: 'd', type: 'adjustment', date: '2026-10-12', warehouse: '2', model: 'A', effective: 2 },
    { id: 'e', type: 'correction', date: '2026-10-12', warehouse: '2', model: 'A', effective: -1 }
  ];
  const filters = { start: '2026-10-01', end: '2026-10-26', warehouse: 'all', model: 'A', group: 'warehouse' };
  assert.equal(inboundSummary(rows, filters).total, 12);
  assert.deepEqual(inboundSummary(rows, filters).groups, [['2', 4], ['3', 8]]);
  assert.equal(inboundSummary(rows, { ...filters, warehouse: '2' }).total, 4);
  assert.ok(inboundSummary(rows, { ...filters, start: '2026-11-01' }).error);
});
