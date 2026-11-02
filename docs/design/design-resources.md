# 门店助手 · 设计资源与页面规范（AI阅读版）

版本：V1.11 · 整理日期：2026-11-03 · 视觉基准：C / 沉稳专业型。
[HTML可视化版](design-resources.html)使用相同的页面编号、路径和实现状态。

## 使用约定与必读顺序

1. 按「效果图 → HTML样板 → 设计资源 → 设计规范」阅读，先确认页面编号和状态，再进行页面设计或修改。
2. 同时遵守[AGENTS.md](../../AGENTS.md)，结合[PRD](../prd/store-service-agent-prd-v1.0.md)核对内容；交互层级见本文第4.5节。
3. 查看实际图片与HTML，不能只凭文件名推断。当前工作台、待核对及七个核心业务页已有独立完整视图的本地交互样板；未接入后端。原样板与概念图作为历史依据保留。
4. Markdown维护资源映射与执行规则，HTML可视化展示同一份目录；变更时同步两版。本次保留原资源位置，通过索引串联，不复制一套素材。
5. 原有8张效果图（1张三方向对照、7张独立页）、2个样板HTML入口、8张浏览器截图、4张比对图、18枚SVG及1张纹理均保留；新增核心前端入口及本轮浏览器截图见[核对记录](qa/frontend-c/README.md)。概念图与业务HTML样板分别标明，不把图片浏览入口当作业务实现。

## 1. 效果图

### 1.1 已选方向

