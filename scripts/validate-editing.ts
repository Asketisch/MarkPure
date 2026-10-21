/**
 * 显示层**编辑交互**回归测试。
 *
 * `validate-interactions.ts` 覆盖「面板类」交互（搜索、命令面板、
 * 大纲……）；这个脚本覆盖**直接操作文档内容**的交互：拖拽手柄、
 * 下拉切换、勾选、补全。
 *
 * 这些是最容易「看起来有、实际不响应」的一类功能——按钮在、样式在、
 * 文档结构也在，但事件没接上或参数算错，用户完全看不出来。
 *
 * 覆盖：
 * - 表格列宽拖拽手柄（悬停出现 → 拖动改变列宽）
 * - 图片缩放拖拽手柄（拖动改变 figure 宽度）
 * - 代码块语言下拉（切换后写进文档，保存时体现在 markdown 里）
 * - 任务列表复选框（勾选改变 checked 状态）
 * - 链接自动补全（输入 `[文本](` 弹出候选）
 *
 * 需要 Chrome；没有则跳过。
 *
 * 运行：npx tsx scripts/validate-editing.ts
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

const chromePath = findChrome()
if (!chromePath) {
  console.log('— validate-editing —')
  console.log('\n⏭  跳过：找不到 Chrome / Chromium（交互断言需要真实事件派发）。')
  process.exit(0)
}
if (!harnessReady()) {
  console.error('✘ 找不到 mt_harness 二进制，请先执行：cargo build --bin mt_harness')
  process.exit(1)
}

// 1×1 的 GIF 太小——图片没有实际尺寸时缩放手柄会退化到 (0,0)。
// 这里用 `{width=160}` 扩展语法给它一个确定宽度（该语法由图片扩展
// 的 markdown 钩子解析）。
const SAMPLE = [
  '# 编辑探针',
  '',
  '| 列 A | 列 B |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '```python',
  'print(1)',
  '```',
  '',
  '![占位图](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7){width=160}',
  '',
  '- [ ] 待办',
  '',
  '段落结尾',
  '',
].join('\n')

console.log('— validate-editing —')
const harness = await startHarness({ files: { 'edit.md': SAMPLE } })
const cdp = await CdpClient.launch(
  chromePath,
  `${harness.workspaceDir}/chrome-profile`,
  4900 + Math.floor(Math.random() * 90),
)

/** 拖拽：从 (x, y) 按下，移动 dx 像素后松开。 */
async function drag(x: number, y: number, dx: number, steps = 6): Promise<void> {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 })
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1,
  })
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: x + (dx * i) / steps, y, button: 'left', buttons: 1,
    })
    await sleep(50)
  }
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: x + dx, y, button: 'left', buttons: 0, clickCount: 1,
  })
  await sleep(600)
}

