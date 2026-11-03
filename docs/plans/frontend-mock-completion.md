# 前端完整交互与选择控件统一

2026-11-03 / 前端实现及本机检查完成，用户已审核通过并授权提交、推送。用户要求只修改前端，以mock与明确契约完成现有路由和页面清单。保留当前codex/m1-05已有后端/数据库改动，本轮不修改它们，实施时不执行数据库测试或迁移，提交/推送由本次审核后另行授权。上下文压缩后必须重读AGENTS.md及git status并核对此计划。

## 页面范围

login/home/pending/service-draft/service-search/service-detail/repair-assistant/inventory/opening/inbound/movement(出库/留货/提货/取消)/reservations/ledger/statistics/correction(原单更正/盘点)/reconciliation/catalog/customers/settings；兼容reserved-pickup和inbound-statistics旧入口。settings覆盖既有设计清单账号权限、手册资料及基础资料/建账更正入口，不实现服务端。

## 实施与验证

1. 共用选择控件：外观沿用现有库存查询的输入+手机46px/电脑文字入口、6px下拉，包含搜索/原选项区分/空态/禁用/键盘/Escape/焦点，适配现有表单与动态添加字段。
2. 独立mock入口，复用当前业务页：api适配全量客户端契约，虚构数据会话内一致，模拟操作明确标识，不回落到真实网络写入。支持查询、校验、草稿、预览、确认、幂等、冲突、恢复、重置。
3. 工作台/售后/维修/设置统一接入C shell及手机四项导航，沿用已选原图和样板内容，不修改历史prototypes维护源。来源/未知/人工候选和模拟状态明确。
4. 前端工具链提供lint、严格接口类型检查和可部署静态构建；保留原生JS，不引入UI框架。补单元/集成交互验证，浏览器320/390/1440及各路由核对；同步设计两版/截图/契约/文件清单。

## 隔离

开始时已在忽略的.local保存非前端文件SHA256基线，交付前逐一核对。新增mock数据仅虚构；不读或提交本机配置、密钥、数据库及真实资料。mock模式所有模拟成功文案带演示标识。


## 实际交付

[设计资源AI版](../design/design-resources.md#113-全量前端-mock-与选择框统一当前前端演示)、[HTML版](../design/design-resources.html#frontend-mock)同步V1.13；[页面/功能及截图清单](../design/qa/frontend-mock/pages.json)逐项列出23个页面编号。[核对记录](../design/qa/frontend-mock/README.md)区分55项前端测试、72项路由尺寸检查、代表性浏览器流程和未覆盖项。

已完成通用选择框、全部清单页面的内存交互、角色与关键状态、静态构建。联调修复客户关联事件顺序、样例编号冲突、Escape入口关闭、mock场景正常切回丢操作及留货预览缺客户。原生JS结构保留；typecheck限严格接口声明。售后/库存客户样例分开、手册元信息、照片仅本地预览，没有实现真实AI或后端。

## 本轮改动文件（不含开始前已有后端/M1-05改动）

| 文件 | 用途 |
| --- | --- |
| app/web/app.js | mock适配、C壳层导航、角色入口、路由、异常页、回执标识 |
| app/web/app.css | 共用选择框、演示工具区及手机导航 |
| app/web/index.html | 真实入口仅增加共用选择框脚本，不加载mock |
| app/web/inbound.js | mock回执、售后/库存待核对聚合和分类 |
| app/web/movements.js | 模拟办理回执/预览说明 |
| app/web/reconciliation.js | 模拟更正回执/预览说明 |
| app/web/pickers.js | 全局原生select增强、选择与表单/键盘同步 |
| app/web/mock.html | 独立演示入口及虚构数据标识 |
| app/web/mock-bootstrap.js | 演示角色、库存场景、恢复和重置 |
| app/web/mock-api.js | 无网络回落的内存库存/草稿/原操作/统计/更正模拟 |
| app/web/contracts.ts | 当前库存接口严格声明与模拟器调用契约 |
| app/web/service-pages.js | 工作台/售后/维修/设置交互、来源与修订、角色门槛 |
| app/web/service-pages.css | 新页面C布局与原件阅读层 |
| package.json / package-lock.json | 固定前端开发依赖及lint/typecheck/test/build/dev命令 |
| eslint.config.mjs / tsconfig.frontend.json | 显式经典脚本全局、lint与严格契约检查 |
| scripts/frontend-build.mjs | 资源核对、静态dist和SHA256清单 |
| scripts/frontend-serve.mjs | 仅前端白名单的本机演示服务器 |
| .gitignore | 忽略node_modules/dist/类型检查缓存 |
| tests/web-mock-api.test.cjs | 内存全链、规则、权限、版本、冲突、幂等/恢复 |
| tests/web-service-pages.test.cjs | 售后/维修/设置状态与表单整合、编号唯一 |
| tests/web-pickers.test.cjs | 选择、搜索、必选/可空、键盘/禁用/动态及表单同步 |
| tests/web-routes.test.cjs | 全路由实际挂载/无网络、角色、重置与选择框归档集成 |
| docs/design/frontend-api-contract.md | 当前库存mock接口/状态/边界 |
| docs/design/frontend-service-contract.md | 售后/维修/设置未来拟定服务端契约 |
| docs/design/design-resources.md / .html | V1.13相同页面编号、入口、状态、截图与核对链接 |
| docs/design/qa/frontend-mock/ | 本轮截图、页面清单、布局证据和核对记录 |
| docs/guides/frontend-development.md | 前端工具链与运行/构建边界 |
| docs/plans/frontend-mock-completion.md | 本清单、事前计划和实际交付 |

后端/迁移/数据库测试文件的既有未提交内容保留，本轮未增加修改。用户现已审核通过并授权提交、推送GitHub；交付分支为codex/m1-05，结果以Git实际回执为准。
