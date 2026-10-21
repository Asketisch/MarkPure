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
 * 它用 Chrome DevTools Protocol 驱动**无头 Chrome**打开**生产构建**
 * （`vite preview` + `mt_harness` 的 IPC 桥），然后在多个视口宽度
 * 下断言 DOM 结构与几何：
 *
 * - `.main-area` 的直接子元素里有 `.editor-panel`，且它是 `column`；
 * - 标签栏 / 工具栏 / 编辑区 / 状态栏的**父元素**都是 `.editor-panel`
 *   （即它们是竖直堆叠的，不是并排的 flex item）；
 * - 编辑区宽度 ≥ 视口宽度的 40%（没被挤成一条缝）；
 * - 标签栏在顶部、工具栏在标签栏下方、状态栏在底部；
 * - 打开大纲面板后，它位于编辑器的**右侧**。
 *
 * 这些断言正是上面那个 bug 会全部违反的。
 *
 * ## 环境
 *
 * 需要一个 Chrome / Chromium。查找顺序：
 * `$MARKPURE_CHROME` → macOS 应用路径 → Linux 的 `google-chrome` /
 * `chromium` / `chromium-browser` → Windows 的 Chrome。
 * 找不到时脚本**跳过**（退出码 0）并打印说明——布局测试需要真实
 * 排版引擎，纯函数测试做不到这件事。
 *
 * 运行：npx tsx scripts/validate-layout.ts
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const HARNESS_BIN = join(REPO_ROOT, 'target', 'debug', 'mt_harness')

// ---- 断言 ---------------------------------------------------------------

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

// ---- 找 Chrome ----------------------------------------------------------

function findChrome(): string | null {
  const candidates = [
    process.env.MARKPURE_CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].filter((c): c is string => Boolean(c))
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return null
}

const chromePath = findChrome()
if (!chromePath) {
  console.log('— validate-layout —')
  console.log('\n⏭  跳过：找不到 Chrome / Chromium。')
  console.log('   布局断言需要真实排版引擎。安装 Chrome 后重跑，或用')
  console.log('   MARKPURE_CHROME=/path/to/chrome 指定路径。')
  process.exit(0)
}

if (!existsSync(HARNESS_BIN)) {
  console.error(`✘ 找不到 harness 二进制 ${HARNESS_BIN}`)
  console.error('   请先执行：cargo build --bin mt_harness')
  process.exit(1)
}

// ---- 准备：临时工作区 + 生产构建 + preview 服务 -----------------------

const workDir = mkdtempSync(join(tmpdir(), 'markpure-layout-'))
const configDir = join(workDir, 'config')
const wsDir = join(workDir, 'ws')
const outDir = join(workDir, 'dist')
mkdirSync(configDir, { recursive: true })
mkdirSync(wsDir, { recursive: true })
writeFileSync(
  join(wsDir, 'sample.md'),
  '# Layout Probe\n\n段落内容 body text.\n\n| 列 A | 列 B |\n| --- | --- |\n| 1 | 2 |\n',
)

console.log('— validate-layout —')
console.log('  正在构建生产产物 ...')
execFileSync('npx', ['vite', 'build', '--outDir', outDir, '--emptyOutDir'], {
  cwd: REPO_ROOT,
  stdio: 'ignore',
})

const PORT = 4200 + Math.floor(Math.random() * 400)
const preview: ChildProcess = spawn(
  'npx',
  // `--host 127.0.0.1`：显式绑 IPv4。默认绑 `localhost` 时 macOS 会
  // 优先解析到 ::1，测试脚本用 127.0.0.1 连就会连接失败。
  ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1', '--outDir', outDir],
  {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      MARKPURE_CONFIG_DIR: configDir,
      MARKPURE_DEV_WORKSPACE: wsDir,
      MARKPURE_IPC_POLL: '0',
    },
    stdio: 'ignore',
  },
)

const CDP_PORT = PORT + 1000
let chrome: ChildProcess | null = null
let ws: WebSocket | null = null

async function waitFor<T>(fn: () => Promise<T | null>, ms = 20000): Promise<T> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    try {
      const v = await fn()
      if (v) return v
    } catch { /* 还没就绪 */ }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('timeout')
}

