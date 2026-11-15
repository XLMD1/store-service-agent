# M2-02 售后草稿核对

## 2026-11-15 文字提取与照片 OCR

由「售后来源」打开已保存的原件。文字每行写一个字段，如「问题：不制热」。多条文字记录可用空行或单独一行的「第 1 条」「第 2 条」分隔。照片使用独立编号分条，适合标签清晰的中文印刷件。每份来源一次最多生成 20 条，重复点击返回已有草稿。原件可以一直对照，识别失败可继续手工新建。

照片使用 Windows PowerShell 和已安装的简体中文 OCR 语言包。图片留在本机，识别字段一律标记待核对。缺失的日期显示未知，识别到年月时保留月份精度。真实群聊、手写纸本、部署主机兼容性和 D-04 的留存规则待验证。[Windows OCR 接口说明](https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr.ocrengine?view=winrt-26100)

| 页面编号 | 本机核对结果 | 截图 |
| --- | --- | --- |
| source | 同一张虚构样例照片按编号生成两条草稿。无标签文字可直接手工新建 | [电脑照片分条](source-photo-extracted-1440.jpg) · [手机手工回退](source-extraction-fallback-390.jpg) |
| service-draft | 文字草稿保留模糊手机号。照片草稿可逐条打开核对，保留维修月份和待核对标记 | [电脑照片核对](service-draft-ocr-1440.jpg) |

以 `M1_TEST_CONFIG=.local/test.json` 运行 `python -m pytest -q tests/integration/test_service_extraction.py tests/integration/test_service_records.py tests/integration/test_service_archive.py tests/integration/test_sources.py tests/integration/test_source_photos.py`，18 项通过，覆盖并发、重启、撤权、识别失败、来源保留及手工草稿保留。Edge 端到端 1 项通过（本机脚本 `.local/test_m202_extract_browser.py`），390px 手机和 1440px 电脑视口无横向溢出。前端 72 项、lint、类型检查和静态 mock 构建通过。

## 2026-11-12 手工草稿核对

2026-11-12 使用回环 FastAPI、专用 PostgreSQL 和 Edge 浏览器视口验证。文字和纸本照片均为虚构样例。

| 页面编号 | 核对结果 | 截图 |
| --- | --- | --- |
| source | 从同一份照片来源新建两条独立草稿，返回后列表可重新打开各条 | [电脑 1440px](source-draft-list-1440.jpg) |
| service-draft | 对照原件编辑字段。刷新后保留模糊手机号、不确定标记及未知日期。照片样例可保留月份精度 | [手机 390px](service-draft-text-390.jpg) · [电脑 1440px](service-draft-photo-1440.jpg) |

手机端纵向排列原件和表单，电脑端并排显示。两种视口均无横向溢出。另一会话更新后，旧版本保存返回冲突并保留本窗口输入。点选载入最新版后显示服务器字段。独立账号打开他人的草稿链接时无法读取。

真实浏览器 1 项通过。专用 PostgreSQL 草稿及来源接口回归 9 项通过。前端 71 项、lint、类型检查及静态 mock 构建通过。当时的核对范围为手工流程。
