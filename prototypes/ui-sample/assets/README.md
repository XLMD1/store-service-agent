# 通用 UI 素材

- `icons.svg`：本项目自绘 SVG symbol 集合，24×24 画布，1.8px 描边，`currentColor` 配色。样板 HTML 同时内联同一套 symbol，直接打开文件也能显示。其他页面经 HTTP 访问时可使用 `<svg class="icon"><use href="assets/icons.svg#box"></use></svg>`。无需外部 CDN。
- `ink-grain.png`：内置 ImageGen 生成的细颗粒深墨青背景，非截图切片。用于顶部任务区，CSS 类 `.material-ink`；默认以 628px 重复铺设。生成纹理不是数学意义上保证无缝，当前以实际显示效果评审。
- 白色表面效果由 `.material-paper` 提供，颜色、边界和阴影统一使用 CSS token。

## 纹理生成提示词（实际调用）

```text
Use case: productivity-visual. Asset type: reusable seamless background texture tile for a restrained Chinese business mobile app. Create a single square 1024 by 1024 raster swatch, edge-to-edge, entirely uniform deep ink teal base close to #17313B with extremely fine low-contrast matte paper grain, almost imperceptible at normal size. Flat even lighting, no directional light, no gradient, no vignette, no folds, no fibers larger than 1 pixel, no shapes, no objects, no text, no border. Seamlessly repeatable in both axes, opposite edges visually matching. This is a subtle utility background material, no mockup. Opaque background.
```

来源生成文件：`exec-f72f5eac-7a2e-4485-91da-4abcec6e2109.png`。图片已复制进本目录，使用时无需依赖 Codex 的生成缓存。
