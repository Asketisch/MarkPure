/**
 * 数学公式扩展的对外入口。
 *
 * 实现拆在 `./math/` 目录里（vendor 自 @tiptap/extension-mathematics 3.22，
 * 上游 MIT）：`block-math.ts` / `inline-math.ts` / `index.ts`。
 *
 * 相对上游做了两处修改：
 * - KaTeX **按需加载**（见 `./math/katex-loader.ts`）——静态导入会把
 *   约 280 KB 的 KaTeX 塞进首屏 bundle，即使文档里一个公式都没有；
 * - 输入规则去掉 lookbehind 正则——`(?<!\$)` 在 macOS 12 的 WKWebView
 *   脚本解析期即抛 SyntaxError，令整个应用白屏。
 */
export { MathExtension } from './math'
