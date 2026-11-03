# 工作台、售后、维修与设置前端契约

2026-11-03。维护源：`app/web/service-pages.js`、`service-pages.css`。这是未来后端接入的拟定契约与当前内存演示边界，**不是已存在的API**。页面采用C方向；原图和历史`prototypes/frontend`保持不变。页面状态及截图由设计资源两版统一登记。

## 当前演示边界

仅存在全局`FrontendMock`时开放交互；普通入口直接访问这些路由仅显示未接入说明，不调用API。六个页面使用全局shell与原生select，选择外观交由公共增强器。`servicePendingItems()`提供当前待核对`{id,type,title,hint,href}`给待核对页，`type`为`service`。全部对象虚构，刷新丢失；不写本地持久存储、不上传文件、不调用AI或未实现接口。

照片限制JPG/PNG/WebP及10MB，仅Object URL本地预览；转交草稿后对象由草稿保留。照片未自动识别，用户填写字段；原始文本与照片独立保留。清空手机号表示明确未知；模糊号码不可作为已核对号码。日期、型号、称呼可未知，绝不替代为当前日期。示例规则依据PRD 7.2产品建议：联系方式或地址至少一项、问题、来源、人工关联。生产规则仍须业务核定。

确认采用草稿版本、用户勾选和预览；重复同一内存草稿确认返回相同记录。结果补充生成独立草稿，确认后新增修订，原始来源保留；目标记录版本变化拒绝旧补充。内存不等于服务端事务、权限或持久幂等保证。

## 拟定服务端接口

统一JSON，以下路径均在`/api`下。请求按当前登录身份授权，不接受模型文本代替人工授权。写入需要CSRF、当前草稿/目标版本和操作标识；服务端负责事务和幂等。响应仅返回当前账号可见数据。错误使用`401`登录失效、`403`无权、`404`对象不存在、`409`版本/幂等冲突（返回最新版本）、`422`缺字段或非法状态。字段命名为未来建议，不影响当前库存API。

| 接口 | 请求 | 响应与边界 |
| --- | --- | --- |
| `POST /service/sources` | multipart `file`或`text`，可选`source_kind`与已知页码 | `{id,kind,text,file_url,known_location}`；未知来源定位不补造；附件须经服务端类型、大小、权限检查 |
| `POST /service/drafts` | `{source_ids,fields:{name,phone_raw,address,problem,model,code,date,date_precision,method,parts,result}}` | `{id,version,state,fields,missing_fields,candidates}`；可以只保存材料，不能自动归档 |
| `PATCH /service/drafts/{id}` | `{expected_version,fields,association:{customer_id,address_id}|{create_new:true}}` | 更新后的草稿、缺项、候选与新版本；身份变化使旧关联待重核 |
| `POST /service/drafts/{id}/preview` | `{expected_version}` | `{draft_version,fields,sources,association,target_version,operation_id}`；仅预览 |
| `POST /service/drafts/{id}/confirm` | `{draft_version,target_version,operation_id,confirmed:true}` | `{record_id,revision,registered_at,actor_id}`；后端检查当前权限、版本、最低字段和人工确认，原操作重试仅一次效果 |
| `GET /service/records?q=...` | 手机号或地址关键词 | `{candidates:[{customer_id,address_id,name,phone,address,models}],scope}`；同号不同地址完整列出，无匹配仅说明归档范围 |
| `GET /service/records/{id}` | 记录编号 | `{id,customer,address,fields,date_precision,sources,revisions,version}`；来源与每次修订可追溯 |
| `POST /service/records/{id}/supplement-drafts` | `{target_version,result,source_ids}` | 待确认修订草稿；继续使用preview/confirm，不直接覆盖结果 |
| `POST /repair/queries` | `{exact_model,code,problem,conditions,manual_version_ids?}` | `{query_id,coverage,gaps,prerequisites,conditional_advice,citations:[{document_id,version,page,source_url}]}`；仅已发布且精确适用的资料；资料不足先列缺口 |
| `POST /repair/queries/{id}/feedback` | `{rating,note?}` | `{feedback_id}`；反馈不是实际维修结果，条件变化应产生新查询 |
| `GET /admin/accounts` | 当前负责人身份 | `{items:[{id,name,roles,enabled,version}]}`；每人独立账号，不返回密码 |
| `POST /admin/accounts` | `{name,roles,confirmed:true,operation_id}` | 新账号状态；初始化凭据需独立安全流程，当前UI不收集密码 |
| `PATCH /admin/accounts/{id}` | `{expected_version,name,roles,enabled,confirmed:true,operation_id}` | 变更后的账号；后端保护最后一位启用负责人，前端模拟不代表真实授权 |
| `POST /knowledge/documents` | `{source_id,name,exact_models,version,known_pages}` | `{id,status:'review',version}`；先材料解析/师傅核对，未审核不默认检索 |
| `POST /knowledge/documents/{id}/review` | `{expected_version,review_note,confirmed:true}` | `{id,status:'reviewed'}`；专业审核与发布分开 |
| `POST /knowledge/documents/{id}/publish` | `{expected_version,confirmed:true,operation_id}` | `{id,status:'published'}`；负责人确认 |
| `POST /knowledge/documents/{id}/disable` | `{expected_version,reason,confirmed:true,operation_id}` | `{id,status:'disabled'}`；停止默认命中，历史引用继续能打开原版本 |

## 页面与验证

`home`保留任务文字与本地照片，明确选择整理售后/查档案/查库存，不假冒自然语言路由。`service-draft?draft=`恢复草稿，`service-search`保留会话查询，`service-detail?customer=`显式选择地址，亦支持`?id=`档案编号。`repair-assistant?model=`使用准确型号。`settings`为四组同页分区，无额外管理路由。

设置中的库房/型号、客户、建账、更正、对账链接复用现有页面及mock适配器，不另建规则。手册演示只收元信息；初始页12/13展示虚构引用结构，新登记版本使用填写的数字页码（章节定位尚未实现）。生产接入须改为实际文档页和权限可控原件链接。

来源原文使用原生dialog，支持Escape关闭、焦点恢复；控件使用固定标签和44px目标。自动状态测试覆盖归档门槛、候选、多地址检索、版本冲突、重复确认、来源与修订、最后负责人保护、手册审核发布与适用范围；测试文件为`tests/web-service-pages.test.cjs`。浏览器视觉、实体设备和生产流程未由此测试覆盖，不能称为已验收。

本子模块实际执行：`node --check app/web/service-pages.js`通过；`node --test --test-isolation=none tests/web-service-pages.test.cjs`共14项通过（包含jsdom表单流程与dialog关闭焦点恢复）。原生Escape与焦点圈、弹层布局仍需真实浏览器核对；jsdom关闭事件不能替代键盘验证。


## 集成补充

当前UI按state.user.permissions核对service.read/draft/confirm、repair.query、account.manage、knowledge.review/publish。显示和最终事件均读取当前权限；无权不伪装成空数据。库存模拟器的负责人不自动兼专业审核，审核需切维修师傅；发布由负责人。账号编辑仅独立配置演示，不影响顶部角色身份。resetServiceMock回收照片Object URL并恢复虚构样例。待核对savedAt是保存时间，非业务日期；工作台聚合当前有权的售后与库存草稿。

集成后的实际验证和截图统一以[本轮核对记录](qa/frontend-mock/README.md)为准，前述14项为子模块当时记录，不代表最终全套计数。
