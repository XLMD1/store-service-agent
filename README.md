# 门店助手

单门店内部的库存与售后协作项目。后端为Python/FastAPI/PostgreSQL，正式库存写入经过草稿、人工确认、权限与事务校验。[当前进度与下一步](docs/plans/development-plan-v1.0.md#13-状态与阶段完成记录)统一在开发计划维护。

| 目录 / 入口 | 用途 |
| --- | --- |
| [app/](app/) | 后端业务与当前生产前端；共用颜色变量及素材统一在app/web |
| [migrations/](migrations/) | Alembic数据库结构迁移 |
| [tests/](tests/) | 接口、库存事务、恢复与前端回归 |
| [docs/README.md](docs/README.md) | 需求、架构、计划、设计与运行文档入口 |
| [evals/](evals/) | 虚构开发样例、验收预期与实际联调结果 |
| [scripts/](scripts/) | 本地数据库初始化及前端预览/构建工具 |
| [prototypes/](prototypes/) | 有引用依据的历史交互样板；不作为真实业务服务 |

本机审核入口为 [127.0.0.1:8002](http://127.0.0.1:8002/)。该环境在 2026-11-04 的备份、清理范围和验证见[维护记录](docs/maintenance/2026-11-04-cleanup.md)。

启动、数据库和测试说明见[后端开发说明](docs/guides/backend-development.md)与[库存Agent运行说明](docs/guides/inventory-agent.md)。依赖维护源为requirements.in/requirements.lock及package.json/package-lock.json；.venv、node_modules、dist和.local均为本机内容，不提交密钥、配置或数据库备份。