- C方向于2026-10-26选定；原界面简报的有效交互要求已合并至第4.5节。
- REF-C：[首页视觉方向对照](assets/homepage-visual-directions-v1.png)。用户已选最右侧C，A/B仅保留历史参考，不作为后续自行切换的方向。
- C以深墨青顶部、白色业务内容、深青绿主操作建立层级，以分组、文字和细分隔线组织内容。
- 七页概念图与实现统一按第1.2节页面映射定位；[HTML版](design-resources.html#concepts)可并排查看原图，无需重复图册入口。
- [提示词与修正记录](mobile-pages-c-prompts-v1.md)区分整理后的复现提示和实际局部修正原文，不将其全部称为首次逐字日志。
- 七张业务页原图均为853×1844px，逻辑目标390×844；图片像素与CSS视口不能直接混用。
- 概念图原件日期已修正为“日期未记”；详情未记结果保持待补充，维修手册为虚构示例。图中库存合计16−5=11、提货10/3/7→8/1/7、进货5+8+5=18，均为独立样例。

### 1.2 页面映射

| 页面编号 | 名称 | 效果图 | 状态 | 代码入口 | 截图 | 设计重点 |
| --- | --- | --- | --- | --- | --- | --- |
| home | 工作台 | [右栏C](assets/homepage-visual-directions-v1.png) | 完整视图交互样板（本地演示） | [独立页面](../../prototypes/frontend/index.html#home) | [390px截图](qa/frontend-c/home-390.jpg) | 任务区、2×2入口、待核对及最近任务 |
| pending | 待核对列表 | [交互依据](#interaction) | 完整视图交互样板（本地演示） | [独立页面](../../prototypes/frontend/index.html#pending) | [390px截图](qa/frontend-c/pending-390.jpg) | 分类、对象摘要、继续核对 |
| service-draft | 售后草稿核对 | [效果图](assets/mobile-c/01-service-draft.png) | 完整视图交互样板（本地演示） | [独立页面](../../prototypes/frontend/index.html#service-draft) | [390px截图](qa/frontend-c/service-draft-390.jpg) | 原文对照、模糊手机号、未知日期、人工关联与归档条件 |
| service-search | 售后检索与候选选择 | [效果图](assets/mobile-c/02-service-search.png) | 完整视图交互样板（本地演示） | [独立页面](../../prototypes/frontend/index.html#service-search) | [390px截图](qa/frontend-c/service-search-390.jpg) | 同一手机号对应不同服务地址，人工选择 |
| service-detail | 售后档案详情 | [效果图](assets/mobile-c/03-service-detail.png) | 完整视图交互样板（本地演示） | [独立页面](../../prototypes/frontend/index.html#service-detail) | [390px截图](qa/frontend-c/service-detail-390.jpg) | 历史记录、待补充结果、来源与修订 |
| repair-assistant | 维修辅助 | [效果图](assets/mobile-c/04-repair-assistant.png) | 完整视图交互样板（本地演示） | [独立页面](../../prototypes/frontend/index.html#repair-assistant) | [390px截图](qa/frontend-c/repair-assistant-390.jpg) | 机型、检查前提、条件性建议、对应引用 |
| inventory | 库存总览 | [效果图](assets/mobile-c/05-inventory.png) | 完整视图交互样板（本地演示） | [独立页面](../../prototypes/frontend/index.html#inventory) | [390px截图](qa/frontend-c/inventory-390.jpg) | 按库房和型号查询在库、预留、可售；未建账 |
| reserved-pickup | 预留提货确认 | [效果图](assets/mobile-c/06-reserved-pickup.png) | 完整视图交互样板（本地演示） | [独立页面](../../prototypes/frontend/index.html#reserved-pickup) | [390px截图](qa/frontend-c/reserved-pickup-390.jpg) | 在库10→8、预留3→1、可售7→7，人工确认 |
| inbound-statistics | 进货统计 | [效果图](assets/mobile-c/07-inbound-statistics.png) | 完整视图交互样板（本地演示） | [独立页面](../../prototypes/frontend/index.html#inbound-statistics) | [390px截图](qa/frontend-c/inbound-statistics-390.jpg) | 日期/库房/型号分组及建账后有效进货 |

### 1.3 M1-02同源业务页面

下列是已接入后端的M1-02页面，完成本机技术/浏览器核对，**待用户审核**。不是完整库存闭环或已上线产品；原七页仍保留历史样板状态。

| 页面编号 | 名称 | 代码入口 | 本机运行入口 | 截图 | 状态 |
| --- | --- | --- | --- | --- | --- |
| m1-login | 登录 | [app/web](../../app/web/index.html) | [登录](http://127.0.0.1:8000/#login) | [390px](qa/m1-02/login-390.jpg) | 已接身份API，本机核对，待审核 |
| m1-inventory | 库存起点查询 | [app.js](../../app/web/app.js) | [查询](http://127.0.0.1:8000/#inventory) | [390px](qa/m1-02/inventory-390.jpg)、[320px](qa/m1-02/inventory-320.jpg) | 已接余额API，限建账/查询，待审核 |
| m1-opening | 期初建账 | [app.js](../../app/web/app.js) | [建账](http://127.0.0.1:8000/#opening) | [电脑](qa/m1-02/opening-desktop.jpg)、[预览](qa/m1-02/opening-preview-390.jpg)、[回执](qa/m1-02/opening-receipt-390.jpg) | 草稿/人工确认/回执已接后端，待审核 |
| m1-catalog | 基础资料 | [app.js](../../app/web/app.js) | [维护](http://127.0.0.1:8000/#catalog) | [电脑](qa/m1-02/catalog-desktop.jpg) | 库房/型号维护及客户引用已接后端，待审核 |

[核对记录与未覆盖项](qa/m1-02/README.md)说明样例性质、视口、流程和进程重启证据。[后端开发说明](../guides/backend-development.md)提供运行方式；不能用静态HTTP服务器运行这些业务页面。新增页面没有独立概念图，按C方向既有库存图与组件规范扩展。

生产公共维护源为[app/web/tokens.css](../../app/web/tokens.css)、[app.css](../../app/web/app.css)及[生产素材](../../app/web/assets/icons.svg)；原素材原样迁移，生产脚本不使用原型的模拟状态或规则。`prototypes/`中的同名文件作为历史样板保留，生产变更不回写历史版本。

### 1.4 M1-03入库与待核对

M1-02已获准继续，保留其历史截图。当前新增/更新页面完成本机技术核对，**M1-03用户审核通过**；不代表完整库存或真机验收。

| 页面编号 | 名称 / 代码 | 本机入口 | 截图 | 状态 |
| --- | --- | --- | --- | --- |
| m1-inbound | [入库表单](../../app/web/inbound.js) | [入库](http://127.0.0.1:8000/#inbound) | [电脑](qa/m1-03/inbound-desktop.jpg)、[390px预览](qa/m1-03/inbound-preview-390.jpg)、[回执](qa/m1-03/inbound-receipt-390.jpg)、[T0待补](qa/m1-03/t0-pending-390.jpg) | 已接草稿/确认/回执，用户审核通过 |
| m1-pending | [待核对](../../app/web/inbound.js) | [待核对](http://127.0.0.1:8000/#pending) | [390px](qa/m1-03/pending-390.jpg) | 当前账号授权的未完成草稿，用户审核通过 |
| m1-inventory | [库存导航与查询](../../app/web/app.js) | [库存](http://127.0.0.1:8000/#inventory) | [390px](qa/m1-03/inventory-390.jpg)、[320px](qa/m1-03/inventory-320.jpg) | 已接入库后余额查询，用户审核通过 |

[核对与未覆盖项](qa/m1-03/README.md)区分浏览器、程序测试和未验证真机范围。只知日期不补时刻，修改后重新预览，入库5使10/3/7变15/3/12；截图数字来自后端。原型及M1-02截图不覆盖或冒充当前证据。

### 1.5 M1-04出库、留货与提货

以下页面接入真实后端，**本机技术/浏览器核对完成，待M1-04用户审核**。新增表单沿用C方向既有库存与提货效果图、样板及生产组件，没有新增独立概念图。

| 页面编号 | 名称 / 代码 | 本机入口 | 截图 | 状态 |
| --- | --- | --- | --- | --- |
| m1-outbound | [普通出库](../../app/web/movements.js) | [办理](http://127.0.0.1:8000/#movement?kind=inventory_outbound) | [320px预览](qa/m1-04/outbound-preview-320.jpg) | 后端校验可售，草稿/确认/回执已接入，待审核 |
| m1-reserve | [客户留货](../../app/web/movements.js) | [办理](http://127.0.0.1:8000/#movement?kind=reservation_create) | [电脑](qa/m1-04/reserve-desktop.jpg)、[390px预览](qa/m1-04/reserve-preview-390.jpg) | 显式选客户及依据标签，待审核 |
| m1-pickup | [预留提货](../../app/web/movements.js) | [先选具体预留](http://127.0.0.1:8000/#reservations) | [预览](qa/m1-04/pickup-preview-390.jpg)、[回执](qa/m1-04/pickup-receipt-390.jpg) | 按所选预留同时扣H/R，待审核 |
| m1-cancel | [取消留货](../../app/web/movements.js) | [先选具体预留](http://127.0.0.1:8000/#reservations) | [回执](qa/m1-04/cancel-receipt-390.jpg) | 只取消本单剩余，待审核 |
| m1-reservations | [预留检索及明细](../../app/web/movements.js) | [查询](http://127.0.0.1:8000/#reservations) | [390px](qa/m1-04/reservations-390.jpg) | 客户/库房/型号/未提状态筛选，待审核 |
| m1-ledger | [库存流水](../../app/web/movements.js) | [查询](http://127.0.0.1:8000/#ledger) | [390px](qa/m1-04/ledger-390.jpg)、[320px](qa/m1-04/ledger-320.jpg) | 发生日期/类型及原单关联，待审核 |
| m1-customers | [独立客户引用](../../app/web/movements.js) | [登记](http://127.0.0.1:8000/#customers) | [390px](qa/m1-04/customers-390.jpg) | 已知字段人工登记，无售后档案依赖，待审核 |
| m1-pending | [本阶段草稿恢复](../../app/web/inbound.js) | [待核对](http://127.0.0.1:8000/#pending) | [390px](qa/m1-04/pending-390.jpg) | 新业务草稿恢复，待审核 |
| m1-inventory | [库存及办理入口](../../app/web/app.js) | [库存](http://127.0.0.1:8000/#inventory) | [390px](qa/m1-04/inventory-390.jpg)、[320px](qa/m1-04/inventory-320.jpg) | 客户预留及结束状态、实际余额，待审核 |

[核对记录](qa/m1-04/README.md)包含样例链、视口、恢复、截图版本与未覆盖项。原M1-02/M1-03及原型截图仅作其历史阶段证据；本阶段未做统计、更正或Agent，不代表完整M1。

### 1.6 M1-04审核反馈版本（历史）

以下保留本次优化时的入口，现行页面见1.9；**本机核对完成，待用户审核**；1.3～1.5截图保留为其历史版本。仍沿用C方向原图/样板及生产素材，库存页面维护源新增`app/web/inventory.js`。

| 页面编号 | 当前内容 / 代码 | 运行入口 | 最新证据 | 状态 |
| --- | --- | --- | --- | --- |
| m1-inventory | [库房名称查询、分型号及合计](../../app/web/inventory.js) | [库存](http://127.0.0.1:8000/#inventory) | [电脑](qa/m1-04-refinement/inventory-desktop.jpg)、[分项](qa/m1-04-refinement/inventory-models-desktop.jpg)、[390px](qa/m1-04-refinement/inventory-query-390.jpg)、[320px](qa/m1-04-refinement/inventory-models-320.jpg)、[日常办理](qa/m1-04-refinement/actions-390.jpg) | 型号可不选、查询/办理/设置分层，待审核 |
| m1-catalog | [库房与型号](../../app/web/app.js) | [维护](http://127.0.0.1:8000/#catalog) | [电脑](qa/m1-04-refinement/catalog-desktop.jpg)、[390px](qa/m1-04-refinement/catalog-390.jpg)、[320px最终版](qa/m1-04-refinement/catalog-320.jpg) | 库房单名称输入，无重复客户表单，待审核 |
| m1-reservations | [预留查询](../../app/web/movements.js) | [查询](http://127.0.0.1:8000/#reservations) | [390px](qa/m1-04-refinement/reservation-query-390.jpg) | 标题/入口统一，分项入口预填对象，待审核 |
| m1-customers | [客户资料](../../app/web/movements.js) | [登记](http://127.0.0.1:8000/#customers) | [本轮入口联调记录](qa/m1-04-refinement/README.md) | 统一独立表单，不新增售后能力，待审核 |
| m1-reserve / m1-opening | [留货及建账入口](../../app/web/app.js) | [办理留货](http://127.0.0.1:8000/#movement?kind=reservation_create)、[建账](http://127.0.0.1:8000/#opening) | [联调记录](qa/m1-04-refinement/README.md) | 留货动作与预留查询区分；建账可预填对象，待审核 |

[完整核对与限制](qa/m1-04-refinement/README.md)包含0/未知、模糊候选、布局和回归。未建账型号只是资料目录中的候选，不能据此认定该库实际有货；合计只覆盖已建账分项。姓名/电话等客户内容不进入库存查询URL。

### 1.7 按AGENTS.md复核版本（历史）

本节保留规范复核时的历史目录，现行查询交互见1.9。**本机设计/页面复核完成，待用户审核**，不代表完整M1、真机或生产验收。先按C库存05原图及完整HTML样板核对，再修复规范4.5要求的“分项优先、合计随后”；颜色、SVG和纹理沿用既有资源。

| 页面编号 | 名称 / 代码 | 运行入口 | 当前截图 | 状态 |
| --- | --- | --- | --- | --- |
| m1-inventory | [库存查询与分项](../../app/web/inventory.js) | [打开](http://127.0.0.1:8000/#inventory) | [inventory-query-390](qa/m1-04-design-check/inventory-query-390.jpg)、[inventory-items-390](qa/m1-04-design-check/inventory-items-390.jpg)、[inventory-total-390](qa/m1-04-design-check/inventory-total-390.jpg)、[inventory-items-320](qa/m1-04-design-check/inventory-items-320.jpg)、[inventory-desktop](qa/m1-04-design-check/inventory-desktop.jpg)、[inventory-unknown-390](qa/m1-04-design-check/inventory-unknown-390.jpg)、[keyboard-focus-390](qa/m1-04-design-check/keyboard-focus-390.jpg) | 本机设计/页面复核完成，待用户审核 |
| m1-catalog | [库房与型号](../../app/web/app.js) | [打开](http://127.0.0.1:8000/#catalog) | [catalog-390](qa/m1-04-design-check/catalog-390.jpg)、[catalog-desktop](qa/m1-04-design-check/catalog-desktop.jpg) | 本机设计/页面复核完成，待用户审核 |
| m1-reservations | [预留查询](../../app/web/movements.js) | [打开](http://127.0.0.1:8000/#reservations) | [reservations-390](qa/m1-04-design-check/reservations-390.jpg) | 本机设计/页面复核完成，待用户审核 |
| m1-customers | [客户资料](../../app/web/movements.js) | [打开](http://127.0.0.1:8000/#customers) | [customers-390](qa/m1-04-design-check/customers-390.jpg) | 本机设计/页面复核完成，待用户审核 |
| m1-reserve | [办理留货](../../app/web/movements.js) | [打开](http://127.0.0.1:8000/#movement?kind=reservation_create) | [reserve-390](qa/m1-04-design-check/reserve-390.jpg) | 本机设计/页面复核完成，待用户审核 |
| m1-opening | [期初建账](../../app/web/app.js) | [打开](http://127.0.0.1:8000/#opening) | [opening-390](qa/m1-04-design-check/opening-390.jpg) | 本机设计/页面复核完成，待用户审核 |

[逐项核对记录](qa/m1-04-design-check/README.md)列明实际查看方式、原图/样板对应、素材校验、截图像素与CSS视口区别、键盘及44px目标、未覆盖项；[资源证据](qa/m1-04-design-check/resource-evidence.json)与[布局证据](qa/m1-04-design-check/layout-evidence.json)可复查。客户、留货、建账为既有C组件的业务延伸，没有为它们虚构独立效果图。

### 1.8 型号必选与明确查询（历史）

**本机交互验证完成，待用户审核**。用户最新要求替代旧的“型号可选/自动恢复查询”：进入库存页时库房、型号均留空；型号必选，点击查询或键盘明确提交后才显示结果，候选选择不自动查询。沿用C方向颜色、字段及图标，不改后端库存业务规则。

| 页面编号 | 维护源 / 入口 | 当前证据 | 状态 |
| --- | --- | --- | --- |
| m1-inventory | [inventory.js](../../app/web/inventory.js) / [库存](http://127.0.0.1:8000/#inventory) | [390px初始](qa/m1-04-manual-query/initial-390.jpg)、[320px](qa/m1-04-manual-query/initial-320.jpg)、[电脑](qa/m1-04-manual-query/initial-desktop.jpg)、[候选未查询](qa/m1-04-manual-query/candidate-not-queried-390.jpg)、[手动结果](qa/m1-04-manual-query/manual-result-390.jpg) | 两项必选、空白进入、明确查询，待审核 |
| m1-catalog | [app.js](../../app/web/app.js) / [库房与型号](http://127.0.0.1:8000/#catalog) | [布局沿用](qa/m1-04-design-check/catalog-390.jpg)；[共用鼠标提示](qa/m1-04-manual-query/README.md) | 布局未改，统一按钮反馈，待审核 |
| m1-reservations | [movements.js](../../app/web/movements.js) / [预留查询](http://127.0.0.1:8000/#reservations) | [布局沿用](qa/m1-04-design-check/reservations-390.jpg)；[交互记录](qa/m1-04-manual-query/README.md) | 布局未改，统一按钮反馈，待审核 |
| m1-customers | [movements.js](../../app/web/movements.js) / [客户资料](http://127.0.0.1:8000/#customers) | [布局沿用](qa/m1-04-design-check/customers-390.jpg)；[交互记录](qa/m1-04-manual-query/README.md) | 布局未改，统一按钮反馈，待审核 |
| m1-reserve | [movements.js](../../app/web/movements.js) / [办理留货](http://127.0.0.1:8000/#movement?kind=reservation_create) | [布局沿用](qa/m1-04-design-check/reserve-390.jpg)；[交互记录](qa/m1-04-manual-query/README.md) | 布局未改，统一按钮反馈，待审核 |
| m1-opening | [app.js](../../app/web/app.js) / [期初建账](http://127.0.0.1:8000/#opening) | [布局沿用](qa/m1-04-design-check/opening-390.jpg)；[交互记录](qa/m1-04-manual-query/README.md) | 布局未改，统一按钮反馈，待审核 |

所有启用按钮和可点击入口使用手形光标，主/次按钮有悬停高亮；禁用按钮不显示可点样式，键盘保留可见焦点。共用维护源为[app.css](../../app/web/app.css)。[完整记录](qa/m1-04-manual-query/README.md)、[交互证据](qa/m1-04-manual-query/interaction-evidence.json)、[主按钮截图](qa/m1-04-manual-query/hover-primary-desktop.jpg)区分实际检查、沿用截图及未覆盖项。

### 1.9 电脑/手机模式与完整查询选择（布局基线，库房控件见1.10）

**本机页面与交互核对完成，待M1-04用户审核**。用户选定既有C方向电脑样板的左侧导航、右侧业务区，正式页面新增“电脑端 / 手机端”手动切换；切换仅改变布局，保留当前表单及查询结果，不重新请求或写入。首次按窗口宽度初始化，手动模式在页面会话内保留；刷新后重新按窗口宽度初始化。窄屏电脑模式使用紧凑侧栏（保留左侧导航），模式按钮始终可用。

查询初始仍为空，型号需明确选择“全部型号”或某一型号，再点击查询。全部型号复用后端overview省略model_id能力；库房旁的完整列表不受已输入名称过滤，可直接切换，选择不自动查询。旧V1.8具体型号限制已被本次要求替代。

布局依据：[电脑样板原图](qa/frontend-c/home-desktop.jpg)、[完整HTML](../../prototypes/frontend/index.html)、[C库存图](assets/mobile-c/05-inventory.png)。共用维护源：[shell](../../app/web/app.js)、[app.css](../../app/web/app.css)；颜色、SVG及纹理沿用原C资源，未引入样板模拟业务。

| 页面编号 | 页面 / 业务源码 | 本机入口 | 本轮电脑截图 | 核对范围（均待用户审核） |
| --- | --- | --- | --- | --- |
| m1-inventory | [库存查询](../../app/web/inventory.js) | [打开](http://127.0.0.1:8000/#inventory) | [desktop-all-models](qa/m1-04-desktop-query/desktop-all-models.jpg) | 全部/单型号、完整库房列表、两种模式已核对 |
| m1-inbound | [入库登记](../../app/web/inbound.js) | [打开](http://127.0.0.1:8000/#inbound) | [inbound-desktop](qa/m1-04-desktop-query/inbound-desktop.jpg) | 布局和未保存表单切换已核对 |
| m1-outbound | [普通出库](../../app/web/movements.js) | [打开](http://127.0.0.1:8000/#movement?kind=inventory_outbound) | [outbound-desktop](qa/m1-04-desktop-query/outbound-desktop.jpg) | 电脑表单布局已核对 |
| m1-reserve | [办理留货](../../app/web/movements.js) | [打开](http://127.0.0.1:8000/#movement?kind=reservation_create) | [reserve-desktop](qa/m1-04-desktop-query/reserve-desktop.jpg) | 电脑表单布局已核对 |
| m1-pickup | [预留提货](../../app/web/movements.js) | [打开](http://127.0.0.1:8000/#reservations) | [pickup-desktop](qa/m1-04-desktop-query/pickup-desktop.jpg) | 从具体样例预留进入，布局已核对 |
| m1-cancel | [取消留货](../../app/web/movements.js) | [打开](http://127.0.0.1:8000/#reservations) | [cancel-desktop](qa/m1-04-desktop-query/cancel-desktop.jpg) | 从具体样例预留进入，布局已核对 |
| m1-reservations | [预留查询](../../app/web/movements.js) | [打开](http://127.0.0.1:8000/#reservations) | [reservations-desktop](qa/m1-04-desktop-query/reservations-desktop.jpg) | 侧栏跳转和查询布局已核对 |
| m1-ledger | [库存流水](../../app/web/movements.js) | [打开](http://127.0.0.1:8000/#ledger) | [ledger-desktop](qa/m1-04-desktop-query/ledger-desktop.jpg) | 侧栏跳转和查询布局已核对 |
| m1-pending | [待核对](../../app/web/inbound.js) | [打开](http://127.0.0.1:8000/#pending) | [pending-desktop](qa/m1-04-desktop-query/pending-desktop.jpg) | 侧栏跳转和列表布局已核对 |
| m1-customers | [客户资料](../../app/web/movements.js) | [打开](http://127.0.0.1:8000/#customers) | [customers-desktop](qa/m1-04-desktop-query/customers-desktop.jpg) | 侧栏跳转和表单布局已核对 |
| m1-catalog | [库房与型号](../../app/web/app.js) | [打开](http://127.0.0.1:8000/#catalog) | [catalog-desktop](qa/m1-04-desktop-query/catalog-desktop.jpg) | 侧栏跳转和维护布局已核对 |
| m1-opening | [期初建账](../../app/web/app.js) | [打开](http://127.0.0.1:8000/#opening) | [opening-desktop](qa/m1-04-desktop-query/opening-desktop.jpg) | 侧栏跳转和表单布局已核对 |

[初始电脑页](qa/m1-04-desktop-query/desktop-initial.jpg)、[完整库房列表](qa/m1-04-desktop-query/warehouse-list-desktop.jpg)、[单型号](qa/m1-04-desktop-query/desktop-single-model.jpg)、[电脑窗口中的手机模式](qa/m1-04-desktop-query/mobile-mode-desktop-window.jpg)、[320px手机](qa/m1-04-desktop-query/mobile-320.jpg)、[320px电脑侧栏](qa/m1-04-desktop-query/desktop-320.jpg)、[核对记录与限制](qa/m1-04-desktop-query/README.md)、[实际交互证据](qa/m1-04-desktop-query/interaction-evidence.json)。本轮只核对页面和只读查询，不重新宣称业务确认、实体手机或生产验收完成。

### 1.10 手机库房选择位置（控件基线，型号统一见1.11）

**本机位置与交互核对完成，待用户审核**。沿用C方向；将库房输入及下拉入口连为一体，手机入口46px宽，列表紧贴名称输入框下方6px展开。可访问名称仍是“选择库房”，固定标签、键盘焦点及完整列表切换保留；查询逻辑不变。其他页面和电脑侧栏继续采用1.9基线。

| 页面编号 | 维护源 / 入口 | 本轮截图 | 状态 |
| --- | --- | --- | --- |
| m1-inventory | [inventory.js](../../app/web/inventory.js)、[app.css](../../app/web/app.css) / [库存](http://127.0.0.1:8000/#inventory) | [390px展开](qa/m1-04-warehouse-position/open-390.jpg)、[选定后](qa/m1-04-warehouse-position/selected-390.jpg)、[320px](qa/m1-04-warehouse-position/open-320.jpg)、[电脑共用控件](qa/m1-04-warehouse-position/desktop-open.jpg) | 6px间距、44px以上入口、键盘/手动查询核对完成，待审核 |

[修改前](qa/m1-04-warehouse-position/before-open-390.jpg)、[核对记录与限制](qa/m1-04-warehouse-position/README.md)、[交互证据](qa/m1-04-warehouse-position/interaction-evidence.json)。布局依据及原图仍见1.9；本次没有业务写入或重新宣称完整业务验收。

### 1.11 型号与库房选择统一（现行局部修订）

**2026-11-03 / 本机页面与交互核对完成，待用户审核**。沿用C方向及1.10库房控件：型号同样提供名称输入、右侧下拉入口及紧贴下方6px的完整列表；共用46px手机入口和电脑文字按钮。默认不选，保留全部型号与明确查询；文字变动清除旧型号ID，未知/多候选不自动查询，两个菜单互斥，Escape关闭并回焦点。其他页面沿用1.9基线。

| 页面编号 | 维护源 / 入口 | 本轮截图 | 状态 |
| --- | --- | --- | --- |
| m1-inventory | [inventory.js](../../app/web/inventory.js)、[app.css](../../app/web/app.css) / [库存](http://127.0.0.1:8000/#inventory) | [初始390px](qa/m1-04-model-picker/initial-390.jpg)、[型号展开390px](qa/m1-04-model-picker/model-open-390.jpg)、[320px](qa/m1-04-model-picker/model-open-320.jpg)、[电脑](qa/m1-04-model-picker/model-open-desktop.jpg) | 外观、全部/单型号、修改清选择、键盘及窄屏已核对，待审核 |

[完整核对与限制](qa/m1-04-model-picker/README.md)、[交互证据](qa/m1-04-model-picker/interaction-evidence.json)。布局依据仍为1.9的C原图与HTML样板；本轮只改库存查询控件，不宣称完整业务重验。

## 2. HTML样板

| 编号 | 入口 | 实际范围 |
| --- | --- | --- |
| HTML-HOME | [index.html](../../prototypes/ui-sample/index.html) | 完整工作台；任务预览、照片上传/移除、候选检索、库房筛选等局部演示 |
| HTML-CORE | [核心前端入口](../../prototypes/frontend/index.html) | 工作台、待核对及七个业务完整视图；手机与电脑布局，样例交互，无后端 |
| HTML-KIT | [ui-kit.html](../../prototypes/ui-sample/ui-kit.html) | 视觉组件目录；颜色、按钮、字段、状态、列表、库存数字与图标 |

共用源码：[tokens.css](../../prototypes/ui-sample/tokens.css) / [ui.css](../../prototypes/ui-sample/ui.css) / [app.js](../../prototypes/ui-sample/app.js)。[样板说明](../../prototypes/ui-sample/README.md)提供交互范围。

历史局部演示位于ui-sample/app.js：草稿核对只有提示及手机号字段；历史查询有候选和简化详情；维修辅助只有条件输入与资料缺口；库存只展示筛选及数量；提货只有影响预览。它们保留原演示范围；完整页面现位于[prototypes/frontend](../../prototypes/frontend/README.md)，同样不执行正式写入。新页面分别由workbench.js、service.js和inventory.js组织，共用frontend.css、shared.js、rules.js及app.js。

在项目根目录启动：

```sh
python -m http.server 8765 --bind 127.0.0.1
```

访问`http://127.0.0.1:8765/docs/design/design-resources.html`；核心前端位于`/prototypes/frontend/`，原工作台位于`/prototypes/ui-sample/`。本可视化目录支持直接打开HTML浏览静态资源，完整链接访问建议使用HTTP。

## 3. 设计资源

### 3.1 产品/样板截图

以下为浏览器渲染的前端样板截图，不是已上线产品截图。链接均相对于本文；原文件位于`docs/design/qa/ui-sample-c/`。

| 编号 | 截图 | 用途 | 像素尺寸 |
| --- | --- | --- | --- |
| SHOT-HOME-390 | [工作台 · 390px](qa/ui-sample-c/homepage-390-final.png) | 首页最终样板 | 390×844 |
| SHOT-HOME-320 | [工作台 · 320px](qa/ui-sample-c/homepage-320.png) | 窄屏验证 | 320×844 |
| SHOT-HOME-DESKTOP | [工作台 · 电脑预览](qa/ui-sample-c/homepage-desktop.png) | 电脑中的手机样板，非桌面业务布局 | 1440×1000 |
| SHOT-HOME-FILE | [工作台 · 直接打开](qa/ui-sample-c/homepage-file-direct.png) | file方式加载验证 | 390×844 |
| SHOT-KIT-DESKTOP | [视觉组件 · 电脑](qa/ui-sample-c/ui-kit-desktop.png) | 组件页首屏，非整页长截图 | 1440×1000 |
| SHOT-KIT-390 | [视觉组件 · 手机](qa/ui-sample-c/ui-kit-390.png) | 组件页手机首屏 | 390×844 |
| SHOT-TASK | [任务内容预览](qa/ui-sample-c/task-preview-390.png) | 输入后的演示草稿弹层 | 390×844 |
| SHOT-INVENTORY | [库存筛选演示](qa/ui-sample-c/inventory-390.png) | 3号库筛选弹层，非完整库存页 | 390×844 |

### 3.2 视觉比对与历史

| 编号 | 图 | 用途 |
| --- | --- | --- |
| COMPARE-FINAL | [C源图与最终样板](qa/ui-sample-c/qa-reference-and-final.png) | 当前核对证据 |
| COMPARE-HEADER | [顶部与任务区](qa/ui-sample-c/qa-header-detail.png) | 当前局部核对证据 |
| COMPARE-LIST | [待核对与记录行](qa/ui-sample-c/qa-list-detail.png) | 当前局部核对证据 |
| COMPARE-INITIAL | [C源图与初版样板](qa/ui-sample-c/qa-reference-and-initial.png) | 历史：有遮挡和视口差异，不作为最新依据 |

[原工作台核对记录](qa/ui-sample-c/README.md)仅覆盖工作台和组件样板核对，不代表其他七个完整页已验收。COMPARE-INITIAL仅作历史修正记录，不作为当前布局基准。

### 3.3 SVG图标库

新核心页面通过HTTP直接引用该源，不新增内联副本。ICONS-01规范源：[icons.svg](../../prototypes/ui-sample/assets/icons.svg)。现有两个HTML为兼容file方式内联同一组symbol；变更图标时同步源和内联副本。可视化目录展示同一组18枚图标。

| symbol id | 用途 |
| --- | --- |
| home | 工作台 |
| clipboard | 整理售后/粘贴 |
| history | 查上次记录 |
| wrench | 维修辅助/售后导航 |
| box | 库存/提货 |
| file | 档案/草稿 |
| photo | 上传照片 |
| settings | 资料与设置 |
| chevron | 进入下一层 |
| arrow | 前进/提交方向 |
| close | 关闭 |
| check | 完成/确认 |
| warning | 注意/待核对 |
| search | 搜索 |
| phone | 手机号 |
| pin | 服务地址 |
| back | 返回 |
| plus | 添加 |

HTTP引用（路径按消费页面调整）：

```html
<svg class="icon" aria-hidden="true">
  <use href="../../prototypes/ui-sample/assets/icons.svg#box"></use>
</svg>
```

使用既有.icon类提供fill:none、currentColor和描边。图标按钮另有可访问名称；旁边有文字的图标可用aria-hidden。直接打开本地文件时，像现有样板一样内联相同symbol并引用`href="#box"`，避免file跨文件引用限制。

### 3.4 纹理与表面

- TEX-INK：[ink-grain.png](../../prototypes/ui-sample/assets/ink-grain.png)是独立生成的深墨青细颗粒位图，使用tokens.css中的`.material-ink`，目前以628×628px重复铺设。
- SURFACE-PAPER：`.material-paper`为白色表面和轻边界的CSS组合，没有独立的白色纹理图片。
- [素材说明及实际纹理提示词](../../prototypes/ui-sample/assets/README.md)提供来源。纹理不保证数学意义上的无缝，需核对实际铺设效果。
- 当前没有厂家官方Logo、真实产品照片或额外字体文件，现有通用素材不代表厂家官方品牌资产。

## 4. 设计规范

### 4.1 必须遵循的规则

**依据与冲突**：用户最新明确要求优先。业务和字段依PRD；C方向及本文约束视觉与层级；tokens.css和ui.css作为当前组件实现基准。冲突时指出具体差异，按授权范围解决并同步文档，不默默采用生图误字或旧截图。

**页面骨架**：手机优先，一级导航为工作台/待核对/售后/库存。二级办理页使用返回及本页操作区，不叠加一级底栏。长地址和型号可换行，固定底栏及安全区不得挡住最后一条记录。

**组件与素材**：优先复用现有CSS变量、组件、SVG symbol和纹理。本次保持C方向，不另建图标风格；不用emoji替代业务图标，不把整张截图当作可操作HTML。新增图标遵循既有画布与描边，素材变更同步索引。

**业务状态**：草稿、待核对、已归档、已登记分别表达；未知日期/型号不编造，未建账不显示为零库存。多地址候选由人选择；维修建议注明机型、检查前提和对应引用，不当作实际处理结果。

**库存与确认**：可售=在库−预留。预留提货同时减少在库与对应预留，不重复减少可售。进货仅统计建账后有效入库，排除期初与盘点调整。正式写入须人工确认，并由后端保障权限、事务和幂等。

**可访问性**：操作有文字或可访问名称，状态同时配合文字与颜色，字段保留固定标签。新页面点击目标至少44px，键盘焦点可见，弹层可用键盘关闭；检查窄屏、长内容、对比度及遮挡。

**演示范围**：概念图、HTML演示和生产能力分别标明。现有图片均为示例数据，手册是虚构示例；样板无AI或后端接入。截图中的2026-10-26是样例日期，不能称为实时业务数据。

**更新与验收**：新增或修改页面时，同步两版的同一页面编号、状态、文件链接和截图。新版本命名清晰，保留并标明历史证据。在同一视口/状态下比对效果图与HTML，记录实际验证结果和未覆盖项。

### 4.2 CSS变量（当前代码快照）

以下取值来自tokens.css。变量改动时同步两版目录，组件细节仍以ui.css为准。

| 变量 | 值 |
| --- | --- |
| `--ink` | `#17313b` |
| `--primary` | `#0f766e` |
| `--primary-hover` | `#0b635d` |
| `--primary-soft` | `#e7f3f1` |
| `--page` | `#f7f9f8` |
| `--surface` | `#ffffff` |
| `--text` | `#17313b` |
| `--muted` | `#52646f` |
| `--line` | `#e2e9e9` |
| `--warning` | `#92400e` |
| `--warning-soft` | `#fff5e7` |
| `--success` | `#166534` |
| `--success-soft` | `#edf6ef` |
| `--danger` | `#b91c1c` |
| `--danger-soft` | `#fff1f1` |
| `--focus` | `#a96812` |
| `--radius-control` | `6px` |
| `--radius-surface` | `8px` |
| `--shadow-panel` | `0 12px 36px rgb(23 49 59 / 12%)` |
| `--space-1` | `4px` |
| `--space-2` | `8px` |
| `--space-3` | `12px` |
| `--space-4` | `16px` |
| `--space-5` | `20px` |
| `--space-6` | `24px` |
| `--font-ui` | `"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif` |

信息提示色建议为`#1D4ED8`，当前tokens.css没有对应变量；使用时按任务补充命名并同步，不假装已有该token。原简报初步计算白字/主色约5.47:1、正文/白底约13.65:1、次要文字/白底约6.16:1；这些不是本轮组件实测，最终仍按实际背景核对。

### 4.3 排版与组件参数（原样板基准）

| 项目 | 当前基准 |
| --- | --- |
| 字体 | Microsoft YaHei / PingFang SC / Noto Sans CJK SC / sans-serif |
| 标题 | 工作台标题22px；任务标题23px；模块18px；子标题16px |
| 正文 | 正文14px；快捷入口16px；记录标题15px；辅助13px；helper12px；导航11px |
| 字段 | 输入文字16px；普通字段与主要按钮最小高度44px |
| 布局 | 逻辑基准390×844；原ui-sample手机容器最大430px；核心前端在760px起提供侧栏、1100px起工作台分栏 |
| 间距 | token为4/8/12/16/20/24px；具体布局以现有ui.css为准 |
| 圆角 | 控件6px；表面8px；快捷入口4px；弹层12px，按组件区分 |
| 图标 | 24×24 viewBox；描边1.8；圆端点/连接；currentColor；常规22px、主入口32px |
| 纹理 | ink-grain.png按628×628px重复铺设；使用.material-ink |

现有实现有两点需明确：ui.css仍有部分硬编码，不是完全由token驱动；原ui-sample照片移除按钮最小高度36px，与新页面至少44px的规范存在差距，修改该控件时应处理。本次资源整理不改写样板组件。

### 4.4 新页面交付核对

- [ ] 明确页面编号、采用的效果图及完整HTML/局部演示/待实现状态。
- [ ] 复用既有颜色、组件、SVG和纹理，业务语义符合PRD。
- [ ] 核对长地址/型号、未知字段、多候选、异常状态及人工确认。
- [ ] 检查窄屏溢出、底栏遮挡、文字可读性、键盘焦点和图片加载。
- [ ] 使用同一视口和状态比较效果图与实际HTML，记录真实结果。
- [ ] 同步Markdown、HTML、截图和核对记录，保留历史版本并标清状态。
- [ ] 不把概念图、样板或历史截图称为尚未实现的生产能力。

<a id="interaction"></a>
### 4.5 页面布局与交互

界面简称“门店助手”。先让接单人员和师傅看清对象、问题、数量与状态，再看说明和依据；进出货时突出库房、准确型号及本次变化。少量主色、分组文字与细分隔线建立层级，不要求所有区域都做卡片。

- 自然语言和结构化入口并存，查到后可接着办理；进入业务页时保留已提供的信息，缺项就近补全，不反复抄写。
- 使用“查上次记录、留货、提货、查看原件”等业务词；不展示Token、向量、工具函数名或模型思考过程，不擅自增加语音、自动读群、派工或支付。
- 手机使用工作台/待核对/售后/库存四项导航；维修从工作台或详情进入，统计/预留/流水从库存进入，管理功能走资料与设置。二级页只保留返回和本页操作区，返回保留已保存的草稿与筛选。
- 手机原件用独立阅读层，显示来源及已知定位；关闭后回到原记录。只承诺查看保存的群原文或照片，不承诺跳回未接入的微信群。
- 主色强调可执行操作；取消、返回、查看更多降低权重。预留本身不是异常，三项数量用标签与顺序区分，不自动把预留涂成警报色。

| 页面 | 必须保留的内容顺序与交互 |
| --- | --- |
| home | 任务输入 → 2×2高频入口 → 待核对摘要 → 最近任务；不放宣传大图或无关经营KPI |
| pending | 全部/售后/库存筛选，只列有权处理的草稿；对象、缺失项、保存时间和继续核对，不在列表堆完整表单 |
| service-draft | 来源原文/照片 → 待核对项 → 人工关联 → 可编辑字段 → 稍后/确认；最低条件不足时说明缺什么，未知日期不替代为今天 |
| service-search | 手机号/地址检索；有歧义才列完整可区分的地址候选，由人选择；保留查询条件及归档范围说明 |
| service-detail | 客户/地址/型号 → 历史时间线 → 本次问题/处理/配件/结果 → 对应来源/修订；未知日期单独标记，补充结果进入草稿 |
| repair-assistant | 准确机型与故障条件 → 依据/缺口 → 故障说明、检查前提、条件化建议 → 相邻引用 → 反馈与补充；改条件后重新查询 |
| inventory | 库房/型号筛选 → 分项在库/预留/可售 → 流水与预留入口 → 已建账合计 → 统计入口与数据截至时间；未建账单独说明 |
| reserved-pickup | 选客户和具体预留 → 原单库房/型号/剩余 → 数量/发生日期/备注 → 当前与预计数量 → 明确确认及实际回执；不能静默换库或换型号 |
| inbound-statistics | 日期/库房/型号 → 合计和覆盖范围 → 日期/库房/型号分组 → 原入库单；先满足数字和明细，不强制图表 |

#### 电脑工作台

把手机的纵向内容合理分栏，保留同一套任务和入口。

```text
┌───────────┬──────────────────────────┬───────────────────┐
│ 门店助手  │ 当前门店 / 工作台        │ 登录人员 / 设置   │
├───────────┼──────────────────────────┼───────────────────┤
│ 工作台    │ 任务输入                 │ 待核对摘要        │
│ 待核对    │ [描述要处理的事……]      │ 对象 / 缺失项     │
│ 售后档案  │ [文字/照片]      [开始]  │ [继续核对]        │
│ 库存      ├──────────────────────────┤                   │
│           │ 整理售后 / 查历史        │                   │
│           │ 维修辅助 / 查库存        │                   │
│           ├──────────────────────────┤                   │
│ 资料与设置│ 最近任务与业务回执       │                   │
└───────────┴──────────────────────────┴───────────────────┘
```

右侧只放与工作有关的待核对信息，不变成多组经营 KPI。屏幕变窄时右侧内容下移，不挤压正文。

#### 电脑来源对照

```text
┌───────────┬──────────────────────────────────────────────┐
│ 一级导航  │ 售后草稿核对 / 当前条目 / 返回              │
├───────────┼──────────────────────┬───────────────────────┤
│           │ 原始资料             │ 待核对字段            │
│           │ 图片/原文阅读        │ 客户关联              │
│           │ 已知来源信息         │ 电话、地址、问题      │
│           │ 放大/翻页            │ 日期、型号、处理结果  │
│           │                      │ 缺失/冲突提示         │
│           │                      │ [稍后核对][确认归档]  │
└───────────┴──────────────────────┴───────────────────────┘
```

同样的对照原则可用于维修回答：一侧是回答和检查条件，另一侧是当前引用的文档页。首版不要求拖拽分栏或复杂窗口系统。

#### 资料与设置及关键状态

资料与设置按权限组织手册资料、库房/型号、账号权限、期初建账/库存更正四组；手册显示机型、版本和审核/发布状态，建账同屏核对时点、实物与既有留货，更正先定位原单再核对原因与影响。具体业务与权限仍以PRD为准，当前未实现的管理页按开发计划建设。

| 状态 | 页面怎么表达 | 用户下一步 |
| --- | --- | --- |
| 首次使用、尚无资料 | 说明当前可用范围，展示直接入口 | 提交资料、建账或发起已有范围的查询 |
| 无匹配 | 保留查询条件，说明当前归档范围内未找到 | 修改条件或明确新建草稿 |
| 多候选 | 显示可区分的客户/地址/机型信息 | 选择正确对象 |
| 缺字段/识别不清 | 原件和对应字段附近明确标记 | 修正、补充或稍后核对 |
| 未建账 | 显示“未建账”，不显示零库存 | 由有权限人员确认起点 |
| 资料未覆盖 | 在回答前部说明机型或依据缺口 | 补准确型号、资料或询问师傅 |
| 正在处理 | 显示当前阶段，如“正在识别资料” | 可返回任务列表后继续，避免重复发起 |
| 提交结果待核验 | 明确“结果正在核验”，保留任务入口 | 等待核验或返回继续查看 |
| 库存变化/版本冲突 | 展示最新对象与数量，说明原预览需重核 | 核对新草稿后重新确认 |
| 成功 | 展示业务编号、实际结果和登记时间 | 看记录、回列表或继续下一条 |
| 失败/无权限 | 明确失败原因或所需职责，不伪装成空列表 | 修正、重试或交相应人员处理 |

### 4.6 文档维护来源

本文件是设计规范与资源索引的维护源，HTML版提供可视化查阅，二者的页面编号、状态、入口、截图和执行要求保持一致。2026-10-29将早期界面简报及重复图册并入本入口，保留原图、提示词与核对证据。业务规则维护在PRD，不在设计文件另立口径。

## 5. 已交付样板与核对证据

2026-10-28交付核心前端的工作台、待核对及七个业务视图，支持手机与电脑布局，全部使用本地示例。原件照片未单独提供，采用标注的示例原文；尚未接入真实资料、登录、后台管理或业务服务，不标为产品已验收。

- [核心前端核对记录](qa/frontend-c/README.md) / [概念图与实现并排](qa/frontend-c/comparison.html) / [电脑工作台](qa/frontend-c/home-desktop.jpg) / [电脑对照布局](qa/frontend-c/service-draft-desktop.jpg)。
- [原工作台与组件样板核对记录](qa/ui-sample-c/README.md)，仅适用于对应历史版本。
