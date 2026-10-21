/**
 * 显示层**功能**回归测试。
 *
 * `validate-interactions.ts` 与 `validate-editing.ts` 验证「控件能不能
 * 响应」；这个脚本验证**跨组件的完整链路**——从入口一路走到最终
 * 的可见结果。链路越长，越容易在中间某处断开，而且断的时候
 * 界面上完全看不出来。
 *
 * 覆盖：
 * - 命令面板**执行**一条命令（打开 → 搜索 → 回车 → 目标面板真的打开）
 * - 书签面板：添加 → 出现在列表 → 删除
 * - 工作区搜索：输入 → 出结果 → 点击结果导航到该文件
 * - 拼写检查：右键拼错的单词 → 候选菜单出现
 * - 图片宽度**端到端**：拖拽改宽 → 保存写盘 → 重新加载打开 → 宽度还在
 *
 * 需要 Chrome；没有则跳过。
 *
 * 运行：npx tsx scripts/validate-features.ts
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
  console.log('— validate-features —')
  console.log('\n⏭  跳过：找不到 Chrome / Chromium。')
  process.exit(0)
}
if (!harnessReady()) {
  console.error('✘ 找不到 mt_harness 二进制，请先执行：cargo build --bin mt_harness')
  process.exit(1)
}

const SAMPLE = [
  '# 功能探针',
  '',
  '第一段落，含 unique-token 这个独特词。',
  '',
  '这里有一个拼写错误 recieve 用来测试拼写检查。',
  '',
  '![pic](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7){width=120}',
  '',
].join('\n')

console.log('— validate-features —')
const harness = await startHarness({
  files: { 'feature.md': SAMPLE, 'other.md': '# 其他\n\n另一个文件，带 shared-keyword。\n' },
})
const cdp = await CdpClient.launch(
  chromePath,
  `${harness.workspaceDir}/chrome-profile`,
  4300 + Math.floor(Math.random() * 90),
)

/** 在页面里给某个输入框赋值并派发 input 事件。 */
async function fill(selector: string, value: string): Promise<boolean> {
  return cdp.evaluate<boolean>(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return false
    el.focus()
    el.value = ${JSON.stringify(value)}
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
}

try {
  await cdp.setViewport(1600, 1000)
  await cdp.navigate(harness.url)
  await sleep(4000)
  ok('能在文件树里打开文档', await openFileInTree(cdp, 'feature.md'))

  // ---- 命令面板执行命令 → 书签面板打开 ---------------------------------
  {
    await cdp.pressKey('P', ['Meta', 'Shift'])
    await sleep(700)
    ok('命令面板已打开', !!(await cdp.evaluate(`!!document.querySelector('.palette')`)))

    await fill('.palette .input', 'bookmark')
    await sleep(700)
    const items = await cdp.evaluate<number>(
      `document.querySelectorAll('.palette .results .item').length`,
    )
    ok('命令面板按关键字过滤出候选', items > 0, `候选数 ${items}`)

    await cdp.pressKey('Enter')
    await sleep(1200)
    ok(
      '回车执行命令后书签面板打开',
      !!(await cdp.evaluate(`!!document.querySelector('.bookmark-panel')`)),
      '命令面板的执行链路可能断了',
    )
  }

  // ---- 书签：添加 → 列出 → 删除 -----------------------------------------
  {
    const panel = await cdp.evaluate(`!!document.querySelector('.bookmark-panel')`)
    ok('书签面板可见', panel)

    if (panel) {
      await cdp.clickElement('.bp-add-btn')
      await sleep(400)
      const inputs = await cdp.evaluate<number>(
        `document.querySelectorAll('.bp-input').length`,
      )
      ok('点「添加」后出现输入框', inputs === 2, `输入框数 ${inputs}`)

      // 第一个是路径，第二个是标题
      await fill('.bp-input', '/tmp/feature.md')
      await sleep(200)
      const titleInputs = await cdp.evaluate<number>(
        `document.querySelectorAll('.bp-input').length`,
      )
      await cdp.evaluate(`(() => {
        const els = document.querySelectorAll('.bp-input')
        const t = els[1]
        if (!t) return false
        t.focus(); t.value = '我的书签'
        t.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      })()`)
      await sleep(300)
      await cdp.clickElement('.bp-btn.primary')
      await sleep(1000)

      const itemCount = await cdp.evaluate<number>(
        `document.querySelectorAll('.bookmark-panel .bp-item').length`,
      )
      ok('书签出现在列表里', itemCount === 1, `列表项 ${itemCount}（输入框 ${titleInputs}）`)

      const title = await cdp.evaluate<string | null>(
        `document.querySelector('.bp-item-title')?.textContent ?? null`,
      )
      ok('书签标题正确', title === '我的书签', `title=${title}`)

      await cdp.clickElement('.bp-remove')
      await sleep(1000)
      const after = await cdp.evaluate<number>(
        `document.querySelectorAll('.bookmark-panel .bp-item').length`,
      )
      ok('删除后书签消失', after === 0, `剩余 ${after}`)
    }
  }

  // ---- 书签面板关闭，工作区搜索可用 -------------------------------------
  await cdp.evaluate(`(() => {
    const b = document.querySelector('.bp-close')
    if (b) b.click()
    return true
  })()`)
  await sleep(400)

  // ---- 工作区搜索 -------------------------------------------------------
  {
    await cdp.pressKey('F', ['Meta', 'Shift'])
    await sleep(800)
    ok('⌘⇧F 打开工作区搜索', !!(await cdp.evaluate(`!!document.querySelector('.workspace-search')`)))

    await fill('.workspace-search .ws-input', 'shared-keyword')
    await sleep(1500)
    const results = await cdp.evaluate<number>(
      `document.querySelectorAll('.workspace-search .ws-result').length`,
    )
    ok('工作区搜索出结果', results > 0, `结果数 ${results}`)

    if (results > 0) {
      const fileName = await cdp.evaluate<string | null>(
        `document.querySelector('.ws-filename')?.textContent ?? null`,
      )
      ok('结果指向正确的文件', fileName === 'other.md', `filename=${fileName}`)

      await cdp.clickElement('.workspace-search .ws-result')
      await sleep(1200)
      const tab = await cdp.evaluate<string | null>(
        `(() => { const t = document.querySelector('.tab.active .tab-name'); return t ? t.textContent : null })()`,
      )
      ok('点击结果后切换到该文件', tab === 'other.md', `活动标签=${tab}`)
    }
  }

  // ---- 拼写检查右键菜单 -------------------------------------------------
  {
    await cdp.pressKey('Escape')
    await sleep(400)
    // 回到 feature.md
    await cdp.evaluate(`(() => {
      const all = [...document.querySelectorAll('*')].filter(
        n => (n.textContent||'').trim() === 'feature.md' && n.children.length === 0)
      const el = all[0]
      if (el) (el.closest('[role=button], .tree-item, button') || el).click()
      return !!el
    })()`)
    await sleep(1500)

    const marked = await cdp.evaluate<number>(
      `document.querySelectorAll('.spell-error').length`,
    )
    ok('拼错的单词被标记出来', marked > 0, `标记数 ${marked}`)

    if (marked > 0) {
      const box = await cdp.evaluate<{ x: number; y: number } | null>(`(() => {
        const el = document.querySelector('.spell-error')
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
      })()`)
      if (box) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, buttons: 0 })
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mousePressed', x: box.x, y: box.y, button: 'right', buttons: 2, clickCount: 1,
        })
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseReleased', x: box.x, y: box.y, button: 'right', buttons: 0, clickCount: 1,
        })
        await sleep(900)
      }
      const menu = await cdp.evaluate<number>(
        `document.querySelectorAll('.context-menu .menu-item').length`,
      )
      ok('右键拼错的单词弹出候选菜单', menu > 0, `菜单项 ${menu}`)
    }
  }

  // ---- 图片宽度端到端：拖拽 → 保存 → 重新打开 ---------------------------
  {
    await cdp.evaluate(`(() => {
      const all = [...document.querySelectorAll('*')].filter(
        n => (n.textContent||'').trim() === 'feature.md' && n.children.length === 0)
      const el = all[0]
      if (el) (el.closest('[role=button], .tree-item, button') || el).click()
      return !!el
    })()`)
    await sleep(1200)

    // 图片已经在样本文件里（`{width=120}` 扩展语法），
    // 直接断言它渲染成带宽度的图片节点。
    await sleep(800)

    const figure = await cdp.evaluate<{ w: number; style: string | null } | null>(`(() => {
      const f = document.querySelector('figure.image-figure')
      if (!f) return null
      const r = f.getBoundingClientRect()
      return { w: Math.round(r.width), style: f.getAttribute('style') }
    })()`)
    ok('图片已插入且带初始宽度', !!figure && figure.w > 0, JSON.stringify(figure))

    // 选中图片 → 拖拽右缘手柄加宽
    await cdp.clickElement('figure.image-figure')
    await sleep(500)
    const handle = await cdp.evaluate<{ x: number; y: number } | null>(`(() => {
      const h = document.querySelector('.image-resize-handle.image-resize-right')
      if (!h) return null
      const r = h.getBoundingClientRect()
      if (r.width === 0) return null
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
    })()`)
    ok('选中后缩放手柄可见', !!handle)

    if (handle) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handle.x, y: handle.y, buttons: 0 })
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed', x: handle.x, y: handle.y, button: 'left', buttons: 1, clickCount: 1,
      })
      for (let i = 1; i <= 6; i++) {
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved', x: handle.x + i * 10, y: handle.y, button: 'left', buttons: 1,
        })
        await sleep(50)
      }
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: handle.x + 60, y: handle.y, button: 'left', buttons: 0, clickCount: 1,
      })
      await sleep(800)
    }

    const dragged = await cdp.evaluate<number>(
      `(() => { const f = document.querySelector('figure.image-figure'); return f ? Math.round(f.getBoundingClientRect().width) : 0 })()`,
    )
    ok('拖拽后图片变宽', dragged > (figure?.w ?? 0), `${figure?.w} → ${dragged}`)

    // 真保存（不拦截 IPC，让它真的写盘）
    await cdp.focusEditor()
    await cdp.pressKey('s', ['Meta'])
    await sleep(1500)

    // 重新加载页面再打开同一文件，验证宽度真的落盘了
    await cdp.navigate(harness.url)
    await sleep(4000)
    await openFileInTree(cdp, 'feature.md')
    await sleep(1200)
    const reloaded = await cdp.evaluate<number>(
      `(() => { const f = document.querySelector('figure.image-figure'); return f ? Math.round(f.getBoundingClientRect().width) : 0 })()`,
    )
    ok(
      '重新打开后图片宽度保持不变（宽度已落盘）',
      reloaded > 0 && Math.abs(reloaded - dragged) <= 2,
      `拖拽后 ${dragged}px → 重新打开 ${reloaded}px`,
    )
  }
} catch (e) {
  failures++
  console.error(`✘ 功能测试异常终止: ${String(e)}`)
} finally {
  await cdp.close()
  harness.stop()
}

console.log(failures ? `\nFAILED (${failures})` : '\nOK')
process.exitCode = failures ? 1 : 0
