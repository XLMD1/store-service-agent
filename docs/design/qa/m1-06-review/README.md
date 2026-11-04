# M1-06审核反馈核对 / 2026-11-04

本文记录V1.19的五项反馈。后续普通出库备注和分组侧栏见[最新核对](../m1-06-navigation/README.md)；本文图片中的平铺侧栏保留为历史证据，未改的月历/设置功能仍适用。

**五项反馈已实现并完成本机验证，待本轮用户审核。** 沿用C方向，不修改数据库结构、不清空数据，不提交/推送或进入M2。本轮没有调用付费模型。

## 页面与功能

| 页面编号 | 本轮变化 | 实际截图 |
| --- | --- | --- |
| m1-inbound | 到货依据与备注可选；后端只放宽入库，建账、数量、T0、其他业务依据及人工确认照常校验；独立mock同步 | [390px](inbound-optional-390.jpg) |
| home | 去掉粘贴文字按钮，保留输入框原生粘贴；我的库存任务改月历，按北京时间创建日期查看，支持选日、前后月、今天、方向键 | [电脑](home-calendar-desktop.jpg)、[390px](home-calendar-390.jpg)、[320px](home-calendar-320.jpg) |
| deepseek-settings | 新页面，负责人可保存、更换、清除密钥；确认复选框、空输入不覆盖、保存后立即用于后续任务，保存本身不调用模型 | [电脑](deepseek-settings-desktop.jpg)、[390px表单](deepseek-settings-390.jpg) |
| m1-pending | 成功任务从待核对移除，部分完成保留未完成任务；窗口恢复焦点/可见时刷新，历史和原回执保留到日历 | [电脑](pending-active-only-desktop.jpg) |

当前待核对中仍有用户先前保存的未完成草稿和1项待补任务，它们不因同库房/型号存在成功记录就被删除；本轮只移除真实完成的事项。原来的最近30项接口继续兼容，月历和待办有专门筛选，不被30项遮住更早任务。

七张截图均为当前本机服务的浏览器视口，不是效果图、实体手机或生产验收；部分滚动到月历/表单以显示关键内容。截图尺寸及哈希见[screenshot-manifest.json](screenshot-manifest.json)，页面几何/交互检查见[layout-checks.json](layout-checks.json)。未生成新素材，未覆盖历史截图。

## 密钥保存边界

- 用户已选择保存在运行服务的本机。默认.local/deepseek-settings.json受Git忽略；不入业务数据库，不返回完整密钥，不用localStorage/sessionStorage保存，不把密钥写进日志或模型上下文。
- Windows使用当前服务用户的DPAPI保护；其他系统使用权限受限的本机文件。[微软CryptProtectData说明](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata)是Windows实现依据。跨服务用户/机器恢复配置须重新提供密钥，不能保证复制密文即能使用。
- 仅account.manage可读配置状态及修改；POST/DELETE沿用登录、Origin/CSRF，保存要求confirmed=true。请求验证错误不回显原输入。密钥字段使用密码框，保存尝试后清空输入。
- 原环境变量兼容；本机保存优先。清除通过本机停用标记阻止重新回落到环境变量，重新保存后启用；不删除用户原有Windows环境变量。
- API/持久化测试仅用临时目录和合成密钥；实际审核服务的环境密钥未更换、未清除，本机设置文件未自动生成。未自动迁移已有密钥或测试真实API连通性。

## 验证

| 检查 | 结果 |
| --- | --- |
| 真实PostgreSQL全量pytest | **255通过，201.11秒**；M1_TEST_CONFIG显式专用store_agent_m1_test |
| 新入库校验 | 空/空白备注可确认、原回执幂等；T0当天仍须核实，不跳过库存校验 |
| 设置API与provider | 负责人保存/替换/清除、新provider读取持久配置；非负责人、CSRF、非法/未确认输入被拒绝，响应不含密钥；Windows文件不含明文合成密钥 |
| 月历与待办API | 北京时间跨月、36项不截为30项、非法月份；成功任务从待办移除而历史可查，部分完成仍保留 |
| 前端DOM | **63通过**，含月份/日期/方向键、去粘贴按钮、待办焦点刷新、密钥确认/清除及不持久存储 |
| lint / typecheck / build | 通过，20文件静态mock产物；类型检查限严格接口声明，构建不是生产部署包 |
| 浏览器 | 工作台、设置、待核对、入库在320/390px及相关电脑1440px核对；实际前后月/今天/选日/方向键均操作，未提交业务或实际密钥 |
| 当前数据 | 重启前后及页面检查后，13张身份/基础资料/业务/任务表的行数及内容指纹完全一致；保留用户已录入记录及工作台未发送文字 |

初次设置测试的受限进程无法访问pytest临时目录；改在正常本机用户上下文运行，仍只使用专用测试库及合成密钥，不把权限错误计作通过。完整回归已单独复验。

手机320px初检发现通用.actions>*的flex-basis:100%把月份按钮撑出屏幕（scrollWidth523/clientWidth305），已给该组件限定尺寸，复验305/305；390px为375/375，无横向溢出。保留初检失败记录并标before-fix，其余为最终布局证据。日期按钮最小实测约30.7px宽、54px高；方向键可跨日/月，Tab/回车及可见焦点保留。日任务按钮保持整行文字，长任务标题独立换行。

## 本轮文件

- 后端：app/config.py、app/agent/settings.py/provider.py/schemas.py/router.py/service.py、app/inventory/service.py、app/operations/service.py。
- 前端：app/web/agent-pages.js/css、app.js、inbound.js、mock-api.js、contracts.ts、eslint.config.mjs。
- 测试：tests/integration/test_agent_settings.py、test_inventory_operations.py、test_inventory_agent.py、tests/web-agent.test.cjs、tests/conftest.py（隔离设置文件）。
- 文档：本核对记录与截图/清单、设计规范MD/HTML、PRD、架构、开发计划/实施计划和运行接口说明。

审核入口：[工作台](http://127.0.0.1:8002/#home)、[DeepSeek设置](http://127.0.0.1:8002/#deepseek-settings)、[待核对](http://127.0.0.1:8002/#pending)。请自行在设置页输入需要使用的密钥，不在聊天中提供。
