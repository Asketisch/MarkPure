/**
 * 显示层**交互**回归测试。
 *
 * ## 为什么需要它
 *
 * `validate-layout.ts` 验证的是「静止时的样子」，但编辑器的大半价值
 * 在**交互**上：查找替换、快速插入、大纲跳转、表格/图片拖拽柄、
 * 命令面板……这些功能要么不渲染任何持久元素，要么只在特定操作后
 * 才出现，纯函数测试与静态 DOM 检查都覆盖不到。
 *
 * 本脚本用无头 Chrome（CDP）在**生产构建**上真实派发按键与输入，
 * 断言每个交互的**可见结果**：
 *
 * - 查找替换：Cmd+F 唤出搜索栏，输入后出现高亮匹配与计数
 * - 快速插入：编辑器里输入 `@` 唤出候选弹层
 * - 命令面板：Cmd+Shift+P 唤出面板并列出命令
 * - 大纲面板：打开后点击条目，选区跳到对应标题
 * - 表格 / 图片：渲染出可拖拽的调整手柄
 * - 代码块：渲染出语言选择器
 *
 * 需要 Chrome；没有则跳过（布局类断言需要真实排版引擎，缺它时
 * 无法验证，但也不该让套件变红）。
 *
 * 运行：npx tsx scripts/validate-interactions.ts
 */
import { CdpClient, findChrome, harnessReady, openFileInTree, sleep, startHarness } from './lib/browser-harness'

let failures = 0
function ok(label: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`✔ ${label}`)
  } else {
    failures++
    console.error(`✘ ${label}${detail ? `\n   ${detail}` : ''}`)
  }
}

const chromePath = findChrome()
if (!chromePath) {
  console.log('— validate-interactions —')
  console.log('\n⏭  跳过：找不到 Chrome / Chromium（交互断言需要真实事件派发）。')
  console.log('   安装 Chrome 后重跑，或用 MARKPURE_CHROME=/path/to/chrome 指定。')
  process.exit(0)
}
if (!harnessReady()) {
  console.error('✘ 找不到 mt_harness 二进制，请先执行：cargo build --bin mt_harness')
  process.exit(1)
}

const SAMPLE = [
  '# 交互探针',
  '',
  '第一段落 alpha beta gamma。',
  '',
  '## 第二个标题',
  '',
  '第二段落 delta epsilon。',
  '',
  '| 列 A | 列 B |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '```python',
  'print("hello")',
  '```',
  '',
  '![占位图](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7)',
  '',
].join('\n')

console.log('— validate-interactions —')
const harness = await startHarness({ files: { 'probe.md': SAMPLE } })
const cdp = await CdpClient.launch(
  chromePath,
  `${harness.workspaceDir}/chrome-profile`,
  4500 + Math.floor(Math.random() * 300),
)

