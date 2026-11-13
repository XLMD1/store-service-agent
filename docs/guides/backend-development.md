# M1 后端开发与审核入口

当前已实现M1身份、库存业务、统计更正、任务与DeepSeek首轮联调；验收状态以开发计划为准。当前运行8002，2026-11-04已按用户要求备份并清空其业务/任务数据，保留登录账号和权限；旧8001测试替身服务已停止。运行环境与历史验证分别记录，下文旧阶段叙述不代表最新能力边界。

## 环境与依赖

本次实测：Windows、Python 3.12.10、PostgreSQL 18；FastAPI 0.162.0、SQLAlchemy 2.0.55、Alembic 1.20.1、psycopg 3.3.6、Uvicorn 0.54.0、pytest 9.2.0。完整直接/传递依赖见根目录 `requirements.lock`，维护源是 `requirements.in`。当前 Starlette 测试客户端采用 httpx2 2.16.0。

```powershell
$env:UV_CACHE_DIR = Join-Path $PWD '.local/uv-cache'
uv venv .venv --python 3.12
uv pip sync requirements.lock --python .venv/Scripts/python.exe
uv pip check --python .venv/Scripts/python.exe
```

也可用虚拟环境内 pip 安装锁文件。升级依赖须重新验证兼容性。驱动及 Cookie 方式参考 [SQLAlchemy psycopg 文档](https://docs.sqlalchemy.org/en/20/dialects/postgresql.html#module-sqlalchemy.dialects.postgresql.psycopg)、[psycopg 安装文档](https://www.psycopg.org/install/)与 [FastAPI Cookie 文档](https://fastapi.tiangolo.com/advanced/response-cookies/)。

## 隔离数据库

首次运行 `python scripts/setup_local_postgres.py`，默认使用 `C:/Program Files/PostgreSQL/18/bin`，可通过 `PG_BIN` 指定其他位置。脚本只创建项目 `.local/postgres` 集群，仅监听 `127.0.0.1:55432`，使用随机密码及 SCRAM 认证，应用角色无超级用户权限。创建独立库 `store_agent_m1_dev`、`store_agent_m1_test`，配置保存在被 Git 忽略的 `.local/dev.json`、`.local/test.json`。不得输出或提交这些文件及备份。

本机两个库已创建，**无需再次初始化**。集群存在时脚本拒绝重建；初始化中断应保留现场并检查 `.local/postgres.log`，不能让脚本接管已有业务目录。首次受限启动留下的 `.local/postgres-incomplete` 为未使用开发集群。

```powershell
# 已有集群启动；若已运行无需再次执行
& 'C:/Program Files/PostgreSQL/18/bin/pg_ctl.exe' -D "$PWD/.local/postgres" -l "$PWD/.local/postgres.log" -w start
# 完成开发且不再需要服务时停止；只影响本项目独立集群
& 'C:/Program Files/PostgreSQL/18/bin/pg_ctl.exe' -D "$PWD/.local/postgres" -m fast -w stop
```

应用不自动建表，必须执行迁移：

```powershell
$env:APP_CONFIG_FILE = '.local/dev.json'
.venv/Scripts/python -m alembic upgrade head
.venv/Scripts/python -m alembic current
.venv/Scripts/python -m alembic check
```

配置字段是 `database_url`、`origin`、`cookie_secure`。也支持环境变量 `APP_DATABASE_URL` 与 `APP_ORIGIN`（该模式要求 HTTPS）。HTTP 仅允许显式配置的回环开发地址。客户端只访问 API，不取得数据库配置。

## 初始化与启动

开发库没有默认账号或密码。首次负责人只能在账号表为空时通过本地交互命令建立：

```powershell
$env:APP_CONFIG_FILE = '.local/dev.json'
.venv/Scripts/python -m app.cli init-owner
# 输入用户名、两次至少12位密码，并输入 CREATE OWNER 明确确认
.venv/Scripts/python -m uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000 --no-proxy-headers
```

启动后打开[同源页面](http://127.0.0.1:8000/)，进入登录、库存查询、期初建账和基础资料。页面由`app/web/`提供，不使用原型模拟脚本；开发库仍无默认账号。也可通过本机HTTP客户端审核身份接口：

8000审核进程现连接`.local/review.json`及独立`store_agent_m1_review`，保留此前账号和虚构样例。pytest只清理`store_agent_m1_test`，不再清空审核页。审核库由原测试库备份恢复，不是开发库的默认账号。使用开发账号时先停止审核进程，再按上方`.local/dev.json`命令初始化/启动，避免争用8000端口。

| 接口 | 行为 |
| --- | --- |
| `GET /api/auth/csrf` | 建立15分钟匿名会话或读取当前会话 CSRF 令牌；客户端保留 Cookie |
| `POST /api/auth/login` | JSON：`username/password`；成功轮换会话，旧会话失效；登录后重新读取 CSRF |
| `GET /api/auth/me` | 返回当前账号、职责及权限，不包含密码派生值 |
| `POST /api/auth/logout` | 撤销本会话，其他会话保持有效 |
| `POST /api/accounts` | 负责人创建账号：`username/password/roles/confirmed:true` |
| `GET /api/accounts/technicians` | 负责人读取维修师傅账号、编号和启用状态，包含已停用账号 |
| `PATCH /api/accounts/{id}` | 负责人更新 `roles` 或 `enabled`，要求 `confirmed:true`；禁止移除最后可用负责人 |

所有 POST/PATCH，包括登录和退出，都要求精确匹配配置的 `Origin` 和同一会话的 `X-CSRF-Token`。Cookie 为 HttpOnly、SameSite=Strict，HTTPS 必须使用 Secure。未知字段拒绝，错误响应不回显密码。数据库只保存密码派生值及令牌摘要。CSRF 以会话随机令牌为 HMAC 密钥派生，同会话跨标签页稳定，登录轮换后随之改变。

会话有效8小时，不滚动延期；每次请求读取当前账号和职责。停用撤销已有会话，重新启用必须重新登录。账号创建/修改与审计记录同事务提交，负责人变更串行校验；数据库事务在响应发送前完成。

登录限制持久化在 PostgreSQL：同账号5次失败/5分钟，同来源30次尝试/5分钟；成功重置该账号失败计数，不重置来源预算。超限返回429及 Retry-After。来源取直接连接地址，启动命令禁用代理头；以后接入反向代理须重新核定可信代理和来源口径。

## 测试与备份

M1-02新增接口：`GET/POST /api/catalog/warehouses`、`GET/POST /api/catalog/models`、`PATCH /api/catalog/{warehouses|models}/{id}`、`GET/POST /api/catalog/customers`、`GET /api/inventory/balance`、`POST/GET/PATCH /api/drafts[/{id}]`、`POST /api/operations/{id}/confirm`和`GET /api/operations/{id}`。所有写接口沿用Origin/CSRF；资料写入需显式`confirmed:true`，建账必须先取得草稿版本与后端操作标识再人工确认。查询、确认请求字段以架构第17节和实际schemas为准；当前另支持M1-04的`inventory_outbound / reservation_create / reservation_cancel / reservation_pickup`，请求契约见架构17.7。

库房/型号维护请求严格校验版本，停用保留历史；期初客户引用与售后档案独立，不按手机号自动合并客户。建账草稿支持缺项保存；已有起点、超额预留、旧草稿、参数或主体不符均不能写入。成功操作先核验原绑定和当前权限，再返回原回执，不重复建账。

办理页URL只保存草稿编号，不存密码或客户字段。刷新从后端恢复草稿或回执；提交断连后按原操作核验，不能自动重建操作。退出不会删除共享业务事实。公开静态目录仅限`app/web`，不向客户端提供配置、数据库或仓库根目录。

```powershell
$env:M1_TEST_CONFIG = '.local/test.json'
.venv/Scripts/python -m pytest -q
node prototypes/frontend/rules.test.cjs
node tests/web-form-state.test.cjs
node tests/web-inbound-time.test.cjs
node tests/web-api-response.test.cjs
node tests/web-movements.test.cjs
node tests/web-inventory.test.cjs
git diff --check
```

测试清空指定测试库身份表，只接受显式配置且地址为回环、库名为 `store_agent_m1_test` 的数据库。不要在该库存放真实数据。覆盖 PostgreSQL、独立会话、权限撤销、CSRF、并发负责人变更、限流及独立 Uvicorn 进程重启。测试不代表38项业务 AC 或6项 DEP 已通过。

基础备份采用 PostgreSQL `pg_dump -Fc`，从本机配置以进程环境变量提供密码，归档放在 `.local/backups/`。本轮已生成开发身份库备份，并以 `pg_restore --list` 核对归档目录；未进行恢复、自动调度、异地保留或完整业务一致性演练，后续仍由 M4-01 验证。

## 当前限制

M1-06最新范围见[库存Agent运行与接口](inventory-agent.md)，统计/更正已于M1-05实现；下文早期阶段记录保留历史适用范围。M1-06新增真实任务、受限解析、草稿与恢复；DeepSeek已于2026-11-04完成首轮12次真实调用；实测观察与费用限制见运行说明，不能把配置存在或历史测试替身当作本轮证据。

本轮限本机开发及技术验证，未交付真实账号、部署、外网访问、安装包或真机测试。期初建账的确认/幂等/事务已实现，入库已支持受控确认，M1-04已补出库、留货/取消/提货及预留/流水；统计、更正及Agent仍待后续切片。账号管理仍只有API，没有管理页面。每个M1小阶段完成后等待用户审核；页面证据见[核对记录](../design/qa/m1-02/README.md)。


M1-03运行说明：通过“登记入库”选择库房/型号、数量、发生日期或精确时刻及依据，保存草稿后人工确认。缺项在“待核对草稿”继续；成功显示提交时的实际回执，最新余额另行查询。发生日期等于T0当天时需核实after及依据；旧事件不得重复入库。日期精度原单没有虚构时刻，时间字段未改动时保持原精度。

迁移0004遇到已保存日期精度事件时拒绝降级，不可为了回退补成午夜。升级前先备份，回退需用兼容的迁移前备份在隔离环境验证；本轮仅验证空开发库迁移往返及带日期数据拒绝降级，未宣称完整恢复演练完成。M1-03证据见[页面记录](../design/qa/m1-03/README.md)。


M1-04审核：打开库存页的“普通出库”“客户留货”；提货/取消先进入“客户预留”检索并选择具体单据。客户引用可独立登记；口头/定金/全款是依据标签，不核算收款。所有库存写入先保存草稿、核对后端影响、显式勾选再确认，断连按原操作核验。“库存流水”可筛选日期/操作类型，原单不可直接编辑。

0005已在本机开发、测试及审核库升级；审核库原两账户不变，本轮新增独立M1-04虚构库7/3/4及缺日期提货草稿。存在新业务草稿或正式操作时不允许降级0005；需在隔离环境核验兼容的迁移前备份。页面、样例链及未覆盖项见[本阶段核对](../design/qa/m1-04/README.md)，完整执行结果见[M1-04实施记录](../plans/m1-04-implementation.md)。


M1-04审核反馈优化：库存页按最新审核要求，库房及型号必填、初始为空，人工提交后才查询；模糊/同名先人工选择候选。`GET /api/inventory/overview`按必填warehouse_id及可选model_id返回后端分项/已建账合计，旧balance接口不变。库房创建支持name+confirmed:true，内部code自动生成；既有code仍兼容且不重写。库房与型号页面不再重复登记客户，统一进入客户资料；页面“客户预留”改为“预留查询”。新库存视图脚本inventory.js在app.js之前加载。无需新迁移；[本轮记录](../design/qa/m1-04-refinement/README.md)保留截图、126后端/11生产JS/4样板结果及限制。

最新交互修复见[手动查询核对](../design/qa/m1-04-manual-query/README.md)：不恢复或自动提交上次库存条件，候选选择只确认对象；所有启用按钮提供鼠标提示。只读overview接口仍保留可选model_id兼容能力，当时网页仅传具体型号；现行明确选择全部型号时省略model_id。

当前电脑页面与查询选择见[本轮核对](../design/qa/m1-04-desktop-query/README.md)：顶部电脑端/手机端切换接正式同源页面，电脑复用C侧栏布局；切换不重新加载表单。初始条件为空，型号必须明确选择全部或具体项；库房完整列表可随时切换。未更改后端接口、权限及库存事务。


## M1-05审核

同源页新增#statistics、#correction、#correction?kind=inventory_adjustment、#reconciliation；负责人沿用inventory.correct。统计和对账须明确查询，盘点/数量更正必须保存草稿并人工核对预览后确认；异常仍用原操作标识核验。代码见app/web/reconciliation.js及app/inventory/corrections.py、reports.py。

审核库已备份升级至0006，旧7账户保留；构造M1-05独立虚构样例供审核。pytest仍只清理store_agent_m1_test；最终162项后端、21项生产JS及4项样板通过，证据与限制见[阶段核对](../design/qa/m1-05/README.md)。新增node tests/web-corrections.test.cjs。不要通过删除迁移或降级丢弃更正历史。
