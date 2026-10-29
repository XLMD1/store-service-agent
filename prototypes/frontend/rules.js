/* 仅供样板预览；正式业务校验、数量计算和事务必须由后端完成。 */
const FrontendRules = (() => {
  function archiveIssues(draft) {
    const issues = [];
    if (!draft.phone.trim() && !draft.address.trim()) issues.push('手机号和服务地址至少填写一项');
    if (draft.phone && !/^1\d{10}$/.test(draft.phone)) issues.push('手机号需核对为完整号码，或明确标为未知');
    if (!draft.problem.trim()) issues.push('请填写问题描述');
    if (!draft.association) issues.push('请选择客户与地址关联方式');
    if (!draft.source.trim()) issues.push('请保留来源原文');
    return issues;
  }
  function pickupPreview({ onHand, reserved, remaining, quantity, date, t0 }) {
    if (onHand === null) return { error: '该库房型号未建账，请联系负责人确认建账起点' };
    if (!Number.isInteger(quantity) || quantity <= 0) return { error: '提货数量必须是正整数' };
    if (quantity > remaining || quantity > reserved || quantity > onHand) return { error: '提货数量不能超过该单剩余预留或实物在库' };
    if (!date) return { error: '请核对发生日期' };
    if (date < t0) return { error: '发生日期在建账起点之前，不能重复计入本账期' };
    if (date === t0) return { error: '与建账起点同日，需核实事件发生在建账前后，本样板暂停确认' };
    return { after: { onHand: onHand - quantity, reserved: reserved - quantity, available: onHand - reserved, remaining: remaining - quantity } };
  }
  function inboundSummary(rows, filters) {
    if (!filters.start || !filters.end || filters.start > filters.end) return { error: '请填写有效的起止日期，开始日期不能晚于结束日期' };
    const selected = rows.filter(row => row.type === 'inbound' && row.date >= filters.start && row.date <= filters.end && (filters.warehouse === 'all' || row.warehouse === filters.warehouse) && (filters.model === 'all' || row.model === filters.model));
    const groups = new Map();
    selected.forEach(row => {
      const key = row[filters.group];
      groups.set(key, (groups.get(key) || 0) + row.effective);
    });
    return { rows: selected, total: selected.reduce((sum, row) => sum + row.effective, 0), groups: [...groups].sort((a, b) => filters.group === 'date' ? String(b[0]).localeCompare(String(a[0])) : String(a[0]).localeCompare(String(b[0]))) };
  }
  return { archiveIssues, pickupPreview, inboundSummary };
})();
if (typeof module !== 'undefined') module.exports = FrontendRules;
