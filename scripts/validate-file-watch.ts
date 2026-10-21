/**
 * 文件监视的端到端回归测试。
 *
 * 文件监视是 Markdown 编辑器最关键的协作场景之一：用户在外部编辑器
 * 改��同一个文件，编辑器这边必须感知到——要么静默刷新内容，要么
 * 弹「文件已外部修改」询问。
 *
 * 真实桌面应用里这条链路是：Rust `notify` → 事件循环 →
 * `evaluate_script` → `window.__mt_on_file_changes` → 前端处理器。
 * 浏览器 harness 用 IPC 桥的轮询模拟同一条链路（`ipcPoll: true`）。
 *
 * 运行：
 *
 *   npx tsx scripts/validate-file-watch.ts
 */

import { writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import { startHarness, openFileInTree, sleep, CdpClient, findChrome } from './lib/browser-harness'

const DOC = `# 监视测试

原始内容。

## 小节

一些正文。
`

test('外部修改已打开的文件后，编辑器应当感知到变化', async (t) => {
  const chromePath = findChrome()
  if (!chromePath) {
    t.skip('没有 Chrome，跳过')
    return
  }
  const harness = await startHarness({
    files: { '监视.md': DOC },
    ipcPoll: true,
  })
  const cdp = await CdpClient.launch(
    chromePath,
    `${harness.workspaceDir}/chrome-profile`,
    4700 + Math.floor(Math.random() * 90),
  )
  try {
    await cdp.navigate(harness.url)
    await sleep(1500)

    const opened = await openFileInTree(cdp, '监视.md')
    assert.ok(opened, '文件应当能打开')

    // 记录打开时的编辑器内容。
    const before = await cdp.evaluate<string>(`(() => {
      const el = document.querySelector('.ProseMirror')
      return el ? el.innerText : ''
    })()`)
    assert.ok(before.includes('原始内容'), `打开后应看到原文: ${before.slice(0, 200)}`)

    // 从磁盘外部修改。
    const file = join(harness.workspaceDir, '监视.md')
    writeFileSync(file, DOC + '\n外部追加的段落。\n', 'utf-8')

    // 轮询等待编辑器内容变化（IPC 桥每秒轮询一次，最多等 15 秒）。
    let after = before
    for (let i = 0; i < 30; i++) {
      await sleep(500)
      after = await cdp.evaluate<string>(`(() => {
        const el = document.querySelector('.ProseMirror')
        return el ? el.innerText : ''
      })()`)
      if (after.includes('外部追加的段落')) break
    }
    assert.ok(
      after.includes('外部追加的段落'),
      `外部修改后编辑器应当刷新，实际内容: ${after.slice(0, 400)}`,
    )
  } finally {
    await cdp.close()
    harness.stop()
  }
})

test('桌面宿主传 JSON 字符串时也能正确处理（真实桌面的载荷形态）', async (t) => {
  // 桌面宿主用 `window.__mt_on_file_changes('[{…}]')` 传 **JSON 字符串**
  // （Rust 侧把已转义的 JSON 用单引号包住，避免二次转义）。此前前端
  // 把它当数组用——`event.path` 永远是 undefined，于是「已打开的文档
  // 在外部被修改后刷新」这条链路完全失效。浏览器 harness 的 IPC 桥
  // 传的是真数组，因此掩盖了这个缺陷。
  const chromePath = findChrome()
  if (!chromePath) {
    t.skip('没有 Chrome，跳过')
    return
  }
  const harness = await startHarness({
    files: { '字符串载荷.md': DOC },
    ipcPoll: true,
  })
  const cdp = await CdpClient.launch(
    chromePath,
    `${harness.workspaceDir}/chrome-profile`,
    4900 + Math.floor(Math.random() * 90),
  )
  try {
    await cdp.navigate(harness.url)
    await sleep(1500)
    const opened = await openFileInTree(cdp, '字符串载荷.md')
    assert.ok(opened, '文件应当能打开')

    const file = join(harness.workspaceDir, '字符串载荷.md')
    const event = {
      workspace_id: 'w1',
      path: file,
      kind: 'modified',
    }
    writeFileSync(file, DOC + '\n字符串载荷追加。\n', 'utf-8')
    // 模拟真实桌面宿主：传 JSON **字符串**。
    await cdp.evaluate(`(() => {
      const payload = JSON.stringify([${JSON.stringify(event)}])
      window.__mt_on_file_changes(payload)
      return true
    })()`)

    let after = ''
    for (let i = 0; i < 30; i++) {
      await sleep(500)
      after = await cdp.evaluate<string>(`(() => {
        const el = document.querySelector('.ProseMirror')
        return el ? el.innerText : ''
      })()`)
      if (after.includes('字符串载荷追加')) break
    }
    assert.ok(
      after.includes('字符串载荷追加'),
      `字符串载荷的事件应被正确处理，实际内容: ${after.slice(0, 400)}`,
    )
  } finally {
    await cdp.close()
    harness.stop()
  }
})

test('外部新建文件后，文件树应当出现新条目', async (t) => {
  const chromePath = findChrome()
  if (!chromePath) {
    t.skip('没有 Chrome，跳过')
    return
  }
  const harness = await startHarness({
    files: { 'a.md': DOC },
    ipcPoll: true,
  })
  const cdp = await CdpClient.launch(
    chromePath,
    `${harness.workspaceDir}/chrome-profile`,
    4800 + Math.floor(Math.random() * 90),
  )
  try {
    await cdp.navigate(harness.url)
    await sleep(1500)
    writeFileSync(join(harness.workspaceDir, 'b.md'), '# 新文件\n', 'utf-8')

    let names = ''
    for (let i = 0; i < 30; i++) {
      await sleep(500)
      names = await cdp.evaluate<string>(`(() => {
        const el = document.querySelector('.tree') || document.body
        return el.innerText || ''
      })()`)
      if (names.includes('b.md')) break
    }
    assert.ok(names.includes('b.md'), `文件树应出现新文件: ${names.slice(0, 300)}`)
  } finally {
    await cdp.close()
    harness.stop()
  }
})
