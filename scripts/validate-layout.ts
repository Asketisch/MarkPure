/**
 * 显示层**布局**回归测试。
 *
 * ## 为什么需要它
 *
 * 2026-10 那次组件拆分（`1568ffc`）把 `App.svelte` 拆成
 * `AppPanels` / `AppEditorViews` 等子组件时，丢掉了包裹编辑器
 * 视图的 `.editor-panel` **列容器**。`.main-area` 是 flex row，
 * 于是标签栏 / 工具栏 / 编辑区 / 状态栏各自成了它的并列 flex item
 * 并排显示——编辑器被挤成一条缝，状态栏跑到右上角。
 *
 * 这个 bug 此前没被任何测试抓到，因为：
 * - 后端 IPC 测试不涉及显示层；
 * - `scripts/validate-*.ts` 测的是纯函数；
 * - 浏览器手测用的是 714px 的窄视口，恰好没露出问题。
 *
 * ## 这个脚本做什么
 *
 * 它用无头 Chrome（CDP）打开**生产构建**，在多个视口宽度下断言
 * DOM 结构与几何：
 *
 * - `.main-area` 的直接子元素里有 `.editor-panel`，且它是 `column`；
 * - 标签栏 / 工具栏 / 编辑区 / 状态栏的**父元素**都是 `.editor-panel`
 *   （即它们是竖直堆叠的，不是并排的 flex item）；
 * - 编辑区宽度 ≥ 视口宽度的 40%（没被挤成一条缝）；
 * - 标签栏在顶部、工具栏在标签栏下方、状态栏在底部；
 * - 打开大纲面板后，它位于编辑器的**右侧**；
 * - 禅模式：chrome 全部不可见，编辑区宽度 = 820px 阅读宽度且居中；
 * - 分屏视图：两个面板都在，且宽度都 ≥ 容器的 20%；
 * - 富内容（宽表格 / 代码块 / 图片 / 任务列表 / 公式）：每种块真的
 *   渲染出来了，且**没有把布局撑破**。
 *
 * 这些断言正是上面那个 bug 会全部违反的。
 *
 * 设施（生产构建 → preview 服务 → 无头 Chrome）见
 * `scripts/lib/browser-harness.ts`。没有 Chrome 时脚本**跳过**
 * （退出码 0）并打印说明——布局断言需要真实排版引擎。
 *
 * 运行：npx tsx scripts/validate-layout.ts
 */
import {
  CdpClient,
  findChrome,
  harnessReady,
  openFileInTree,
  sleep,
  startHarness,
} from './lib/browser-harness'

let failures = 0
function ok(label: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`✔ ${label}`)
  } else {
    failures++
    console.error(`✘ ${label}${detail ? `\n   ${detail}` : ''}`)
  }
}
function eq(label: string, got: unknown, expected: unknown): void {
  ok(label, JSON.stringify(got) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`)
}

const chromePath = findChrome()
if (!chromePath) {
  console.log('— validate-layout —')
  console.log('\n⏭  跳过：找不到 Chrome / Chromium。')
  console.log('   布局断言需要真实排版引擎。安装 Chrome 后重跑，或用')
  console.log('   MARKPURE_CHROME=/path/to/chrome 指定路径。')
  process.exit(0)
}
if (!harnessReady()) {
  console.error('✘ 找不到 mt_harness 二进制，请先执行：cargo build --bin mt_harness')
  process.exit(1)
}

// ---- 测试样本 ------------------------------------------------------------

// 「富内容」样本：宽表格 / 代码块 / 图片 / 任务列表 / 数学公式。
//
// 这些块各有自己的渲染路径（TableView、CodeMirror 6、figure NodeView、
// TaskItem、KaTeX），也各有自己的宽度行为——宽表格尤其容易把整个
// 布局撑破。这一组断言既检查「内容真的渲染出来了」，也检查
// 「渲染出来之后布局没有被撑坏」。
const WIDE_HEADERS = Array.from({ length: 18 }, (_, i) => `第${i + 1}列`).join(' | ')
const WIDE_ROW = Array.from({ length: 18 }, (_, i) => `单元格${i + 1}`).join(' | ')

const FILES = {
  'sample.md': '# Layout Probe\n\n段落内容 body text.\n\n| 列 A | 列 B |\n| --- | --- |\n| 1 | 2 |\n',
  'rich.md': [
    '# 富内容',
    '',
    '段落文本。',
    '',
    `| ${WIDE_HEADERS} |`,
    `| ${WIDE_ROW.split(' | ').map(() => '---').join(' | ')} |`,
    `| ${WIDE_ROW} |`,
    '',
    '```js',
    'const wide = "x".repeat(200)',
    '```',
    '',
    '![占位图](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7)',
    '',
    '- [ ] 待办事项',
    '- [x] 已完成',
    '',
    '行内公式 $E = mc^2$ 与块级公式：',
    '',
    '$$',
    '\\int_0^1 x^2 dx = \\frac{1}{3}',
    '$$',
    '',
  ].join('\n'),
}

