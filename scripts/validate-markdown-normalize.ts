/**
 * 列表续行缩进修正的回归测试。
 *
 * 背景：marked 在解析「缩进 1 个空格的列表续行」时会把行内标记弄坏
 * （行内代码丢开引号、`**粗体**` 变斜体、`[链接](url)` 丢 `[`）。
 * `frontend/src/editor/markdown-normalize.ts` 在解析前把这类续行
 * 重新缩进，绕开该缺陷。
 *
 * 运行：npx tsx scripts/validate-markdown-normalize.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { MarkdownManager } from '@tiptap/markdown'
import { marked } from 'marked'
import StarterKit from '@tiptap/starter-kit'
import { Link } from '@tiptap/extension-link'
import Bold from '@tiptap/extension-bold'

import { normalizeListContinuations } from '../frontend/src/editor/markdown-normalize'

const EXTS = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3, 4, 5, 6] },
    codeBlock: false,
    link: false,
    bold: false,
  }),
  Link.configure({ openOnClick: false }),
  Bold.extend({
    addKeyboardShortcuts() {
      return {}
    },
  }),
] as never

function manager(): MarkdownManager {
  // 与应用一致：创建 manager 前重置全局 marked 的扩展列表
  const ext = (marked as any).defaults?.extensions
  if (ext) {
    for (const k of ['block', 'inline', 'startBlock', 'startInline']) {
      if (Array.isArray(ext[k])) ext[k].length = 0
    }
  }
  return new MarkdownManager({ extensions: EXTS } as never)
}

/** 解析并取出列表项第一段的行内节点描述。 */
function firstItemInline(md: string): string[] {
  const json = manager().parse(md)
  const item = (json.content?.[0] as any)?.content?.[0]
  const nodes = item?.content?.[0]?.content ?? []
  return nodes.map((n: any) => n.text + (n.marks ? '{' + n.marks.map((x: any) => x.type).join(',') + '}' : ''))
}

test('懒续行的行内代码不再丢开引号', () => {
  const md = '1. 列表项 `a` 文本\n `code` 字段'
  const before = firstItemInline(md)
  const after = firstItemInline(normalizeListContinuations(md))
  assert.ok(before.some((t) => t.includes('code`')), '前置条件：原样解析应当是坏的')
  assert.ok(after.includes('code{code}'), `修正后应保留行内代码: ${JSON.stringify(after)}`)
})

test('懒续行的粗体不再变成斜体', () => {
  const md = '1. 列表项 `a` 文本\n **粗体** 尾巴'
  const after = firstItemInline(normalizeListContinuations(md))
  assert.ok(after.includes('粗体{bold}'), `修正后应保留粗体: ${JSON.stringify(after)}`)
})

test('懒续行的链接不再丢开括号', () => {
  const md = '1. 列表项 `a` 文本\n [链接](https://example.com)'
  const after = firstItemInline(normalizeListContinuations(md))
  assert.ok(after.includes('链接{link}'), `修正后应保留链接: ${JSON.stringify(after)}`)
})

test('缩进 2/3/4 个空间的续行本来就没问题，修正后内容仍然完好', () => {
  for (const indent of [2, 3, 4]) {
    const md = '1. 列表项 `a` 文本\n' + ' '.repeat(indent) + '`code` 字段'
    const after = firstItemInline(normalizeListContinuations(md))
    assert.ok(after.includes('code{code}'), `缩进 ${indent} 的行内代码应完好: ${JSON.stringify(after)}`)
  }
})

test('缩进 3（=内容缩进）的续行完全不被改动', () => {
  const md = '1. 列表项 `a` 文本\n   `code` 字段'
  assert.equal(normalizeListContinuations(md), md)
})

test('围栏代码块内部原样不动', () => {
  const md = ['```js', '1. 项目 `a`', ' `code` 字段', '```'].join('\n')
  assert.equal(normalizeListContinuations(md), md)
})

test('普通段落与顶级列表不受影响', () => {
  const md = '标题\n\n段落里有 `code`\n\n- 列表项\n- 另一个'
  assert.equal(normalizeListContinuations(md), md)
})

test('嵌套列表的续行也会被修正', () => {
  const md = '1. 外层\n   - 内层 `a`\n    `code` 字段'
  const after = normalizeListContinuations(md)
  assert.ok(after.includes('    `code` 字段'), after)
})
