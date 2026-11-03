# 前端模拟接口契约

2026-11-03。本文对应独立前端演示入口的 `FrontendMock`，不代表后端或生产能力已完成。实现位于 [mock-api.js](../../app/web/mock-api.js)，严格 TypeScript 声明位于 [contracts.ts](../../app/web/contracts.ts)，业务验收测试位于 [web-mock-api.test.cjs](../../tests/web-mock-api.test.cjs)。

## 隔离与生命周期

模拟入口在调用真实 `api` 的第一步转给 `FrontendMock.request(path, method, body)`；适配器本身不调用或改写 `fetch`，未知端点直接拒绝，不回落真实网络。所有目录、客户、账号、库存、原单和流水均为虚构样例，只保存在当前页面内存；刷新或 `reset()` 后丢失。多标签之间不共享，不能用于真实授权、事务或并发验收。

公共入口为 `globalThis.FrontendMock`，并提供 CommonJS exports 供 Node 测试。方法：

| 方法 | 语义 |
| --- | --- |
| `request(path, method='GET', body?)` | 异步返回脱离内部存储的 JSON 快照；路径使用客户端已有 `/auth/...`、`/inventory/...` 等前缀，也接受 `/api/...` |
| `setScenario(name)` | 仅切换故障行为，保留已有账本和登录态；返回 `{scenario,demo:true}` |
| `getScenario()` | 返回当前场景名 |
| `reset()` | 按当前场景重建样例，并恢复 `demo-owner`；返回 `{scenario,demo:true}` |

`empty` 必须选择后再重置，才能观察全空账本。这样切换场景不会意外丢失正在核验的原操作。

## 场景与样例

| 场景 | 可验证结果 |
| --- | --- |
| `normal` | 默认样例：一号库/A1期初8台、有效入库4台，在库12、预留2、可售10；其他库房型号组合未建账 |
| `empty` | 重置后保留两库、两型号、一客户供建账；账户、原单、流水、预留和草稿为空，未知库存返回 `null` |
| `error` | 所有request返回演示503；控制方法仍可用，可切回正常重试 |
| `conflict` | 保存草稿和查询正常；确认返回409且不写入。切回正常、重新保存并预览可恢复 |
| `pending` | 首次确认保存模拟事实和回执后抛出status=0，模拟响应丢失。按原操作GET得到`succeeded`与原回执，重试同确认返回原回执，不重复扣增库存 |

场景中的“已登记”始终只是演示结果。页面必须持续展示演示标识，不把旧页面的正式回执措辞作为真实提交证明。正常重置不会预设未完成草稿；用户保存缺项或完整草稿后，待核对页显示相应项。

## 登录与角色

初始以负责人演示身份进入；退出后 `/auth/me` 返回401。只接受 `demo-owner`、`demo-clerk`、`demo-technician`、`demo-stock_operator`（也接受无`demo-`前缀的角色名），口令仅`demo`或`演示`，不需也不应输入真实密码。

角色权限沿用当前Python角色表：负责人包含库存建账、更正和目录维护；店员可查询库存、留货和取消；进出货人员可入库、普通出库和预留提货；维修人员只查询库存。草稿和操作绑定创建账号；其他账号不能查看或确认。模拟权限用于页面演示，正式权限仍须服务端重新校验。

## 端点

