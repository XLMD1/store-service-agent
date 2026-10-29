# 门店助手 · C 方向核心页面交互样板

沿用已选 C 方向及原 `ui-sample` 的 tokens、组件、SVG 与纹理；原样板与截图保留。所有客户、型号、数量、手册和时间均为虚构示例。

## 启动

在项目根目录运行：

```powershell
python -m http.server 8765 --bind 127.0.0.1
```

访问 [核心前端样板](http://127.0.0.1:8765/prototypes/frontend/)。无构建步骤或第三方前端依赖。请通过 HTTP 使用，SVG 引用指向原素材库，不保证 `file://` 跨文件加载。

## 页面入口

所有页面均为独立完整视图，可用地址直接打开，浏览器前进/后退保留当前会话内的筛选。

| 编号 | 路径 | 范围 |
| --- | --- | --- |
| home | `index.html#home` | 任务输入、图片本地预览、快捷入口、待核对与最近任务 |
| pending | `index.html#pending` | 全部/售后/库存筛选与继续核对 |
| service-draft | `index.html#service-draft` | 来源对照、人工关联、未知字段、归档预览与模拟回执 |
| service-search | `index.html#service-search` | 多地址候选与无匹配，样例查询 `138****0001` |
| service-detail | `index.html#service-detail?customer=1` | 两个地址各自的历史、来源、结果补充与会话内修订 |
| repair-assistant | `index.html#repair-assistant` | 精确机型、引用、资料不足、条件失效及补充输入 |
| inventory | `index.html#inventory` | 库房/型号筛选、已建账合计、未建账、流水与预留阅读层 |
| reserved-pickup | `index.html#reserved-pickup` | 正整数和日期校验、影响预览、模拟提货、冲突/无权限/待核验 |
| inbound-statistics | `index.html#inbound-statistics` | 日期筛选、三种分组、有效入库原单、更正及覆盖范围 |

“资料与设置”仅说明范围并链接设计资源；登录、建账、入出库、留货与取消、权限管理等页面不在本轮完整实现范围。

## 演示与限制

- 归档、结果补充和提货必须点击明确确认；结果全部标注“模拟”，不会发送请求或写入正式台账。
- 所有状态仅存在本次页面会话；刷新会恢复初始样例，不使用 localStorage 保存客户输入。
- 任务输入会保留到草稿来源，不调用 AI/OCR，不把样例字段当作识别结果。照片仅作为本地预览。
- 维修手册为虚构示例，不包含真实维修步骤。原概念图没有单独的纸本原件图片，因此用注明来源的示例原文展示，未将整页截图当作原件。
- 库存余额与进货统计沿用不同概念图的独立验收场景，不是完整连续台账；流水阅读层明确说明。正式对账、权限、确认版本、事务和幂等须由后端实现。
- 提货页展开“切换示例状态”可评审冲突、待核验、无权限。待核验在本会话保留，返回后不能再次提交。
- 期初与调整不计进货；更正后的原单只计有效量。未建账及建账前/样例截至时间后的未覆盖历史不显示为零。

## 源码与验证

`frontend.css` 负责响应式布局；`shared.js` 提供样例及通用片段；`workbench.js`、`service.js`、`inventory.js` 按页面组组织；`app.js` 管理导航与交互；`rules.js` 仅用于样例校验和预览。

```powershell
node prototypes/frontend/rules.test.cjs
Get-ChildItem prototypes/frontend/*.js | ForEach-Object { node --check $_.FullName }
```

浏览器核对与截图见 [核对记录](../../docs/design/qa/frontend-c/README.md)，资源目录见 [AI版](../../docs/design/design-resources.md) / [HTML版](../../docs/design/design-resources.html)。