try {
  await cdp.setViewport(1600, 1000)
  await cdp.navigate(harness.url)
  await sleep(4000)
  ok('能在文件树里打开文档', await openFileInTree(cdp, 'edit.md'))

  // ---- 表格列宽拖拽 -----------------------------------------------------
  {
    const before = await cdp.evaluate<string | null>(
      `(() => { const c = document.querySelector('.tableWrapper col'); return c ? c.getAttribute('style') : null })()`,
    )
    ok('表格已渲染（.tableWrapper）', before !== null, `style=${before}`)

    // 手柄只在鼠标**悬停到列边界**时出现（prosemirror-tables 的
    // `activeHandle` 机制），所以要先把鼠标移过去。
    const hovered = await cdp.hoverElementEdge('.tableWrapper th', 'right')
    ok('能把鼠标移到表头列边界', hovered)
    await sleep(500)

    const handleBox = await cdp.evaluate<{ x: number; y: number } | null>(`(() => {
      const h = document.querySelector('.column-resize-handle')
      if (!h) return null
      const r = h.getBoundingClientRect()
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
    })()`)
    ok('悬停列边界时出现列宽拖拽柄', handleBox !== null, '未找到 .column-resize-handle')

    if (handleBox) {
      await drag(handleBox.x, handleBox.y, 90)
      const after = await cdp.evaluate<string | null>(
        `(() => { const c = document.querySelector('.tableWrapper col'); return c ? c.getAttribute('style') : null })()`,
      )
      ok(
        '拖动后列宽改变',
        !!after && after !== before,
        `拖动前 ${before} → 拖动后 ${after}`,
      )
    }
  }

  // ---- 图片缩放拖拽 -----------------------------------------------------
  {
    const handles = await cdp.evaluate<number>(
      `document.querySelectorAll('.image-resize-handle').length`,
    )
    ok('图片有缩放拖拽柄', handles > 0, `数量 ${handles}`)

    // 手柄默认 `display:none`，只有图片被**选中**（或悬停）时才出现。
    // 因此先点一下图片把它选中。
    const selected = await cdp.clickElement('figure.image-figure')
    ok('能点选图片', selected)
    await sleep(500)

    const box = await cdp.evaluate<{ x: number; y: number } | null>(`(() => {
      const h = document.querySelector('.image-resize-handle.image-resize-right')
      if (!h) return null
      const r = h.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) return null
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
    })()`)
    ok('选中图片后缩放手柄可见', !!box, '手柄位置为 (0,0)——手柄仍处于 display:none')

    if (box) {
      const before = await cdp.evaluate<string | null>(
        `document.querySelector('figure.image-figure')?.getAttribute('style')`,
      )
      await drag(box.x, box.y, 60)
      const after = await cdp.evaluate<string | null>(
        `document.querySelector('figure.image-figure')?.getAttribute('style')`,
      )
      ok(
        '拖动后图片宽度改变',
        !!after && after !== before,
        `拖动前 ${before} → 拖动后 ${after}`,
      )
    }
  }

  // ---- 代码块语言切换 ---------------------------------------------------
  {
    const sel = await cdp.evaluate<{ value: string; options: number } | null>(`(() => {
      const s = document.querySelector('.mw-code-block-lang')
      return s ? { value: s.value, options: s.options.length } : null
    })()`)
    ok('代码块有语言下拉', !!sel, '未找到 .mw-code-block-lang')
    ok('语言下拉有多个选项', !!sel && sel.options > 5, `选项 ${sel?.options}`)

    if (sel) {
      // 切换语言后必须真正写进文档——用「保存时发出的 markdown」来验证，
      // 而不是只看下拉框自己的值。
      await cdp.evaluate(`(() => {
        const s = document.querySelector('.mw-code-block-lang')
        s.value = 'rust'
        s.dispatchEvent(new Event('change', { bubbles: true }))
        return s.value
      })()`)
      await sleep(700)

      // 拦截 save_file 的 IPC，拿到应用序列化出来的 markdown
      await cdp.evaluate(`(() => {
        if (!window.ipc || typeof window.__mt_dispatch !== 'function') return false
        const orig = window.ipc.postMessage.bind(window.ipc)
        window.__saved = []
        window.ipc.postMessage = (json) => {
          const msg = JSON.parse(json)
          if (msg.cmd === 'save_file') {
            window.__saved.push(msg.params)
            window.__mt_dispatch(JSON.stringify({ id: msg.id, result: null }))
            return
          }
          orig(json)
        }
        return true
      })()`)

      await cdp.focusEditor()
      await cdp.pressKey('s', ['Meta'])
      await sleep(1200)

      const saved = await cdp.evaluate<Array<{ content?: string }>>(`window.__saved || []`)
      const content = saved[0]?.content ?? ''
      ok('保存发出了 save_file', saved.length > 0, `saved=${saved.length}`)
      ok(
        '代码块语言写进了文档（markdown 里是 ```rust）',
        content.includes('```rust'),
        `markdown 片段: ${content.slice(0, 160).replace(/\n/g, '\\n')}`,
      )
    }
  }

  // ---- 任务列表勾选 -----------------------------------------------------
  {
    const before = await cdp.evaluate<string | null>(
      `document.querySelector('ul[data-type="taskList"] > li[data-checked]')?.getAttribute('data-checked')`,
    )
    ok('任务列表已渲染', before !== null, `data-checked=${before}`)

    const box = await cdp.evaluate<{ x: number; y: number } | null>(`(() => {
      const c = document.querySelector('ul[data-type="taskList"] > li[data-checked] input[type=checkbox]')
      if (!c) return null
      const r = c.getBoundingClientRect()
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
    })()`)
    if (box) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, buttons: 0 })
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed', x: box.x, y: box.y, button: 'left', buttons: 1, clickCount: 1,
      })
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: box.x, y: box.y, button: 'left', buttons: 0, clickCount: 1,
      })
      await sleep(700)
    } else {
      ok('能定位任务复选框', false, '未找到 input[type=checkbox]')
    }
    const after = await cdp.evaluate<string | null>(
      `document.querySelector('ul[data-type="taskList"] > li[data-checked]')?.getAttribute('data-checked')`,
    )
    ok('勾选复选框后状态改变', after !== before, `${before} → ${after}`)
  }

  // ---- 链接自动补全 -----------------------------------------------------
  {
    await cdp.evaluate(`(() => {
      window.__linkEvents = []
      for (const n of ['mt:link-suggest-start', 'mt:link-suggest-update']) {
        window.addEventListener(n, () => window.__linkEvents.push(n))
      }
      return true
    })()`)

    await cdp.focusEditor()
    // 逐字输入（一次性插入整串不会被 Suggestion 插件识别成触发）
    for (const ch of ['[', 'e', 'd', 'i', 't', ']', '(']) {
      await cdp.insertText(ch)
      await sleep(110)
    }
    await sleep(1000)

    const events = await cdp.evaluate<string[]>(`window.__linkEvents || []`)
    ok('输入 `[文本](` 触发链接补全', events.includes('mt:link-suggest-start'), JSON.stringify(events))
    const popup = await cdp.evaluate(`!!document.querySelector('.link-suggest-popup')`)
    ok('链接补全弹层出现', !!popup)
  }
} catch (e) {
  failures++
  console.error(`✘ 编辑交互测试异常终止: ${String(e)}`)
} finally {
  await cdp.close()
  harness.stop()
}

console.log(failures ? `\nFAILED (${failures})` : '\nOK')
process.exitCode = failures ? 1 : 0
