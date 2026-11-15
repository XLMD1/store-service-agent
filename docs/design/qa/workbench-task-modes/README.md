# 工作台统一任务入口

使用独立测试库与虚构任务验证新建、待办和历史。

| 页面编号 | 核对行为 | 截图 |
| --- | --- | --- |
| home | 在库存、售后间切换保留原输入。提交售后进入售后任务，待办显示两种业务 | [手机 390px](workbench-service-390.jpg) |
| home | 库存模式显示模型状态，电脑右栏显示本人的库存和售后待办 | [电脑 1440px](workbench-all-1440.jpg) |
| home | 选择售后筛选后，月历按创建日展示售后任务 | [电脑历史](workbench-history-1440.jpg) |

库存及售后 PostgreSQL 回归 57 项、前端 73 项、lint、类型检查及静态 mock 构建通过。Edge 端到端 1 项通过，含 320px、390px、1440px 宽度核对，未见横向溢出。本机浏览器脚本为 `.local/test_workbench_modes_browser.py`。

截图中的模型未配置提示属于独立测试环境。真实模型对比结果另见[售后评估](../../../../evals/service-agent/README.md)。

## 首页入口精简

首页通过「新建任务 → 售后」创建售后任务，旧任务仍可从待办与历史进入。DeepSeek 状态移到任务卡标题旁，并随库存模式显示。以上三张图是统一入口初版，以下两张对应 V1.38。

| 页面编号 | 核对行为 | 截图 |
| --- | --- | --- |
| home | 库存模式的模型状态及设置入口在标题旁，常用功能移除重复的售后助手卡片 | [电脑库存模式](workbench-simplified-inventory-1440.jpg) |
| home | 售后模式隐藏模型状态，仍可从首页正常提交并打开售后任务 | [手机售后模式](workbench-simplified-service-390.jpg) |

前端 73 项、lint、类型检查及静态 mock 构建通过。Edge 端到端 1 项通过，覆盖 320px、390px 和 1440px 宽度。本机脚本为 `.local/test_workbench_annotation_browser.py`。