console.log('— validate-layout —')
console.log('  正在构建生产产物 ...')
const harness = await startHarness({ files: FILES })
const cdp = await CdpClient.launch(
  chromePath,
  `${harness.workspaceDir}/chrome-profile`,
  4500 + Math.floor(Math.random() * 300),
)

try {
  // ---- 采集布局快照 -------------------------------------------------------

  /** 打开文件并返回布局快照。 */
  async function probe(width: number, height: number, openOutline: boolean) {
    await cdp.setViewport(width, height)
    await cdp.navigate(harness.url)
    await sleep(3500)

    const opened = await openFileInTree(cdp, 'sample.md')
    ok(`${width}×${height}: 能在文件树里打开文档`, opened, '文件树点不到 / 编辑器没渲染')

    if (openOutline) {
      await cdp.evaluate(`(() => {
        const btns = [...document.querySelectorAll('.toolbar button')]
        const hit = btns.find(b => (b.title||'').toLowerCase().includes('outline') || (b.title||'').includes('大纲'))
        if (hit) hit.click()
        return !!hit
      })()`)
      await sleep(1200)
    }

    const snap = await cdp.evaluate(`(() => {
      const main = document.querySelector('.main-area')
      const panel = document.querySelector('.editor-panel')
      const rect = (sel) => {
        const el = document.querySelector(sel)
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
                 bottom: Math.round(r.bottom), top: Math.round(r.top), right: Math.round(r.right) }
      }
      const parentCls = (sel) => {
        const el = document.querySelector(sel)
        return el && el.parentElement ? String(el.parentElement.className || '') : null
      }
      return {
        viewport: { w: innerWidth, h: innerHeight },
        mainChildren: main ? [...main.children].map(c => String(c.className || '')) : [],
        panelFlexDir: panel ? getComputedStyle(panel).flexDirection : null,
        panelDisplay: panel ? getComputedStyle(panel).display : null,
        panelRect: rect('.editor-panel'),
        tabBar: rect('.tab-bar'), tabBarParent: parentCls('.tab-bar'),
        toolbar: rect('.toolbar'), toolbarParent: parentCls('.toolbar'),
        editorArea: rect('.editor-area'), editorAreaParent: parentCls('.editor-area'),
        statusBar: rect('.status-bar'), statusBarParent: parentCls('.status-bar'),
        proseMirror: rect('.ProseMirror'),
        outline: rect('.outline-panel'),
      }
    })()`)
    return { ...snap, opened }
  }

  // ---- 结构与几何 ---------------------------------------------------------

  for (const [width, height] of [[1280, 900], [1900, 1180], [2560, 1400]] as const) {
    const tag = `${width}×${height}`
    const d = await probe(width, height, false)

    ok(
      `${tag}: .main-area 的子元素里有 .editor-panel`,
      d.mainChildren.some((c: string) => c.includes('editor-panel')),
      `main-area 子元素: ${JSON.stringify(d.mainChildren)}`,
    )
    eq(`${tag}: .editor-panel 是列容器`, d.panelFlexDir, 'column')
    eq(`${tag}: .editor-panel 是 flex 容器`, d.panelDisplay, 'flex')

    eq(`${tag}: 标签栏的父元素是 .editor-panel`, String(d.tabBarParent ?? '').includes('editor-panel'), true)
    eq(`${tag}: 工具栏的父元素是 .editor-panel`, String(d.toolbarParent ?? '').includes('editor-panel'), true)
    eq(`${tag}: 编辑区的父元素是 .editor-panel`, String(d.editorAreaParent ?? '').includes('editor-panel'), true)
    eq(`${tag}: 状态栏的父元素是 .editor-panel`, String(d.statusBarParent ?? '').includes('editor-panel'), true)

    // 编辑区不能被挤成一条缝
    ok(
      `${tag}: 编辑区宽度 ≥ 视口的 40%`,
      d.editorArea && d.editorArea.w >= width * 0.4,
      `editor-area 宽 ${d.editorArea ? d.editorArea.w + 'px' : '(不存在)'} / 视口 ${width}px`,
    )
    ok(
      `${tag}: 正文宽度 ≥ 视口的 30%`,
      d.proseMirror && d.proseMirror.w >= width * 0.3,
      `ProseMirror 宽 ${d.proseMirror ? d.proseMirror.w + 'px' : '(不存在)'}`,
    )

    // 竖直堆叠顺序：标签栏 → 工具栏 → 编辑区 → 状态栏
    ok(
      `${tag}: 标签栏在工具栏上方`,
      d.tabBar && d.toolbar && d.tabBar.bottom <= d.toolbar.top + 1,
      `tab-bar bottom=${d.tabBar?.bottom} toolbar top=${d.toolbar?.top}`,
    )
    ok(
      `${tag}: 工具栏在编辑区上方`,
      d.toolbar && d.editorArea && d.toolbar.bottom <= d.editorArea.top + 1,
      `toolbar bottom=${d.toolbar?.bottom} editor-area top=${d.editorArea?.top}`,
    )
    ok(
      `${tag}: 状态栏贴在编辑器面板底部`,
      d.statusBar && d.panelRect && Math.abs(d.statusBar.bottom - d.panelRect.bottom) <= 2,
      `status-bar bottom=${d.statusBar?.bottom} panel bottom=${d.panelRect?.bottom}`,
    )
  }

  // ---- 大纲面板 -----------------------------------------------------------

  {
    const d = await probe(1900, 1180, true)
    ok('大纲面板已打开', !!d.outline, '未找到 .outline-panel')
    if (d.outline && d.panelRect) {
      ok(
        '大纲面板位于编辑器右侧',
        d.outline.x >= d.panelRect.right - 1,
        `outline x=${d.outline.x} panel right=${d.panelRect.right}`,
      )
      ok(
        '大纲面板宽度合理（≥ 200px）',
        d.outline.w >= 200,
        `outline 宽 ${d.outline.w}px`,
      )
    }
  }

  // ---- 禅模式 -------------------------------------------------------------
  //
  // 禅模式的 CSS 依赖 `.editor-panel`——它曾经丢失过，所以单独覆盖。
  {
    await cdp.setViewport(1900, 1180)
    await cdp.navigate(harness.url)
    await sleep(3500)
    await openFileInTree(cdp, 'sample.md')
    await sleep(500)

    // 「视图」菜单 → 「切换专注模式」。菜单文案随语言变化，两种都匹配。
    //
    // 关键：菜单项是 `{#if showViewMenu}` 条件渲染的，Svelte 5 的 DOM
    // 更新是异步的——点完菜单按钮后必须**另起一轮** evaluate 去查
    // dropdown 项，否则查到的还是空列表。
    const viewMenuOpened = await cdp.evaluate(`(() => {
      const viewBtn = [...document.querySelectorAll('.menu-btn')]
        .find(b => /^(视图|View)$/.test((b.textContent||'').trim()))
      if (!viewBtn) return false
      viewBtn.click()
      return true
    })()`)
    ok('「视图」菜单可打开', !!viewMenuOpened)
    await sleep(500)

    const zenClicked = await cdp.evaluate(`(() => {
      const zen = [...document.querySelectorAll('.dropdown-item')]
        .find(b => /专注模式|Zen Mode/i.test(b.textContent||''))
      if (!zen) return 'no-zen-item'
      zen.click()
      return 'clicked'
    })()`)
    ok('禅模式可切换', zenClicked === 'clicked', String(zenClicked))
    await sleep(1200)

    const z = await cdp.evaluate(`(() => {
      const vis = (sel) => {
        const el = document.querySelector(sel)
        if (!el) return null
        const cs = getComputedStyle(el)
        const r = el.getBoundingClientRect()
        return { display: cs.display, w: Math.round(r.width), h: Math.round(r.height),
                 x: Math.round(r.x) }
      }
      return {
        zen: !!document.querySelector('.app-root.zen-mode'),
        viewportW: innerWidth,
        tabBar: vis('.tab-bar'), toolbar: vis('.toolbar'),
        statusBar: vis('.status-bar'), editorArea: vis('.editor-area'),
      }
    })()`)
    ok('禅模式下 .app-root 带 zen-mode', z.zen)
    // 禅模式下这些元素是**不渲染**的（`{#if !app.zenMode}`），而不是
    // 被 CSS 隐藏——两种情况都算「看不到」。
    const gone = (v: { display: string } | null) => v === null || v.display === 'none'
    ok('禅模式看不到标签栏', gone(z.tabBar), `display=${z.tabBar?.display}`)
    ok('禅模式看不到工具栏', gone(z.toolbar), `display=${z.toolbar?.display}`)
    ok('禅模式看不到状态栏', gone(z.statusBar), `display=${z.statusBar?.display}`)
    // 阅读宽度上限 820px，且水平居中。
    ok(
      '禅模式编辑区宽度 = 820px（阅读宽度上限）',
      z.editorArea && z.editorArea.w === 820,
      `editor-area 宽 ${z.editorArea?.w}px`,
    )
    ok(
      '禅模式编辑区水平居中',
      z.editorArea &&
        Math.abs(z.editorArea.x + z.editorArea.w / 2 - z.viewportW / 2) <= 2,
      `editor-area x=${z.editorArea?.x} w=${z.editorArea?.w} 视口 ${z.viewportW}`,
    )
  }

  // ---- 分屏视图 -----------------------------------------------------------
  {
    await cdp.setViewport(1900, 1180)
    await cdp.navigate(harness.url)
    await sleep(3500)
    await openFileInTree(cdp, 'sample.md')
    await sleep(500)

    // 工具栏的「切换视图模式」按钮。循环顺序是
    // wysiwyg → split → source → wysiwyg，所以**点一次**就是分屏。
    const cycled = await cdp.evaluate(`(() => {
      const btn = [...document.querySelectorAll('.toolbar button')]
        .find(b => /切换视图模式|Cycle View Mode/i.test(b.title||''))
      if (!btn) return false
      btn.click()
      return true
    })()`)
    ok('视图模式可循环切换', !!cycled, '找不到「切换视图模式」按钮')
    await sleep(1500)

    const sp = await cdp.evaluate(`(() => {
      const cont = document.querySelector('.split-container')
      if (!cont) return { hasSplit: false }
      const r = cont.getBoundingClientRect()
      const panes = [...document.querySelectorAll('.split-pane')].map(p => {
        const pr = p.getBoundingClientRect()
        return { w: Math.round(pr.width), h: Math.round(pr.height) }
      })
      return { hasSplit: true, w: Math.round(r.width), panes }
    })()`)
    ok('分屏视图已激活', sp.hasSplit, '未找到 .split-container')
    if (sp.hasSplit) {
      ok('分屏有两个面板', sp.panes?.length === 2, JSON.stringify(sp.panes))
      ok(
        '分屏两栏宽度都 ≥ 容器的 20%',
        (sp.panes ?? []).every((p: { w: number }) => p.w >= sp.w * 0.2),
        `容器 ${sp.w}px / 面板 ${JSON.stringify(sp.panes)}`,
      )
    }
  }

  // ---- 富内容 -------------------------------------------------------------
  //
  // 两条主线：
  // 1. 每种块**真的渲染出来了**（早前的 bug 里围栏代码块整个消失、
  //    表格不认 markdown 钩子，都是这类问题）；
  // 2. 渲染之后**布局没有被撑破**——编辑区宽度仍等于编辑器面板宽度，
  //    页面没有出现横向滚动条（宽表格只应在编辑区内部滚动）。
  {
    await cdp.setViewport(1900, 1180)
    await cdp.navigate(harness.url)
    await sleep(3500)
    await openFileInTree(cdp, 'rich.md')
    await sleep(1500)

    const rc = await cdp.evaluate(`(() => {
      const rect = (sel) => {
        const el = document.querySelector(sel)
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { x: Math.round(r.x), w: Math.round(r.width),
                 right: Math.round(r.right), scrollW: el.scrollWidth,
                 clientW: el.clientWidth }
      }
      return {
        viewportW: innerWidth,
        pageScrollW: document.documentElement.scrollWidth,
        bodyScrollW: document.body.scrollWidth,
        panel: rect('.editor-panel'),
        editorArea: rect('.editor-area'),
        hasTable: !!document.querySelector('.tableWrapper'),
        tableRows: document.querySelectorAll('.tableWrapper tr').length,
        hasCodeBlock: !!document.querySelector('.mw-code-block'),
        hasFigure: !!document.querySelector('figure.image-figure'),
        hasTaskItem: !!document.querySelector('ul[data-type="taskList"] > li[data-checked]'),
        taskItemCount: document.querySelectorAll('ul[data-type="taskList"] > li[data-checked]').length,
        hasMath: !!document.querySelector('.tiptap-mathematics-render'),
      }
    })()`)

    ok('富内容文档已打开', !!rc.editorArea, '编辑区不存在')
    ok('表格渲染出来了（.tableWrapper）', rc.hasTable)
    ok('表格有内容行', rc.tableRows >= 2, `行数 ${rc.tableRows}`)
    ok('围栏代码块渲染出来了（.mw-code-block）', rc.hasCodeBlock)
    ok('图片渲染出来了（figure.image-figure）', rc.hasFigure)
    ok('任务列表渲染出来了（taskList > li[data-checked]）', rc.hasTaskItem)
    ok('任务列表有两项', rc.taskItemCount === 2, `实际 ${rc.taskItemCount} 项`)
    ok('数学公式渲染出来了', rc.hasMath)

    ok(
      '富内容没有把编辑区撑宽',
      rc.editorArea && rc.panel && rc.editorArea.w === rc.panel.w,
      `editor-area ${rc.editorArea?.w}px vs panel ${rc.panel?.w}px`,
    )
    ok(
      '编辑器面板没有超出视口',
      rc.panel && rc.panel.right <= rc.viewportW + 1,
      `panel right=${rc.panel?.right} 视口 ${rc.viewportW}`,
    )
    ok(
      '页面没有出现横向滚动条',
      rc.pageScrollW <= rc.viewportW + 1 && rc.bodyScrollW <= rc.viewportW + 1,
      `documentElement.scrollWidth=${rc.pageScrollW} body.scrollWidth=${rc.bodyScrollW} 视口 ${rc.viewportW}`,
    )
  }
} catch (e) {
  failures++
  console.error(`✘ 布局测试异常终止: ${String(e)}`)
} finally {
  await cdp.close()
  harness.stop()
}

console.log(failures ? `\nFAILED (${failures})` : '\nOK')
process.exitCode = failures ? 1 : 0
