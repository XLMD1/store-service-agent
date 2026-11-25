# M4-02 全链路与权限回归

2026-11-24 首轮执行。代码基线为 `83f1ed6`（已合入 GitHub 主分支 `cd08ab6`）。改动只补测试与验收记录。后端使用专用本机 PostgreSQL、独立附件目录和虚构数据。OCR、模型选句及模型不可用场景使用可控替身。

| 执行范围 | 结果 | 本机记录 |
| --- | --- | --- |
| 原有后端完整套件 | 312 通过，265.17 秒 | `.local/m4-02-backend.xml` |
| 新增全链路验收 | 7 通过，9.86 秒 | `.local/m4-02-acceptance.xml` |
| 前端回归 | 80 通过 | `.local/m4-02-frontend.log` |
| 工费补充、维修首查和全链路联测 | 16 通过，24.40 秒 | `.local/m4-02-fees-and-repair.xml` |
| 全链路与真实进程重启复验 | 9 通过，23.98 秒 | `.local/m4-02-process.xml` |

```powershell
$env:M1_TEST_CONFIG = (Resolve-Path '.local/test.json').Path
.venv/Scripts/python.exe -m pytest -q --junitxml=.local/m4-02-all-backend.xml
npm.cmd run test:frontend
```

新增用例初次补验时，两项请求因缺少人工核对字段和补充原件被拒绝。测试补齐这些前置步骤后重跑通过，业务代码无改动。