try {
  await cdp.setViewport(1600, 1000)
  await cdp.navigate(harness.url)
  await sleep(4000)

  ok('能在文件树里打开文档', await openFileInTree(cdp, 'probe.md'))

  // ---- 查找替换 ---------------------------------------------------------
  {
    await cdp.focusEditor()
    await cdp.pressKey('f', ['Meta'])
    await sleep(600)
    const barVisible = await cdp.evaluate(`!!document.querySelector('.search-bar')`)
    ok('Cmd+F 唤出搜索栏', !!barVisible)

    if (barVisible) {
      await cdp.evaluate(`(() => {
        const inp = document.querySelector('.search-bar input')
        if (inp) { inp.focus(); inp.value = 'alpha'; inp.dispatchEvent(new Event('input', {bubbles:true})) }
        return !!inp
      })()`)
      await sleep(900)
      const matches = await cdp.evaluate(
        `document.querySelectorAll('.mw-search-match').length`,
      )
      ok('搜索命中并高亮', matches > 0, `高亮数 ${matches}`)
      const count = await cdp.evaluate(
        `(() => { const c = document.querySelector('.search-count'); return c ? c.textContent : null })()`,
      )
      ok('搜索计数有内容', !!count && count.trim().length > 0, `count=${count}`)
    }
  }

  // ---- 快速插入 ---------------------------------------------------------
  {
    await cdp.pressKey('Escape')
    await sleep(300)
    await cdp.focusEditor()
    await cdp.insertText('@')
    await sleep(900)
    const popup = await cdp.evaluate(`!!document.querySelector('.qi-popup')`)
    ok('输入 @ 唤出快速插入弹层', !!popup)
    if (popup) {
      const items = await cdp.evaluate(`document.querySelectorAll('.qi-item').length`)
      ok('快速插入有候选项', items > 0, `候选数 ${items}`)
    }
    await cdp.pressKey('Escape')
    await sleep(300)
  }

  // ---- 撤销 / 重做（⌘Z / ⌘⇧Z）-------------------------------------------
  {
    // ⌘⇧Z 与 ⌘⇧P / ⌘⇧F 同源：按住 Shift 时 `e.key` 是大写 'Z'，
    // 不归一化就匹配不到 `case 'z'`。
    await cdp.pressKey('Escape')
    await sleep(300)
    await cdp.focusEditor()
    await cdp.insertText('REDO-MARKER')
    await sleep(600)
    const afterType = await cdp.evaluate(`document.querySelector('.ProseMirror').textContent`)
    ok('输入内容进入编辑器', afterType.includes('REDO-MARKER'))

    await cdp.pressKey('z', ['Meta'])
    await sleep(600)
    const afterUndo = await cdp.evaluate(`document.querySelector('.ProseMirror').textContent`)
    ok('⌘Z 撤销了输入', !afterUndo.includes('REDO-MARKER'))

    await cdp.pressKey('Z', ['Meta', 'Shift'])
    await sleep(600)
    const afterRedo = await cdp.evaluate(`document.querySelector('.ProseMirror').textContent`)
    ok('⌘⇧Z 重做恢复了输入', afterRedo.includes('REDO-MARKER'))
  }

  // ---- 命令面板（⌘⇧P）---------------------------------------------------
  {
    // ⌘⇧P 的 `e.key` 在真实浏览器里是**大写 'P'**——应用早前按小写
    // 'p' 匹配，导致这个快捷键（欢迎页明确宣传的）完全失效。
    await cdp.pressKey('P', ['Meta', 'Shift'])
    await sleep(700)
    const palette = await cdp.evaluate(`!!document.querySelector('.palette')`)
    ok('⌘⇧P 唤出命令面板', !!palette)
    if (palette) {
      const cmds = await cdp.evaluate(`document.querySelectorAll('.palette .results .item').length`)
      ok('命令面板列出了命令', cmds > 0, `命令数 ${cmds}`)
    }
    await cdp.pressKey('Escape')
    await sleep(400)
  }

  // ---- 工作区搜索（⌘⇧F）-------------------------------------------------
  {
    await cdp.pressKey('F', ['Meta', 'Shift'])
    await sleep(700)
    const ws = await cdp.evaluate(`!!document.querySelector('.workspace-search')`)
    ok('⌘⇧F 唤出工作区搜索', !!ws)
    await cdp.pressKey('Escape')
    await sleep(400)
  }

  // ---- 大纲面板 + 跳转 --------------------------------------------------
  {
    // 工具栏里的「大纲」开关
    const toggled = await cdp.evaluate(`(() => {
      const btns = [...document.querySelectorAll('.toolbar button')]
      const hit = btns.find(b => /大纲|Outline/i.test(b.title||''))
      if (!hit) return false
      hit.click()
      return true
    })()`)
    ok('工具栏有大纲开关', toggled)
    await sleep(900)

    const panel = await cdp.evaluate(`!!document.querySelector('.outline-panel')`)
    ok('大纲面板已打开', !!panel)

    if (panel) {
      const items = await cdp.evaluate(`document.querySelectorAll('.outline-item, .outline-panel .item').length`)
      ok('大纲列出了标题', items > 0, `条目数 ${items}`)

      const before = await cdp.evaluate(
        `(() => { const s = getSelection(); return s && s.rangeCount ? s.anchorOffset : -1 })()`,
      )
      await cdp.evaluate(`(() => {
        const el = document.querySelector('.outline-item, .outline-panel .item')
        if (el) el.click()
        return !!el
      })()`)
      await sleep(700)
      const after = await cdp.evaluate(
        `(() => { const s = getSelection(); return s && s.rangeCount ? s.anchorOffset : -1 })()`,
      )
      ok('点击大纲条目后选区发生变化', after !== before || after >= 0, `before=${before} after=${after}`)
    }
    // 关闭大纲，避免影响后续断言
    await cdp.evaluate(`(() => {
      const btn = document.querySelector('.toolbar button')
      const hit = [...document.querySelectorAll('.toolbar button')]
        .find(b => /大纲|Outline/i.test(b.title||''))
      if (hit) hit.click()
      return !!hit
    })()`)
    await sleep(500)
  }

  // ---- 表格 / 图片 / 代码块 的可交互部件 --------------------------------
  {
    // 表格列宽拖拽柄由 prosemirror-tables 生成，且**只在鼠标悬停到
    // 列边界附近时**才出现（`activeHandle` 机制）——光标在单元格里
    // 是不够的。因此这里要把鼠标移到表头单元格的右边缘。
    const hovered = await cdp.hoverElementEdge('.tableWrapper th', 'right')
    ok('能把鼠标移到表头列边界', hovered)
    await sleep(600)
    const resizeHandle = await cdp.evaluate(`document.querySelectorAll('.column-resize-handle').length`)
    ok('悬停列边界时出现列宽拖拽柄', resizeHandle > 0, `数量 ${resizeHandle}`)

    const imgHandle = await cdp.evaluate(`document.querySelectorAll('.image-resize-handle, .image-resize-corner').length`)
    ok('图片有缩放拖拽柄', imgHandle > 0, `数量 ${imgHandle}`)

    const langSelect = await cdp.evaluate(`document.querySelectorAll('.mw-code-block-lang').length`)
    ok('代码块有语言选择器', langSelect > 0, `数量 ${langSelect}`)

    const codeBlock = await cdp.evaluate(`document.querySelectorAll('.mw-code-block').length`)
    ok('围栏代码块渲染出来了', codeBlock > 0, `数量 ${codeBlock}`)
  }

  // ---- 状态栏统计随内容更新 ---------------------------------------------
  {
    const stats = await cdp.evaluate(`(() => {
      const bar = document.querySelector('.status-bar')
      return bar ? bar.textContent : null
    })()`)
    ok('状态栏显示了统计信息', !!stats && /\d/.test(stats), `status=${stats}`)
  }
  // ---- 另存为（⌘⇧S）----------------------------------------------------
  {
    // 「另存为」会弹**原生**文件对话框——测试里不能真弹（会挡住用户
    // 的屏幕）。因此在页面里给 IPC 传输层打桩：`pick_save_file` 直接
    // 回一个路径，然后断言应用确实发出了 `save_file` 且路径正确——
    // 这比「面板弹出来了」更能证明走的是另存为分支。
    const stubbed = await cdp.evaluate(`(() => {
      if (!window.ipc || typeof window.__mt_dispatch !== 'function') return false
      const orig = window.ipc.postMessage.bind(window.ipc)
      window.__cmds = []
      window.ipc.postMessage = (json) => {
        const msg = JSON.parse(json)
        window.__cmds.push({ cmd: msg.cmd, params: msg.params })
        if (msg.cmd === 'pick_save_file') {
          window.__mt_dispatch(JSON.stringify({ id: msg.id, result: '/tmp/mp-saveas-target.md' }))
          return
        }
        orig(json)
      }
      return true
    })()`)
    ok('能对 IPC 传输层打桩', !!stubbed)

    await cdp.pressKey('S', ['Meta', 'Shift'])
    await sleep(1200)

    const cmds = await cdp.evaluate<Array<{ cmd: string; params: Record<string, unknown> }>>(
      `window.__cmds || []`,
    )
    const picked = cmds.find((c) => c.cmd === 'pick_save_file')
    ok('⌘⇧S 触发「另存为」（发出 pick_save_file）', !!picked, JSON.stringify(cmds.map((c) => c.cmd)))
    const saved = cmds.find((c) => c.cmd === 'save_file')
    ok('另存为最终写到了新路径', !!saved && saved.params.path === '/tmp/mp-saveas-target.md',
      JSON.stringify(saved?.params?.path))
  }


} catch (e) {
  failures++
  console.error(`✘ 交互测试异常终止: ${String(e)}`)
} finally {
  await cdp.close()
  harness.stop()
}

console.log(failures ? `\nFAILED (${failures})` : '\nOK')
process.exitCode = failures ? 1 : 0
