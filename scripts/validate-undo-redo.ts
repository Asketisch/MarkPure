/**
 * 撤销 / 重做的端到端回归测试。
 *
 * `validate-undo-tree.ts` 只测了撤销树插件的**纯逻辑**（分支拓扑、
 * 剪枝），从没测过「真的按一次撤销会发生什么」——于是
 * `handleUndo` / `handleRedo` 完全失效也没人知道。
 *
 * 这里驱动**应用自己的 Edit 菜单**（而不是键盘快捷键）：真实桌面
 * 应用里系统原生菜单会与 WebView 抢快捷键，菜单项才是稳定的入口。
 *
 * 运行：
 *
 *   npx tsx scripts/validate-undo-redo.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { startHarness, openFileInTree, sleep, CdpClient, findChrome } from './lib/browser-harness'

const DOC = '# 撤销回归\n\n原始段落。\n'

/** 在页面里读编辑器的纯文本。 */
function readEditor(cdp: CdpClient): Promise<string> {
  return cdp.evaluate<string>(`(() => {
    const el = document.querySelector('.ProseMirror')
    return el ? el.innerText : ''
  })()`)
}

/** 点开应用自己的 Edit 菜单并点击其中一项。 */
async function clickEditMenuItem(cdp: CdpClient, label: string): Promise<boolean> {
  await cdp.evaluate(`(() => {
    const btns = [...document.querySelectorAll('.menu-btn')]
    const edit = btns.find(b => (b.textContent || '').trim() === 'Edit')
    if (edit) edit.click()
    return true
  })()`)
  await sleep(400)
  return cdp.evaluate<boolean>(`(() => {
    const items = [...document.querySelectorAll('.dropdown-item')]
    const it = items.find(b => (b.textContent || '').trim() === ${JSON.stringify(label)})
    if (!it) return false
    it.click()
    return true
  })()`)
}

test('Edit 菜单的 Undo / Redo 真的改变编辑器内容', async (t) => {
  const chromePath = findChrome()
  if (!chromePath) {
    t.skip('没有 Chrome，跳过')
    return
  }
  const harness = await startHarness({ files: { 'undo.md': DOC } })
  const cdp = await CdpClient.launch(
    chromePath,
    `${harness.workspaceDir}/chrome-profile`,
    5200 + Math.floor(Math.random() * 90),
  )
  try {
    await cdp.navigate(harness.url)
    await sleep(1500)
    const opened = await openFileInTree(cdp, 'undo.md')
    assert.ok(opened, '文件应当能打开')

    // 在编辑器末尾输入一段可辨识的文字。
    await cdp.evaluate(`(() => {
      const el = document.querySelector('.ProseMirror')
      el.focus()
      const sel = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(false)
      sel.removeAllRanges()
      sel.addRange(range)
      return true
    })()`)
    const marker = '撤销标记XYZ'
    await cdp.insertText(marker)
    await sleep(1200)
    assert.ok(
      (await readEditor(cdp)).includes(marker),
      '输入后应当能看到标记',
    )

    // 撤销 → 标记应当消失。
    assert.ok(await clickEditMenuItem(cdp, 'Undo'), 'Edit 菜单里应当有 Undo')
    await sleep(1200)
    assert.ok(
      !(await readEditor(cdp)).includes(marker),
      '撤销后标记应当消失',
    )

    // 重做 → 标记应当回来。
    assert.ok(await clickEditMenuItem(cdp, 'Redo'), 'Edit 菜单里应当有 Redo')
    await sleep(1200)
    assert.ok(
      (await readEditor(cdp)).includes(marker),
      '重做后标记应当回来',
    )
  } finally {
    await cdp.close()
    harness.stop()
  }
})
