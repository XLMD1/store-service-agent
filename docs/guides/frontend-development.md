# 前端开发与静态演示

本轮保留原生 JavaScript 与 FastAPI 生产入口。Node 工具链只检查前端并构建独立 mock 演示；演示操作不会成为正式业务记录。

当前工具命令以本机 Node.js 26.2 验证，声明使用 Node.js 26 或以上版本。在仓库根目录执行：

```powershell
npm ci
npm run lint
npm run typecheck
npm run test:frontend
npm run build
npm run dev
```

浏览器打开 `http://127.0.0.1:8765/mock.html`（亦支持 `/web/mock.html`）。开发服务器固定绑定本机 127.0.0.1:8765，只映射 `app/web` 静态文件，不暴露仓库、`.local`、后端接口或本机配置。它不提供 FastAPI 正式业务能力。

ESLint 9 检查 `app/web/**/*.js` 和新增工具脚本，包括语法、未定义引用、重复定义、不可达代码等；历史 `prototypes` 不纳入检查。页面采用按顺序加载的经典脚本，因此共享全局名称在配置中显式列出。历史未使用变量暂列警告，新代码应处理自己的警告。

TypeScript 5.9 以 `strict`、`noEmit` 检查 `app/web/contracts.ts` 的接口声明。此项不表示存量 JavaScript 页面或 mock 运行时已全面严格类型化；mock 运行时由测试验证，也不替代运行时接口校验和交互测试。

`test:frontend` 运行 `tests/web-*.test.cjs` 的 Node 测试；为适配禁止子进程的沙箱，使用 `--test-isolation=none`。DOM 交互测试使用 jsdom。浏览器视觉、键盘及真实布局仍需独立核对。

`build` 先核对脚本、样式与素材引用存在，再生成 `dist/index.html`、`dist/web` 和含文件大小/SHA256的 `dist/build-manifest.json`。入口来自 `app/web/mock.html`；资源引用转换为相对路径，可将整个 `dist` 目录部署到静态站点的某个路径下。构建不会运行后端、访问数据库或修改生产 `app/web/index.html`。`dist/web` 保留原网页文件，部署入口应使用 `dist/index.html`。

可用以下命令单独预览构建产物（与开发服务器使用同一端口，先停止已有服务）：

```powershell
npm run dev -- --dist
```

新增接口或全局入口后，同步契约及 ESLint 共享名称；不要通过关闭全部规则掩盖错误。上述命令的实际通过结果以当次执行记录为准。
