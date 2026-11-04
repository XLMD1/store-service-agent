# 门店助手

单门店内部的库存与售后协作项目。后端为Python/FastAPI/PostgreSQL，正式库存写入经过草稿、人工确认、权限与事务校验。当前实现状态以[开发计划](docs/plans/development-plan-v1.0.md)为准。

| 目录 / 入口 | 用途 |
| --- | --- |
| [app/](app/) | 后端业务与当前生产前端；共用颜色变量及素材统一在app/web |
| [migrations/](migrations/) | Alembic数据库结构迁移 |
| [tests/](tests/) | 接口、库存事务、恢复与前端回归 |
| [docs/README.md](docs/README.md) | 需求、架构、计划、设计与运行文档入口 |
| [evals/](evals/) | 虚构开发样例、验收预期与实际联调结果 |
| [scripts/](scripts/) | 本地数据库初始化及前端预览/构建工具 |
| [prototypes/](prototypes/) | 有引用依据的历史交互样板；不作为真实业务服务 |

当前本机开发审核入口为http://127.0.0.1:8002/ 。2026-11-04曾按用户要求备份并清空该环境的业务与任务数据，保留登录账号及权限；之后审核期间新录入的记录已保留，后续页面修改没有再次清空数据。旧审核库、开发库和测试库未清空。历史操作见[整理与清空记录](docs/maintenance/2026-11-04-cleanup.md)，最新功能与验证见开发计划。

启动、数据库和测试说明见[后端开发说明](docs/guides/backend-development.md)与[库存Agent运行说明](docs/guides/inventory-agent.md)。依赖维护源为requirements.in/requirements.lock及package.json/package-lock.json；.venv、node_modules、dist和.local均为本机内容，不提交密钥、配置或数据库备份。
