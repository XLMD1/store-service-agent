# C 方向手机页面 · 复现提示词

执行方式：内置 ImageGen；每页独立生成并附实际 C 首页参考图。未使用 CLI/API 回退。

以下通用段及分页面段按最终画面与已保留的设计要求整理，可用于后续复现；不是首次调用的逐字日志。原始临时提示词存储在会话恢复后不可用，不将其冒充为原始记录。第 1 页局部修正提示词为本次实际调用原文。

参考图：[首页视觉方向，使用最右侧 C](assets/homepage-visual-directions-v1.png)。独立生成时将通用段和对应页面段连接，并附该参考图。

## 通用段

```text
Use case: ui-mockup. Create realistic production-quality Chinese mobile app UI for a boiler store's internal after-sales and inventory assistant. One screenshot per page, logical viewport 390×844, preserve natural portrait ratio, no device bezel, OS chrome, watermark, or multiple concepts. Attach docs/design/assets/homepage-visual-directions-v1.png as style reference and use ONLY the RIGHTMOST C direction. Deep ink-teal header #17313B, primary/active teal #0F766E, white business surfaces #FFFFFF, pale background #F7F9F8, secondary text #52646F, amber #92400E for pending checks. Readable Chinese sans-serif typography, clear hierarchy, restrained dividers and corners, purposeful spacing. Use only the specified contents, no marketing or unrelated KPIs. One clear primary action. All business data explicitly marked 示例数据. Sample date anchor 2026-10-26, retained from the original concept set, not live data. Root pages use bottom 工作台/待核对/售后/库存. Secondary task pages use back navigation and relevant action footer, no root bottom navigation. No clipped contents; do not stretch the UI.
```

## 售后草稿核对

输出：[01-service-draft.png](assets/mobile-c/01-service-draft.png)

```text
售后核对，草稿1/2，示例数据。顶部来源为纸本照片第3页、查看原件。照片手写内容包含示例客户甲、138 0000 000?、示例小区1号楼101、设备无法正常启动、示例型号A、日期未记。警示手机号有一处不清，请核对。字段包括客户关联及更换、姓名/称呼、手机号138****000?与待核对/标为未知、服务地址、问题描述、设备型号、维修日期未提供。折叠处理方法、配件与结果。底部草稿尚未归档，稍后核对，禁用确认归档，提示请先核对标记字段。无底部一级导航。
```

来源生成文件：`exec-f45b6916-c83d-462c-b39a-64833d87cea3.png`。

## 售后检索与候选选择

输出：[02-service-search.png](assets/mobile-c/02-service-search.png)

```text
售后档案，搜索138****0001。找到2个服务地址。两个候选同为示例客户甲及同一手机号，地址分别示例小区1号楼101、示例小区2号楼202，最近日期分别2026-10-24、2026-10-18。每项有查看该地址档案。候选均未选中，提供修改查询条件，说明仅查询已归档记录。底部工作台/待核对/售后/库存，售后选中。
```

来源生成文件：`exec-52e3aea4-ec59-4d5f-8cf9-c90c35562ad3.png`。

## 售后档案详情

输出：[03-service-detail.png](assets/mobile-c/03-service-detail.png)

```text
售后档案详情，顶部返回、示例客户甲、138****0001、示例小区1号楼101。时间线展开2026-10-24的设备无法正常启动。问题同前，报错码未提供，处理方法已完成现场检查，配件未记录，最终结果待师傅补充。来源纸本第3页，查看对应原件、查看修订记录。另一个折叠历史条目日期未知。底部查维修依据、补充处理结果。无底部一级导航。
```

来源生成文件：`exec-6dc1a39d-4787-4c3c-927a-ae870b314143.png`。

## 维修辅助

输出：[04-repair-assistant.png](assets/mobile-c/04-repair-assistant.png)

```text
维修辅助，返回。顶部查询条件示例型号A、报错码未提供、设备无法正常启动，修改条件。依据为虚构的示例手册v1，适用示例型号A。故障说明：当前现象需结合现场检查进一步判断[1]；检查前提：先确认具体机型及现场条件[1]；修理建议：若检查结果符合手册条件，再参考对应处理步骤[2]。琥珀提示待补充：现场检查结果。引用示例手册第12页、第13页，各有查看原文。反馈有用/不适用，底部追问输入与发送。标记演示内容，非实际维修指引。不要生成真实机型、真实故障码或未经依据的具体维修步骤。无底部一级导航。
```

来源生成文件：`exec-bc3501e5-03cf-4950-9010-af4b1a03a5a7.png`。

## 库存总览

输出：[05-inventory.png](assets/mobile-c/05-inventory.png)

```text
库存，示例数据，登记变动。筛选全部库房、示例型号A。2号库在库10、预留3、可售7；3号库在库6、预留2、可售4。每库查看流水、预留明细。当前筛选合计在库16、预留5、可售11。进货统计入口。查询截至2026-10-26 10:30，最近登记今天10:20，数量以已登记记录为准。底部工作台/待核对/售后/库存，库存选中。
```

来源生成文件：`exec-cfd740d2-0fe9-4274-9d47-5af1d725de26.png`。

## 预留提货确认

输出：[06-reserved-pickup.png](assets/mobile-c/06-reserved-pickup.png)

```text
预留提货确认，返回，示例数据。客户示例客户甲·138****0001；预留单YL-001；2号库·示例型号A；剩余预留3。本次提货数量2，发生日期2026-10-26，备注客户本次提走2台。预计影响，尚未登记：在库10→8、预留3→1、可售7→7。说明提货同时减少在库和对应预留，不重复扣减可售。底部取消本次操作、确认提货。必须表现为提交前预览，不能显示成功回执。无底部一级导航。
```

来源生成文件：`exec-9022c26b-3061-4127-aa9c-ea07ad855388.png`。

## 进货统计

输出：[07-inbound-statistics.png](assets/mobile-c/07-inbound-statistics.png)

```text
进货统计，返回，示例数据。日期范围2026-10-01至2026-10-26，全部库房、示例型号A，查询。已登记进货合计18台；当前示例库房建账起点2026-10-01 00:00；查询截至2026-10-26 10:30。分组按日期选中，另有按库房、按型号。表头发生日期/有效进货量；2026-10-24 5台、2026-10-20 8台、2026-10-12 5台，合计18台。查看对应入库单。说明仅统计建账后的已登记入库，期初和盘点调整不计入进货。不要金额、利润、库存余额或额外图表。无底部一级导航。
```

来源生成文件：`exec-01eba06a-8c3f-446f-834a-f2fc0c583b38.png`。

## 第 1 页局部修正（实际调用原文）

编辑目标为初版售后核对图 `exec-403f21c8-58c2-479c-a738-85b7072f5887.png`；修正后使用 `exec-f45b6916-c83d-462c-b39a-64833d87cea3.png`。

```text
Use case: text-localization. Edit target: the attached Chinese mobile UI concept image 售后核对. Make exactly ONE local correction: in the paper photo near the top, replace handwritten date '2026.10.21' with the handwritten Chinese text '日期未记'. This makes the source consistent with the form field '维修日期 未提供'. Preserve every other element and all other text exactly: deep ink-teal header, white panels, fields, masked phone, warning, disabled confirm button, spacing, proportions, icons, image dimensions. Do not redesign, add elements, change layout, or add device/OS chrome. Output one full mobile screenshot at the same aspect ratio and resolution as the attached target. The date used by the original example remains 2026-10-26; this is an archival concept image, do not refresh other sample content.
```
