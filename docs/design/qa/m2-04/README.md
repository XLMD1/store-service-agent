# M2-04 维修结果补充

2026-11-15 使用专用 PostgreSQL 测试库、虚构来源及 Edge 浏览器双会话验证。

| 页面编号 | 核对行为 | 截图 |
| --- | --- | --- |
| service-detail | 在同一档案下选择新来源、输入复测结果，预览后逐次确认。归档时结果和旧原件入口可查 | [手机 390px](service-supplement-preview-390.jpg) |
| service-detail | 第二人从旧版本确认时看到最新补充，当前输入保留。重新预览后可继续提交。来源链接按提交者显示 | [电脑 1440px](service-supplement-conflict-1440.jpg) |

`M1_TEST_CONFIG=.local/test.json` 下运行 `python -m pytest -q tests/integration/test_service_revisions.py tests/integration/test_service_archive.py tests/integration/test_service_extraction.py tests/integration/test_service_records.py tests/integration/test_sources.py tests/integration/test_source_photos.py`，20 项通过。Alembic 迁移校验、前端 72 项、lint、类型检查及静态 mock 构建通过。Edge 端到端 1 项通过，两个视口无横向溢出。本机浏览器脚本为 `.local/test_m204_browser.py`。

上述截图对应第一轮的维修结果补充。

## 档案修订与售后助手

从「工作台 → 售后助手」输入一次售后事项。系统识别明确的手机号、带「地址」标签的地址或档案编号，再由人核对任务类型和候选。也可在页面补齐查找条件和事实。查历史直接展示结果；补充和新报修在预览后由有权限的账号确认。待确认内容及回执从「我的售后任务」恢复。

| 页面编号 | 核对内容 | 截图 |
| --- | --- | --- |
| home | 工作台可进入售后助手 | [手机入口](service-agent-home-390.jpg) |
| service-task | 同号两址先选地址再选记录；刷新后恢复草稿，确认并刷新后仍可查回执 | [手机恢复预览](service-task-restored-390.jpg) |
| service-detail | 更正型号，核对原因和旧值；负责人确认作废后仍能查原件及修订历史 | [电脑更正与作废](service-void-and-revision-1440.jpg) |

专用 PostgreSQL 回归 28 项通过，包含售后 Agent、修订、归档、来源照片和工费。Alembic 检查通过。Edge 本轮端到端 1 项通过，两个视口无横向溢出。前端 72 项、lint、类型检查和静态 mock 构建通过。本机脚本为 `.local/test_m204_agent_browser.py`。

此版售后助手处理单份文字任务，使用本机匹配规则。客户与地址关联的更改、无标签地址的自由表达、仅凭师傅和日期定位、一句话多单及真实门店材料均未验收。