| 方法与路径 | 输入/响应 |
| --- | --- |
| GET `/auth/csrf` | 演示token；不产生服务端凭据 |
| POST `/auth/login` | `{username,password}` → Identity |
| GET `/auth/me` | Identity，含id、username、roles、permissions、enabled |
| POST `/auth/logout` | 清空演示登录态 |
| GET `/catalog/warehouses`、`/catalog/models`、`/catalog/customers` | 对应目录数组，实体id为UUID格式字符串 |
| POST `/catalog/warehouses` | `{name,code?,confirmed:true}` → 库房 |
| POST `/catalog/models` | `{name,aliases?,confirmed:true}` → 型号 |
| POST `/catalog/customers` | `{display_name,phone?,address?,confirmed:true}` → 客户 |
| PATCH `/catalog/{warehouses或models}/{id}` | 可修改字段、`expected_version`、`confirmed:true`；版本冲突409，保留内存修订 |
| GET `/drafts` | 仅当前账号有权限的missing/ready草稿数组 |
| POST `/drafts` | `{kind,parameters}` → Draft；保存不改变库存 |
| GET `/drafts/{id}` | 对应草稿快照 |
| PATCH `/drafts/{id}` | `{expected_version,parameters}` → 新版本Draft，旧操作失效 |
| GET `/operations/{id}` | `{id,state:'pending'或'invalidated'或'succeeded',result:Receipt或null}` |
| POST `/operations/{id}/confirm` | `{draft_id,draft_version,parameters}`；须与预览绑定参数完全相等（对象键顺序无关）→ Receipt |
| GET `/inventory/overview` | 必填warehouse_id，可选model_id → 库房、items、totals、queried_at；未建账数量null |
| GET `/inventory/balance` | warehouse_id、model_id → Balance及关联预留 |
| GET `/inventory/reservations` | 可选warehouse_id/model_id/q，active_only默认true；q匹配客户、联系方式、地址或完整预留id |
| GET `/inventory/ledger` | warehouse_id/model_id，可选start/end/kind/reservation_id → 流水数组（版本逆序） |
| GET `/inventory/documents` | 可选warehouse_id/model_id → 可更正的inbound/outbound/pickup原单及历次更正 |
| GET `/inventory/statistics` | start/end必填，group_by=date/warehouse/model，可选warehouse_id/model_id → Statistics |
| GET `/inventory/reconciliation` | 可选warehouse_id/model_id → Reconciliation；仅负责人 |

## 数据与业务边界

- 参数形状以 `ParametersByKind` 为准：`inventory_opening`、`inventory_inbound`、`inventory_outbound`、`reservation_create`、`reservation_cancel`、`reservation_pickup`、`inventory_adjustment`、`inventory_correction`。缺项保留草稿，返回`missing_fields`与空preview/operation_id；补齐才生成ready预览与稳定操作id。
- 日期精度为`{precision:'date',date:'YYYY-MM-DD',t0_relation?,boundary_note?}`，不编造时刻；精确时刻为`{precision:'datetime',at:含时区ISO字符串}`。UTC或`+08:00`可传输，日期筛选按北京时间。T0之前与当时事件拒绝重复计入；T0同日只知日期时，必须核实after并记录边界依据。
- 确认核对草稿版本、账号、参数以及库房/型号/账户/关联原单/预留版本；变化返回409，重新保存预览。成功操作只返回原回执，库存不重复变动。
- 在库与预留为非负整数且预留不超过在库。可售=在库−预留；提货同时扣在库和预留；取消仅释放对应剩余量。期初预留从已提/已取消为0开始。
- 盘点按目标实物数调整，不能低于预留。原单更正保留original_quantity、effective_quantity和corrections，提货更正同时修复对应预留已提量。更正流水使用更正登记时间，原单发生精度保持原样。
- Statistics只汇总所选发生日期范围内有效inbound原单；期初、调整和更正记录不作为新增进货。原单更正后的有效量影响统计，并可展开历次修订。coverage按建账点与查询日期返回覆盖说明。
- Reconciliation分别从流水增量、预留剩余与有效原单重建数量；未建账返回consistent:null，不声称零库存或对账一致。演示不会自动修复差异。

成功回执提供`demo:true`、kind、draft_id/draft_version、account_id、business_id、operation_id、ledger_ids、actor_id、quantity、occurred、registered_at、balance和关联reservation；建账增加opening_reserved，更正增加delta/old_quantity/new_quantity/original_document_id。回执余额是确认时快照，最新值重新查询。

错误为带`status:number`的Error，message带`【演示】`；常见401未登录、403无权限、404未知实体/端点、409版本/绑定冲突、422业务约束、503模拟故障、0响应丢失待核验。

## 验证与限制

`node --test --test-isolation=none tests/web-mock-api.test.cjs`：12项通过，覆盖网络隔离、库存全链、幂等、草稿与账户版本冲突、原操作恢复、T0边界、建账、统计与原单/提货更正、角色权限和目录版本。普通Node测试子进程在当前沙箱返回spawn EPERM，因此采用无子进程隔离运行。

`contracts.ts`接受严格TypeScript接口声明检查；现有原生JavaScript并未被宣称完整静态类型检查，运行时由上述行为测试覆盖。模拟器只覆盖页面当前消费的库存接口与演示认证，不实现真实账号管理、资料上传、售后或维修服务端。它不证明真实PostgreSQL事务、服务端鉴权、CSRF、跨客户端并发、持久化或门店试用已验收。