下表按 [PRD 验收编号](../prd/store-service-agent-prd-v1.0.md#132-核心验收用例)追踪证据。「样例通过」指本轮自动化覆盖的行为。AC-33 引用 M4-01 已执行的隔离演练。

| 编号 | 本轮判定 | 证据或缺口 |
| --- | --- | --- |
| AC-01、02 | 样例通过 | [全链路](../../tests/acceptance/test_m4_workflows.py)用合成图与 OCR 替身验证原件原样保留、两条独立草稿、模糊号码待核对、确认前无历史档案。真实材料提取评测仍暂缓。 |
| AC-03 | 样例通过 | [全链路](../../tests/acceptance/test_m4_workflows.py)验证未填写维修日期的纸本草稿，经人工核对归档后维修日期仍未知，归档时间落在提交窗口内。 |
| AC-04、05 | 样例通过 | [售后档案](../../tests/integration/test_service_archive.py)核对同号不同地址、正确关联、旧版确认拒绝和重试回执。 |
| AC-06 | 样例通过 | [补充结果](../../tests/integration/test_service_revisions.py)核对追加新照片、保留原记录和来源。 |
| AC-07 | 样例通过 | [全链路](../../tests/acceptance/test_m4_workflows.py)验证两位接单员从同一版本同时提交，各自附补充照片。仅一项成功，另一项收到冲突，已保存的补充保留。 |
| AC-08、09 | 样例通过 | [档案查找](../../tests/integration/test_service_archive.py)及[页面用例](../../tests/web-service-archive.test.cjs)核对号码、地址、原件访问和「已归档范围内未找到」提示。 |
| AC-10、11 | 样例通过 | [全链路](../../tests/acceptance/test_m4_workflows.py)用两份虚构手册区分同码不同义、型号缺失先补充，并校验带条件建议的页码和原图。真实机型适用性留待师傅核对。 |
| AC-12 | 样例通过 | [维修辅助](../../tests/integration/test_repair_assistant.py)验证未覆盖型号、资料冲突、无核对原文和无效引用。 |
| AC-13 | 本机样例核对 | [维修经验审核](../../tests/integration/test_repair_cases.py)验证与厂家定义冲突的独立案例，核对提交和审核权限、人工确认、幂等与引用来源。已核对案例在案例列表查阅，厂家问答引用已发布手册。 |
| AC-14、29 | 样例通过 | [全链路](../../tests/acceptance/test_m4_workflows.py)验证未建账不可出库、师傅可查但无权提交出库草稿，库存不变。 |
| AC-15～20 | 样例通过 | [建账](../../tests/integration/test_inventory_opening.py)、[入库](../../tests/integration/test_inventory_operations.py)、[出库与预留](../../tests/integration/test_inventory_reservations.py)覆盖预期数量、流水和留货关联。 |
| AC-21～24 | 样例通过 | [入库操作](../../tests/integration/test_inventory_operations.py)、[预留并发](../../tests/integration/test_inventory_reservations.py)验证同标识重试、参数冲突、最后一台竞争和失效预览。 |
| AC-25～27 | 样例通过 | [统计](../../tests/integration/test_inventory_reports.py)、[更正与盘点](../../tests/integration/test_inventory_corrections.py)核对有效进货、更正链和预留约束。 |
| AC-28、31 | 样例通过 | [入库恢复](../../tests/integration/test_inventory_operations.py)、[任务恢复](../../tests/integration/test_inventory_agent.py)和[全链路](../../tests/acceptance/test_m4_workflows.py)覆盖应用重建、提交后响应丢失、部分成功与待确认分别呈现。独立服务进程的证据见[重启复验](#独立服务进程重启复验)。 |
| AC-30 | 样例通过 | [全链路](../../tests/acceptance/test_m4_workflows.py)验证售后原件中的直接出库要求只进草稿，未写库存。 |
| AC-32 | 样例通过 | [全链路](../../tests/acceptance/test_m4_workflows.py)模拟模型故障后查历史档案、查库存并人工确认入库。 |
| AC-33 | 隔离演练通过 | [M4-01 恢复记录](../../deploy/README.md#首轮隔离演练)核对知识版本和扫描、售后原件、部分完成任务、回执及库存。 |
| AC-34～38 | 样例通过 | [入库起点](../../tests/integration/test_inventory_operations.py)、[更正](../../tests/integration/test_inventory_corrections.py)覆盖 T0 旧事件与同日未知、出库更正、提货重新打开及超登记量拒绝。 |
| AC-39、40 | 样例通过 | [工费](../../tests/integration/test_work_fees.py)验证申报 60 元核定 50 元、同单两名师傅分别已扣和待付。 |
| AC-41 | 样例通过 | [工费](../../tests/integration/test_work_fees.py)验证已扣旧单 120 元，保留扣款依据和未知代收金额，拒绝再标为已付。 |
| AC-42 | 样例通过 | [工费](../../tests/integration/test_work_fees.py)验证撤销误记扣款后待付款增加，随后登记实付后减少，原扣款、更正依据和付款均可查。本用例的更正金额为 100 元。 |
| AC-43 | 样例通过 | [工费](../../tests/integration/test_work_fees.py)验证起始日前旧单被拒，起始日起的已扣、已付及待付分开统计并可筛选。 |
| AC-44 | 样例通过 | [工费](../../tests/integration/test_work_fees.py)验证师傅只能查本人记录，本人直接更改结算被拒绝，老板可查同单两人。 |

补充权限链已复验。库存操作员的任务已有一笔成功、另一笔待确认时，负责人将该账号改为维修师傅。应用重建后，原会话看不到草稿或回执，确认请求被拒绝。恢复权限后原回执可查，重放原确认仍只有一笔入库。停用账号后同一会话无法访问。

## 独立服务进程重启复验

以专用 PostgreSQL 和独立回环端口启动 Uvicorn，通过 HTTP 测试。任务使用虚构样例，准备时使用模型替身。

1. 确认前停止进程并重新启动。同一会话重新打开任务，两笔仍待确认，库存为在库 10、预留 3、可售 7。
2. 提交第一笔后，测试客户端在取得响应头、读取回执前抛出连接读错误。负责人撤销库存写权限并重启服务。
3. 原会话恢复后不能读取入库回执或提交旧确认。负责人恢复权限后，原操作号取回回执。同一确认重试返回相同回执，第二笔保留待确认。
4. 核对结果只有一笔入库，流水仅含期初和这笔入库。最终在库 12、预留 3、可售 9。

DEP-03 的服务端恢复场景本机通过。客户端空响应提示与不自动重试由[前端回归](../../tests/web-api-response.test.cjs)验证。实体手机断网及正式试用入口仍需复验。[真实进程用例](../../tests/acceptance/test_m4_workflows.py)

本轮功能回归使用本机样例。正式试用配置下的权限与重启复验、真机流程、专业维修评审及逐项缺口仍在开发计划跟踪。

## 2026-11-25 本轮完整回归

本机专用 PostgreSQL 全量后端 321 项通过（337.58 秒），前端 81 项通过，lint、类型检查及前端构建通过。已对重复提交及审核的回执时间统一 UTC 序列化，核对首次响应和同操作号重试一致。两个独立的性能脚本另行执行，结果见[库存和档案基准](m4-04-inventory-performance.md)。部署到 8002 前完成审核库备份，升级到 0023 后比对 16 张既有表数据指纹一致；工作台首页返回 200，案例接口匿名访问返回 401。[试用交接单](../../deploy/trial.md)