async function main() {
  // 等 preview 服务起来
  await waitFor(async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/`).catch(() => null)
    return r && r.ok ? true : null
  })
  // preview 起来后 bridge 会自动注册工作区；给它一点时间
  await new Promise((r) => setTimeout(r, 1500))

  chrome = spawn(
    chromePath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${join(workDir, 'chrome-profile')}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  const target = await waitFor(async () => {
    const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
    return (list.find((t: { type: string }) => t.type === 'page') as { webSocketDebuggerUrl: string }) ?? null
  })

  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise<void>((res, rej) => {
    ws!.addEventListener('open', () => res(), { once: true })
    ws!.addEventListener('error', rej, { once: true })
  })

  let nextId = 1
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse((ev as MessageEvent).data)
    const p = pending.get(m.id)
    if (!p) return
    pending.delete(m.id)
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result)
  })
  const send = (method: string, params: Record<string, unknown> = {}): Promise<any> => {
    const id = nextId++
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      ws!.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`timeout ${method}`))
      }, 30000)
    })
  }
  const evaluate = async (expression: string): Promise<any> => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    return r.result?.value
  }

  await send('Page.enable')
  await send('Runtime.enable')

  /** 打开样本文件并返回布局快照。 */
  async function probe(width: number, height: number, openOutline: boolean) {
    await send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: false,
    })
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` })
    await new Promise((r) => setTimeout(r, 3500))

    // 在文件树里点开样本文件。
    //
    // 布局崩坏时（例如 `.editor-panel` 包装丢失）文件树可能被挤到
    // 视口外而点不到——这本身就是缺陷。因此这里重试几次，并把
    // 「打不开」当成一个**断言失败**而不是让整个脚本崩掉：后面的
    // 结构断言不依赖文件是否打开，仍然要跑。
    let opened = false
    for (let attempt = 0; attempt < 4 && !opened; attempt++) {
      const clicked = await evaluate(`(() => {
        const all = [...document.querySelectorAll('*')].filter(
          n => (n.textContent||'').trim() === 'sample.md' && n.children.length === 0)
        const el = all[0]
        if (!el) return 'not-found'
        const t = el.closest('[role=button], .tree-item, button') || el
        t.click()
        return 'clicked'
      })()`)
      if (clicked === 'clicked') {
        await new Promise((r) => setTimeout(r, 1800))
        opened = !!await evaluate(`!!document.querySelector('.ProseMirror')`)
      } else {
        await new Promise((r) => setTimeout(r, 800))
      }
    }
    ok(`${width}×${height}: 能在文件树里打开文档`, opened, '文件树点不到 / 编辑器没渲染')

    if (openOutline) {
      await evaluate(`(() => {
        const btns = [...document.querySelectorAll('.toolbar button')]
        const hit = btns.find(b => (b.title||'').toLowerCase().includes('outline') || (b.title||'').includes('大纲'))
        if (hit) hit.click()
        return !!hit
      })()`)
      await new Promise((r) => setTimeout(r, 1200))
    }

    const snap = await evaluate(`(() => {
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

  // ---- 断言 -------------------------------------------------------------

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

  // 大纲面板必须在编辑器右侧
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

  // 禅模式：隐藏标签栏 / 工具栏 / 状态栏，编辑器占满。
  // 禅模式的 CSS 依赖 `.editor-panel`——它曾经丢失过，所以单独覆盖。
  {
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1900, height: 1180, deviceScaleFactor: 1, mobile: false,
    })
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` })
    await new Promise((r) => setTimeout(r, 3500))
    await evaluate(`(() => {
      const all = [...document.querySelectorAll('*')].filter(
        n => (n.textContent||'').trim() === 'sample.md' && n.children.length === 0)
      const el = all[0]
      if (el) (el.closest('[role=button], .tree-item, button') || el).click()
      return !!el
    })()`)
    await new Promise((r) => setTimeout(r, 2000))

    // 「视图」菜单 → 「切换专注模式」。菜单文案随语言变化，两种都匹配。
    //
    // 关键：菜单项是 `{#if showViewMenu}` 条件渲染的，Svelte 5 的 DOM
    // 更新是异步的——点完菜单按钮后必须**另起一轮** evaluate 去查
    // dropdown 项，否则查到的还是空列表。
    const viewMenuOpened = await evaluate(`(() => {
      const viewBtn = [...document.querySelectorAll('.menu-btn')]
        .find(b => /^(视图|View)$/.test((b.textContent||'').trim()))
      if (!viewBtn) return false
      viewBtn.click()
      return true
    })()`)
    ok('「视图」菜单可打开', !!viewMenuOpened)
    await new Promise((r) => setTimeout(r, 500))

    const zenClicked = await evaluate(`(() => {
      const zen = [...document.querySelectorAll('.dropdown-item')]
        .find(b => /专注模式|Zen Mode/i.test(b.textContent||''))
      if (!zen) return 'no-zen-item'
      zen.click()
      return 'clicked'
    })()`)
    ok('禅模式可切换', zenClicked === 'clicked', String(zenClicked))
    await new Promise((r) => setTimeout(r, 1200))

    const z = await evaluate(`(() => {
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

  // 分屏视图：源码编辑器与所见即所得并排，两栏都不能被挤没。
  {
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1900, height: 1180, deviceScaleFactor: 1, mobile: false,
    })
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` })
    await new Promise((r) => setTimeout(r, 3500))
    await evaluate(`(() => {
      const all = [...document.querySelectorAll('*')].filter(
        n => (n.textContent||'').trim() === 'sample.md' && n.children.length === 0)
      const el = all[0]
      if (el) (el.closest('[role=button], .tree-item, button') || el).click()
      return !!el
    })()`)
    await new Promise((r) => setTimeout(r, 2000))

    // 工具栏的「切换视图模式」按钮。循环顺序是
    // wysiwyg → split → source → wysiwyg，所以**点一次**就是分屏。
    const cycled = await evaluate(`(() => {
      const btn = [...document.querySelectorAll('.toolbar button')]
        .find(b => /切换视图模式|Cycle View Mode/i.test(b.title||''))
      if (!btn) return false
      btn.click()
      return true
    })()`)
    ok('视图模式可循环切换', !!cycled, '找不到「切换视图模式」按钮')
    await new Promise((r) => setTimeout(r, 1500))

    const sp = await evaluate(`(() => {
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
}

try {
  await main()
} catch (e) {
  failures++
  console.error(`✘ 布局测试异常终止: ${String(e)}`)
} finally {
  try { ws?.close() } catch { /* ignore */ }
  chrome?.kill()
  preview.kill()
  rmSync(workDir, { recursive: true, force: true })
}

console.log(failures ? `\nFAILED (${failures})` : '\nOK')
process.exitCode = failures ? 1 : 0
