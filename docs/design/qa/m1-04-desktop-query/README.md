# M1-04 电脑/手机模式与查询选择核对

2026-11-02 / **本机页面与交互核对完成，待用户审核**。按AGENTS.md、设计规范两版及用户选定的C电脑侧栏样板实施；没有提交、推送或进入M1-05。

## 实际变更

- 型号保留空白初始与必选校验，增加明确的全部型号；all时overview省略model_id，具体型号仍传ID。必须主动查询。
- 原生datalist会按现有文字筛选，不能保证显示其他库房；改为名称输入加完整库房列表按钮。已有文字时仍列全部，选定更新稳定ID并清除旧结果；可用Tab、Enter及Escape操作。重名附区分编号，保留停用信息。
- shell接入原C电脑左导航/右业务区，顶部模式按钮可手动选择；权限导航只呈现已实现且授权的入口。模式只改容器样式，保留当前结果和未保存输入，不发请求。首次/刷新按1000px宽度初始化，会话内沿用人工选择。手机模式在大窗口仍单列；320px电脑模式使用紧凑侧栏（保留左侧导航），可切回手机端。

## 浏览器证据

使用已登录的demo-owner及现有虚构样例，只查询和编辑未保存表单，没有保存草稿、确认库存或修改客户/库房资料。全部型号在页面优化示例库返回A=5/0/5、B=4/0/4、C=0/0/0，合计9/0/9；D仍未建账。单型号B只返回4/0/4。已有库房名称时可直接展开并选示例2号库，选后未查询卡片数为0，主动查询后为该库30/3/27。

- [电脑初始](desktop-initial.jpg) / [全部型号](desktop-all-models.jpg) / [单型号](desktop-single-model.jpg) / [填名称后的完整列表](warehouse-list-desktop.jpg)。
- [电脑窗口中的手机模式](mobile-mode-desktop-window.jpg) / [320px手机](mobile-320.jpg)。切换后原库房、all及3个分项仍保留；320px clientWidth=scrollWidth=305（工具截图像素和CSS视口不同）。[320px电脑模式](desktop-320.jpg)保留左侧栏、图标和常显短标签，也无页面溢出。
- 实际填入库数量7及“模式切换检查样例（不保存）”，切换到手机并返回电脑后未丢失，见[inbound-desktop](inbound-desktop.jpg)。表单未保存，随后离开。
- 返回库存两条件空、卡片0；空型号点击查询被原生校验阻止。Escape关闭库房列表后焦点回到选择按钮。
- [交互证据](interaction-evidence.json)记录实际DOM状态；浏览器错误日志为空。

## 页面目录与验证范围

下列12页均有本轮电脑截图；本轮核对的是共用布局、导航和当前表单/查询状态，不是重新执行全部写入流程。提货/取消从指定现存样例预留进入，没有保存或确认。

| 编号 | 本轮截图 |
| --- | --- |
| m1-inventory | [库存查询](desktop-all-models.jpg) |
| m1-inbound | [入库登记](inbound-desktop.jpg) |
| m1-outbound | [普通出库](outbound-desktop.jpg) |
| m1-reserve | [办理留货](reserve-desktop.jpg) |
| m1-pickup | [预留提货](pickup-desktop.jpg) |
| m1-cancel | [取消留货](cancel-desktop.jpg) |
| m1-reservations | [预留查询](reservations-desktop.jpg) |
| m1-ledger | [库存流水](ledger-desktop.jpg) |
| m1-pending | [待核对](pending-desktop.jpg) |
| m1-customers | [客户资料](customers-desktop.jpg) |
| m1-catalog | [库房与型号](catalog-desktop.jpg) |
| m1-opening | [期初建账](opening-desktop.jpg) |

## 检查与限制

- `node tests/web-inventory.test.cjs`：7项；`web-layout`：1项；`web-movements`：3项；`web-api-response / web-form-state / web-inbound-time`各2项，共17项生产JS通过。
- `node prototypes/frontend/rules.test.cjs`：4项；app.js、inventory.js、inbound.js、movements.js语法检查通过。新增全部型号、完整列表和模式切换回归先在旧代码失败，再通过。
- 独立只读审查首轮未发现阻断性缺陷，审查时16项JS通过；补充窄侧栏后审查发现重复图标难区分，已增加常显短标签，审查确认P2已解决。随后补充旧库房ID失效回归及只读权限入口断言，由主代理重新运行17项通过。
- 本轮未改后端，未重跑数据库并发、全套业务确认、实体设备、跨浏览器和生产部署；此前126项后端成绩只是历史证据。
- 设计目录V1.9两版同步编号、源文件、入口、截图、状态；旧截图/样板保留历史标识。本次实际查看C库存图、电脑工作台截图、完整HTML/CSS源码和HTML资源目录；未把旧静态样板称为正式业务能力。
