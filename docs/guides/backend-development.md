# M1 后端开发与审核入口

当前实现包含已获准继续的M1-01/M1-02，以及已获用户审核通过的M1-03入库与确认基础。登录、资料、建账、查询、入库、待核对已接后端；出库及Agent未实现。测试账号不代表真实门店授权。

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
| `PATCH /api/accounts/{id}` | 负责人更新 `roles` 或 `enabled`，要求 `confirmed:true`；禁止移除最后可用负责人 |

所有 POST/PATCH，包括登录和退出，都要求精确匹配配置的 `Origin` 和同一会话的 `X-CSRF-Token`。Cookie 为 HttpOnly、SameSite=Strict，HTTPS 必须使用 Secure。未知字段拒绝，错误响应不回显密码。数据库只保存密码派生值及令牌摘要。CSRF 以会话随机令牌为 HMAC 密钥派生，同会话跨标签页稳定，登录轮换后随之改变。

会话有效8小时，不滚动延期；每次请求读取当前账号和职责。停用撤销已有会话，重新启用必须重新登录。账号创建/修改与审计记录同事务提交，负责人变更串行校验；数据库事务在响应发送前完成。

登录限制持久化在 PostgreSQL：同账号5次失败/5分钟，同来源30次尝试/5分钟；成功重置该账号失败计数，不重置来源预算。超限返回429及 Retry-After。来源取直接连接地址，启动命令禁用代理头；以后接入反向代理须重新核定可信代理和来源口径。

## 测试与备份

M1-02新增接口：`GET/POST /api/catalog/warehouses`、`GET/POST /api/catalog/models`、`PATCH /api/catalog/{warehouses|models}/{id}`、`GET/POST /api/catalog/customers`、`GET /api/inventory/balance`、`POST/GET/PATCH /api/drafts[/{id}]`、`POST /api/operations/{id}/confirm`和`GET /api/operations/{id}`。所有写接口沿用Origin/CSRF；资料写入需显式`confirmed:true`，建账必须先取得草稿版本与后端操作标识再人工确认。查询、确认请求字段以架构第17节和实际schemas为准；当前支持`inventory_opening`及`inventory_inbound`。

库房/型号维护请求严格校验版本，停用保留历史；期初客户引用与售后档案独立，不按手机号自动合并客户。建账草稿支持缺项保存；已有起点、超额预留、旧草稿、参数或主体不符均不能写入。成功操作先核验原绑定和当前权限，再返回原回执，不重复建账。

办理页URL只保存草稿编号，不存密码或客户字段。刷新从后端恢复草稿或回执；提交断连后按原操作核验，不能自动重建操作。退出不会删除共享业务事实。公开静态目录仅限`app/web`，不向客户端提供配置、数据库或仓库根目录。

```powershell
$env:M1_TEST_CONFIG = '.local/test.json'
.venv/Scripts/python -m pytest -q
node prototypes/frontend/rules.test.cjs
node tests/web-form-state.test.cjs
node tests/web-inbound-time.test.cjs
node tests/web-api-response.test.cjs
git diff --check
```

测试清空指定测试库身份表，只接受显式配置且地址为回环、库名为 `store_agent_m1_test` 的数据库。不要在该库存放真实数据。覆盖 PostgreSQL、独立会话、权限撤销、CSRF、并发负责人变更、限流及独立 Uvicorn 进程重启。测试不代表38项业务 AC 或6项 DEP 已通过。

基础备份采用 PostgreSQL `pg_dump -Fc`，从本机配置以进程环境变量提供密码，归档放在 `.local/backups/`。本轮已生成开发身份库备份，并以 `pg_restore --list` 核对归档目录；未进行恢复、自动调度、异地保留或完整业务一致性演练，后续仍由 M4-01 验证。

## 当前限制

本轮限本机开发及技术验证，未交付真实账号、部署、外网访问、安装包或真机测试。期初建账的确认/幂等/事务已实现，入库已支持受控确认，出库、留货、提货、统计及Agent仍待后续切片。账号管理仍只有API，没有管理页面。每个M1小阶段完成后等待用户审核；页面证据见[核对记录](../design/qa/m1-02/README.md)。


M1-03运行说明：通过“登记入库”选择库房/型号、数量、发生日期或精确时刻及依据，保存草稿后人工确认。缺项在“待核对草稿”继续；成功显示提交时的实际回执，最新余额另行查询。发生日期等于T0当天时需核实after及依据；旧事件不得重复入库。日期精度原单没有虚构时刻，时间字段未改动时保持原精度。

迁移0004遇到已保存日期精度事件时拒绝降级，不可为了回退补成午夜。升级前先备份，回退需用兼容的迁移前备份在隔离环境验证；本轮仅验证空开发库迁移往返及带日期数据拒绝降级，未宣称完整恢复演练完成。M1-03证据见[页面记录](../design/qa/m1-03/README.md)。
