/**
 * KaTeX 按需加载器。
 *
 * ## 为什么不用静态 `import katex from 'katex'`
 *
 * KaTeX 连同它的 CSS 约 280 KB。静态导入会被塞进首屏 bundle 并
 * 出现在 `index.html` 的 `modulepreload` 里——也就是说，**即使文档里
 * 一个公式都没有**，应用启动时也要下载并解析这 280 KB。
 *
 * 这里的实现把 KaTeX 改成**按需加载**：第一个公式出现时才
 * `import('katex')` 与 `import('katex/dist/katex.min.css')`，
 * 启动路径因此不再包含 KaTeX。
 *
 * 顺带修掉一个真实缺陷：上游扩展要求使用者自行引入 KaTeX 的
 * CSS，而本项目**从未引入**——公式因此以未排版的裸 HTML 呈现。
 * 现在 CSS 与 JS 一起按需加载，样式一定到位。
 */

type KatexModule = typeof import('katex')

let katexPromise: Promise<KatexModule> | null = null

/**
 * 按需加载 KaTeX（JS + CSS）。
 *
 * 同一个 promise 被所有公式节点共享——文档里有十个公式也只加载一次。
 */
export function loadKatex(): Promise<KatexModule> {
  if (katexPromise) return katexPromise

  katexPromise = (async () => {
    // CSS 与 JS 一起加载：KaTeX 的排版完全依赖那张样式表，
    // 缺了它公式会显示成一堆未排版的标记。
    await import('katex/dist/katex.min.css')
    const mod = await import('katex')
    return (mod.default ?? mod) as KatexModule
  })().catch((err) => {
    console.error('[math] failed to load KaTeX:', err)
    // 置空以便下次重试——一次网络抖动不该让整个会话的公式永久失效。
    katexPromise = null
    throw err
  })

  return katexPromise
}

/**
 * 把 LaTeX 渲染进容器。
 *
 * KaTeX 是异步加载的，因此先写入原始 LaTeX 文本作为占位，
 * 加载完成后再替换为排版结果。视图销毁后不再写 DOM。
 *
 * @param wrapper  渲染目标（公式节点的内层容器）
 * @param latex    LaTeX 源码
 * @param options  KaTeX 选项
 * @param errorClass 渲染失败时加到**外层**节点上的 class
 * @param outer    外层节点（承载错误样式）
 * @param isAlive  视图是否仍然存活
 */
export function renderMathInto(
  wrapper: HTMLElement,
  outer: HTMLElement,
  latex: string,
  options: unknown,
  errorClass: string,
  isAlive: () => boolean,
): void {
  // 占位：加载期间的可见内容，避免公式区域出现空白。
  wrapper.textContent = latex

  void loadKatex()
    .then((katex) => {
      if (!isAlive()) return
      try {
        katex.render(latex, wrapper, options as never)
        outer.classList.remove(errorClass)
      } catch (err) {
        console.error('[math] KaTeX render failed:', err)
        wrapper.textContent = latex
        outer.classList.add(errorClass)
      }
    })
    .catch(() => {
      if (!isAlive()) return
      wrapper.textContent = latex
      outer.classList.add(errorClass)
    })
}
