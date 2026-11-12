# 项目文档入口

按当前任务选择入口，不必通读全部文档。需求、实现设计和任务进度各维护一份主文档，避免在多个文件中重复修改同一事实。

## 三份主文档

| 需要回答的问题 | 维护源 | 按需阅读 |
| --- | --- | --- |
| 做什么、业务规则和验收是什么 | [PRD](prd/store-service-agent-prd-v1.0.md) | 第7节功能、第8节库存、第9～11节确认/状态/异常、第13节验收 |
| 模块、数据、接口和恢复如何实现 | [架构设计](architecture/store-service-agent-architecture-v1.0.md) | 第5～8节模块/数据/事务、第9～12节任务/来源/接口/运行 |
| 下一步先做什么、阶段何时完成 | [开发计划](plans/development-plan-v1.0.md) | 阶段任务、退出条件、最小切片和状态记录 |

查阅[当前交付状态](plans/development-plan-v1.0.md#13-状态与阶段完成记录)、[按日开发历史](plans/development-history.md)或[前端样板](../prototypes/frontend/README.md)。

目录导航见[项目首页](../README.md)，2026-11-04 的环境整理与数据清空见[维护记录](maintenance/2026-11-04-cleanup.md)。

## 按任务补充阅读

| 任务 | 文档 |
| --- | --- |
| 代码、测试与交付 | [开发规范](guides/development.md) |
| 后端启动、身份接口与本机测试 | [后端开发说明](guides/backend-development.md)；验收状态仍以开发计划为准 |
| 库存Agent、DeepSeek配置与任务恢复 | [M1-06运行与接口](guides/inventory-agent.md)；模型实测与本机测试替身分别记录 |
| 售后原件与手工草稿接口 | [架构第10.1节](architecture/store-service-agent-architecture-v1.0.md#101-售后资料路径)；交付范围和测试见开发计划 |
| 安装与维修工费台账 | [业务规则 FR-13](prd/store-service-agent-prd-v1.0.md#713-fr-13-安装与维修工费台账--p0)、[架构第8.5节](architecture/store-service-agent-architecture-v1.0.md#85-工费台账的权限事务与查询)、[M2 实施顺序](plans/development-plan-v1.0.md#7-m2售后档案闭环) |
| M0构造样例与验收任务 | [样例数据入口](../evals/README.md)；实际缺口与进度仍在开发计划维护 |
| 提交、推送、PR格式 | [Git规范](guides/git.md) |
| 页面设计或实现 | [设计规范AI版](design/design-resources.md)及[HTML可视化版](design/design-resources.html)：页面、素材、交互与视觉规则的统一入口 |
| 查看当前保留截图或精简历史过程图 | [关键截图入口](design/qa/README.md)与[截图清单](design/qa/screenshot-index.json)；历史目录README保留当时核对范围 |
| 检查当前mock前端的验证范围 | [全量mock核对记录](design/qa/frontend-mock/README.md)与[关键截图入口](design/qa/README.md) |
| 追查早期核心前端样板 | [历史核对记录](design/qa/frontend-c/README.md)与[概念图/实现核对文字](design/qa/frontend-c/comparison.html)，过程截图已精简 |
| 追查原工作台样板的视觉修正 | [原工作台核对记录](design/qa/ui-sample-c/README.md)，仅作为对应历史版本的证据 |
| 重新生成或追查图片素材 | [生成提示词与局部修正记录](design/mobile-pages-c-prompts-v1.md)、[通用素材说明](../prototypes/ui-sample/assets/README.md) |

## 维护约定

- 需求变化更新PRD，实现方式变化更新架构，任务和证据变化更新计划；保留已确认、建议和待验证的区别。
- 页面状态、链接、截图和核对记录同步到设计规范两版；原件、生成提示词和核对证据按需读取。
- 未来代码路径、测试名称和命令是实施约定，不表示文件已存在或测试已通过。
- 早期设计草稿和已结束的样板实施计划不再单独维护；有效内容已归入主文档、设计规范和对应核对记录。重复七页图册已由设计规范的页面目录替代。
