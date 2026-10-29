const inboundRows = [
  { id:'RK-003', type:'inbound', date:'2026-10-24', warehouse:'2', model:'A', original:5, effective:5 },
  { id:'RK-002', type:'inbound', date:'2026-10-20', warehouse:'3', model:'A', original:8, effective:8 },
  { id:'RK-001', type:'inbound', date:'2026-10-12', warehouse:'2', model:'A', original:6, effective:5 },
  { id:'QC-001', type:'opening', date:'2026-10-01', warehouse:'2', model:'A', effective:10 },
  { id:'PD-001', type:'adjustment', date:'2026-10-25', warehouse:'2', model:'A', effective:-1 },
  { id:'GZ-001', type:'correction', date:'2026-10-25', warehouse:'2', model:'A', effective:-1 }
];
function inventoryBalances() {
  return [
    { id:'2', model:'A', onHand:session.pickup ? session.pickup.onHand : session.stock.onHand, reserved:session.pickup ? session.pickup.reserved : session.stock.reserved },
    { id:'3', model:'A', onHand:6, reserved:2 },
    { id:'4', model:'A', onHand:null, reserved:null }
  ];
}
function inventoryPage() {
  return header('库存', { action:'<button class="button button-primary" data-action="inventory-actions">登记变动</button>', content:`<div class="split-fields"><div class="form-field"><label for="warehouse-filter">库房</label><select class="field" id="warehouse-filter">${warehouseOptions(session.warehouse)}</select></div><div class="form-field"><label for="model-filter">型号</label><select class="field" id="model-filter">${modelOptions(session.model)}</select></div></div>` }) + `<main id="page-content" tabindex="-1" class="page-body"><div class="inventory-list" id="inventory-list" aria-live="polite"></div><section class="panel total-panel" id="inventory-total"></section><a class="panel route-row" href="#inbound-statistics">${icon('history')}<span>进货统计</span>${icon('chevron')}</a><p class="helper">样例查询截至：2026-10-26 10:30<br>最近登记：2026-10-26 10:20<br>数量依据已登记记录；演示提货仅改变本次会话。</p></main>`;
}
function renderInventory() {
  const rows = inventoryBalances().filter(item => (session.warehouse === 'all' || item.id === session.warehouse) && (session.model === 'all' || item.model === session.model));
  $('#inventory-list').innerHTML = rows.length ? rows.map(item => item.onHand === null ? `<section class="panel inventory-card"><h2>${item.id}号库 · 示例型号${item.model}</h2><div style="margin-top:16px">${message('未建账 · 需由负责人核对实物与既有留货后确认起点。','warning')}</div><p class="helper" style="margin-top:12px">未知数量不显示为0台，不允许常规库存登记。</p></section>` : `<section class="panel inventory-card"><h2>${item.id}号库 · 示例型号${item.model}</h2>${metrics(item.onHand,item.reserved)}<div class="inventory-actions"><button class="text-link" data-ledger="${item.id}">${icon('file')}查看流水</button><button class="text-link" data-reservations="${item.id}">${icon('box')}预留明细</button></div></section>`).join('') : `<section class="panel empty-state">${icon('search')}<h2>未找到对应库房型号</h2><p class="muted">当前样板仅包含示例型号A；请修改筛选条件。</p></section>`;
  const known = rows.filter(item => item.onHand !== null);
  $('#inventory-total').hidden = !known.length;
  $('#inventory-total').innerHTML = `<h2>当前筛选合计</h2>${metrics(known.reduce((sum,item) => sum + item.onHand,0),known.reduce((sum,item) => sum + item.reserved,0),true)}<p class="helper">仅合计 ${known.length} 个已建账库房型号${rows.some(item => item.onHand === null) ? '；未建账项不纳入合计' : ''}。</p>`;
}
function pickupPage() {
  if (session.pickupPending) return header('预留提货', { back:'#pending' }) + `<main id="page-content" tabindex="-1" class="page-body"><section class="panel stack"><h2>提交结果待核验</h2>${message('模拟提交尚未取得回执。保留原操作 DEMO-OP-001，核验完成前不要重新登记。','warning')}<p>YL-001 · 示例客户甲 · 2号库 · 示例型号A</p><p>本次提货 ${session.pickupPending.quantity}台 · ${esc(session.pickupPending.date)}</p><button class="button wide" data-action="check-result">核验原操作结果（演示）</button><div id="pickup-impact" aria-live="polite"></div><a class="button" href="#pending">返回待核对</a></section></main>`;
  if (session.pickup) return header('预留提货', { back:'#inventory' }) + `<main id="page-content" tabindex="-1" class="page-body"><section class="panel receipt">${icon('check')}<h2>模拟提货完成</h2><p>演示编号 DEMO-TH-001 · 未生成正式流水</p><dl class="facts"><div><dt>原预留</dt><dd>YL-001 · 示例客户甲</dd></div><div><dt>提货数量</dt><dd>${session.pickup.quantity}台</dd></div><div><dt>发生日期</dt><dd>${esc(session.pickup.date)}</dd></div><div><dt>剩余预留</dt><dd>${session.pickup.remaining}台 · ${session.pickup.remaining ? '进行中' : '已结束'}</dd></div></dl>${metrics(session.pickup.onHand,session.pickup.reserved)}<p class="helper">本次演示仅更新会话样例。刷新恢复初始数据；不代表后端幂等或事务已实现。</p><a class="button button-primary wide" href="#inventory">返回库存查看变化</a></section></main>`;
  return header('预留提货', { back:'#inventory' }) + `<main id="page-content" tabindex="-1" class="page-body two-column"><form id="pickup-form" class="panel"><h2>核对提货信息</h2><dl class="facts"><div><dt>客户</dt><dd>示例客户甲 · 138****0001</dd></div><div><dt>关联预留</dt><dd><strong>YL-001</strong><br>2号库 · 示例型号A<br>该单剩余：${session.stock.remaining}台</dd></div><div><dt>留货依据</dt><dd>口头约定（示例）</dd></div></dl>${field('本次提货数量 / 台','pickup-quantity',String(Math.min(2,session.stock.remaining)),{type:'number',attrs:`min="1" max="${session.stock.remaining}" step="1" inputmode="numeric" aria-describedby="pickup-error"`})}${field('发生日期','pickup-date','2026-10-26',{type:'date'})}${field('备注','pickup-note',`客户本次提走${Math.min(2,session.stock.remaining)}台`,{textarea:true,attrs:'maxlength="100"'})}<p id="pickup-error" class="helper warning-text" role="alert"></p><details class="demo-tools"><summary>切换示例状态</summary><label for="pickup-scenario">确认时的样例状态</label><select class="field" id="pickup-scenario"><option value="normal">正常预览</option><option value="conflict">预留数量已变化</option><option value="unknown">提交结果待核验</option><option value="denied">当前账号无提货权限</option></select><p class="helper">仅用于评审页面状态，不改变正式业务。</p></details></form><section class="panel source-column"><div class="panel-heading"><h2>预计影响</h2><span class="status status-warning">尚未登记</span></div><div id="pickup-impact" aria-live="polite"></div><p class="helper" style="margin-top:14px">本次同时减少在库和对应预留，可售不重复扣减。</p><p class="helper" style="margin-top:8px">建账起点：2026-10-01 00:00。正式确认时需由后端重新校验当前数量与权限。</p></section></main>` + footer('<a class="button" href="#inventory">取消本次操作</a>','<button class="button button-primary" id="pickup-confirm">确认提货（演示）</button>','请核对原预留、发生日期和预计影响');
}
function updatePickup() {
  const result = FrontendRules.pickupPreview({ ...session.stock, quantity:Number($('#pickup-quantity').value), date:$('#pickup-date').value, t0:'2026-10-01' });
  $('#pickup-error').textContent = result.error || '';
  $('#pickup-quantity').setAttribute('aria-invalid', String(!!result.error));
  $('#pickup-confirm').disabled = !!result.error || $('#pickup-scenario').value === 'denied';
  $('#pickup-impact').innerHTML = result.error ? message('请先修正提货信息，再查看有效预览。','warning') : `<table class="data-table"><thead><tr><th>项目</th><th>当前</th><th>登记后</th></tr></thead><tbody>${[['实物在库',session.stock.onHand,result.after.onHand],['已预留',session.stock.reserved,result.after.reserved],['可售',session.stock.onHand-session.stock.reserved,result.after.available]].map(([name,before,after]) => `<tr><td>${name}</td><td>${before}台</td><td><strong>${after}台</strong></td></tr>`).join('')}</tbody></table>`;
  if ($('#pickup-scenario').value === 'denied') $('#pickup-error').textContent = '当前账号无提货权限，请由具有进出货职责的人员核对。';
  $('#footer-note').textContent = $('#pickup-scenario').value === 'denied' ? '无操作权限 · 未提交' : '请核对原预留、发生日期和预计影响';
  return result;
}
function statisticsPage() {
  const filters = session.stats;
  return header('进货统计', { back:'#inventory' }) + `<main id="page-content" tabindex="-1" class="page-body stat-layout"><form id="statistics-form" class="panel"><h2>查询已登记进货</h2><div class="split-fields">${field('开始日期','stat-start',filters.start,{type:'date'})}${field('结束日期','stat-end',filters.end,{type:'date'})}</div><div class="form-field"><label for="stat-warehouse">库房</label><select class="field" id="stat-warehouse">${warehouseOptions(filters.warehouse)}</select></div><div class="form-field"><label for="stat-model">型号</label><select class="field" id="stat-model">${modelOptions(filters.model)}</select></div><button class="button button-primary wide">查询</button><p class="helper" style="margin-top:12px">按 Asia/Shanghai 自然日，包含起止日期。</p><p class="helper warning-text" id="stat-error" role="alert"></p></form><section class="stack" id="stat-results" aria-live="polite"></section></main>`;
}
function currentStatistics() { return FrontendRules.inboundSummary(inboundRows,session.stats); }
function renderStatistics() {
  const filters = session.stats;
  const result = currentStatistics();
  $('#stat-error').textContent = result.error || '';
  if (result.error) { $('#stat-results').innerHTML = message(result.error,'warning'); return; }
  if (filters.warehouse === '4' || filters.model === 'B') { $('#stat-results').innerHTML = message(filters.warehouse === '4' ? '4号库未建账，本账期无登记覆盖；不能报告为0进货。' : '示例型号B尚无已建账数据，当前样板未覆盖该型号。','warning'); return; }
  if (filters.end < '2026-10-01') { $('#stat-results').innerHTML = message('查询范围早于建账起点，本账期未覆盖；不能报告为0进货。','warning'); return; }
  if (filters.start > '2026-10-26') { $('#stat-results').innerHTML = message('查询范围晚于样例数据截至时间，尚未覆盖；不能报告为0进货。','warning'); return; }
  const groupNames = { date:'发生日期', warehouse:'库房', model:'型号' };
  $('#stat-results').innerHTML = `<section class="panel"><h2>已登记进货合计</h2><p class="stat-number">${result.total}<small>台</small></p><div class="stat-scope"><p class="helper">建账起点：2号库、3号库 / 示例型号A<br>2026-10-01 00:00</p><p class="helper">查询截至：2026-10-26 10:30（样例）</p></div>${filters.start < '2026-10-01' ? message('所选范围部分早于建账起点，仅汇总已覆盖时段。','warning') : ''}${filters.end > '2026-10-26' ? message('查询结束日期晚于样例截至时间，后续时段尚未覆盖。','warning') : ''}</section><section class="panel stack"><div class="segmented" aria-label="统计分组">${[['date','按日期'],['warehouse','按库房'],['model','按型号']].map(([value,label]) => `<button data-group="${value}" aria-pressed="${filters.group === value}">${label}</button>`).join('')}</div><table class="data-table"><thead><tr><th>${groupNames[filters.group]}</th><th>有效进货量</th></tr></thead><tbody>${result.groups.length ? result.groups.map(([label,value]) => `<tr><td>${filters.group === 'warehouse' ? label+'号库' : filters.group === 'model' ? '示例型号'+label : label}</td><td>${value}台</td></tr>`).join('') : '<tr><td colspan="2">已覆盖范围内无有效进货记录</td></tr>'}</tbody><tfoot><tr><td>合计</td><td>${result.total}台</td></tr></tfoot></table><button class="button wide" data-action="inbound-documents">查看对应入库单</button>${message('仅统计建账后已登记入库的有效量。期初、盘点调整不计入进货；更正计入原单，不重复累加。')}</section>`;
}
function bindInventory() {
  if ($('#warehouse-filter')) {
    renderInventory();
    $('#warehouse-filter').addEventListener('change', event => { session.warehouse = event.target.value; renderInventory(); });
    $('#model-filter').addEventListener('change', event => { session.model = event.target.value; renderInventory(); });
  }
  if ($('#pickup-form')) {
    updatePickup();
    $('#pickup-form').addEventListener('submit', event => event.preventDefault());
    $('#pickup-form').addEventListener('input', updatePickup);
    $('#pickup-scenario').addEventListener('change', updatePickup);
    $('#pickup-confirm').addEventListener('click', () => {
      const result = updatePickup();
      if (result.error) return;
      const scenario = $('#pickup-scenario').value;
      if (scenario === 'denied') return;
      if (scenario === 'conflict') {
        session.stock = { onHand:8, reserved:1, remaining:1 };
        $('#pickup-form').inert = true;
        $('#pickup-confirm').disabled = true;
        $('#pickup-impact').innerHTML = message('预留已由其他人提走2台。最新在库8、预留1、可售7，YL-001剩余1台。原预览失效，当前操作未提交。','warning') + '<button class="button wide" data-action="reload-pickup" style="margin-top:16px">返回库存重新核对</button>';
        $('#footer-note').textContent = '原预览已失效 · 本次未提交';
        return;
      }
      if (scenario === 'unknown') {
        session.pickupPending = { quantity:Number($('#pickup-quantity').value), date:$('#pickup-date').value };
        render();
        return;
      }
      const quantity = Number($('#pickup-quantity').value);
      session.pickup = { ...result.after, quantity, date:$('#pickup-date').value };
      render();
    });
  }
  if ($('#statistics-form')) {
    renderStatistics();
    $('#statistics-form').addEventListener('input', () => { $('#stat-results').innerHTML = message('筛选条件已修改，请点击查询更新统计。','warning'); });
    $('#statistics-form').addEventListener('submit', event => {
      event.preventDefault();
      session.stats = { start:$('#stat-start').value, end:$('#stat-end').value, warehouse:$('#stat-warehouse').value, model:$('#stat-model').value, group:session.stats.group };
      renderStatistics();
    });
  }
}
