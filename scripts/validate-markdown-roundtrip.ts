/**
 * Markdown 往返（解析 → 序列化）测试。
 *
 * ## 为什么需要它
 *
 * 显示层最危险的一类 bug 是**数据丢失**：文档在编辑器里打开后，
 * 某些块（代码块、frontmatter……）被静默丢弃，用户一保存，磁盘上的
 * 原文就被改写。这类 bug 在肉眼看界面时很难发现——界面只是「少显示
 * 了一块东西」——但它是不可逆的数据损坏。
 *
 * 本脚本用 `@tiptap/markdown` 的 `MarkdownManager` 直接跑「Markdown
 * → ProseMirror JSON → Markdown」的往返，不需要浏览器、不需要 GUI，
 * 因此可以在每次改动后秒级回归。
 *
 * 它使用的扩展集与 `frontend/src/editor/editor.ts` 保持一致——包括
 * 关闭 StarterKit 内置 CodeBlock（改用 CodeMirror 版）这个关键细节，
 * 因为「谁认领 marked 的 `code` token」正是代码块丢失的根因。
 *
 * 运行方式：
 *
 *   npx tsx scripts/validate-markdown-roundtrip.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { getSchema } from '@tiptap/core'
import { Node as PMNode } from '@tiptap/pm/model'
import { MarkdownManager } from '@tiptap/markdown'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import StarterKit from '@tiptap/starter-kit'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import { Link } from '@tiptap/extension-link'
import Code from '@tiptap/extension-code'
import { marked } from 'marked'
import Bold from '@tiptap/extension-bold'
import { Highlight } from '@tiptap/extension-highlight'

import { CodeBlockCMExtension } from '../frontend/src/extensions/blocks/code-block-cm-extension'
import { FrontmatterExtension } from '../frontend/src/extensions/blocks/frontmatter-extension'
import { MarkdownTable } from '../frontend/src/extensions/blocks/table-extension'
import { MathExtension } from '../frontend/src/extensions/blocks/math-extension'
import { normalizeListContinuations } from '../frontend/src/editor/markdown-normalize'

/**
 * 与 `createEditor` 保持一致的扩展集（只保留影响 Markdown 往返的
 * 那些）。**关键点**：`codeBlock: false` 与 `link: false` —— 前者
 * 让内置 CodeBlock 不再认领 `code` token（因此必须由项目内的
 * `CodeBlockCMExtension` 提供钩子），后者避免与显式注册的 Link
 * 重名。
 */
function buildManager(): MarkdownManager {
  // 与应用一致：创建 manager 前重置全局 marked 的扩展列表
  const ext = (marked as any).defaults?.extensions
  if (ext) {
    for (const k of ['block', 'inline', 'startBlock', 'startInline']) {
      if (Array.isArray(ext[k])) ext[k].length = 0
    }
  }
  return new MarkdownManager({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        codeBlock: false,
        link: false,
        bold: false,
      }),
      Link.configure({ openOnClick: false }),
      // 与应用一致：Bold 标记单独注册（去掉内置 Mod-b 快捷键）。
      // 若只写 `bold: false` 而不补回 Bold，`**粗体**` 会在序列化时
      // 丢掉标记——往返结果是纯文本。
      Bold.extend({
        addKeyboardShortcuts() {
          return {}
        },
      }),
      Highlight,
      TaskList,
      TaskItem.configure({ nested: true }),
      MarkdownTable,
      TableRow,
      TableCell,
      TableHeader,
      CodeBlockCMExtension,
      FrontmatterExtension,
      MathExtension,
    ],
  } as never)
}

/** 与编辑器完全相同的扩展集（用于构造真实的 schema）。 */
const SCHEMA_EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3, 4, 5, 6] },
    codeBlock: false,
    code: false,
    link: false,
    bold: false,
  }),
  Link.configure({ openOnClick: false }),
  Bold.extend({
    addKeyboardShortcuts() {
      return {}
    },
  }),
  Code.extend({
    excludes: '',
    addAttributes() {
      return {
        doubleBacktick: {
          default: false,
          parseHTML: (element: HTMLElement) => element.getAttribute('data-double-backtick') === 'true',
          renderHTML: (attributes: Record<string, unknown>) =>
            attributes.doubleBacktick ? { 'data-double-backtick': 'true' } : {},
        },
        padSpaces: {
          default: false,
          parseHTML: (element: HTMLElement) => element.getAttribute('data-pad-spaces') === 'true',
          renderHTML: (attributes: Record<string, unknown>) =>
            attributes.padSpaces ? { 'data-pad-spaces': 'true' } : {},
        },
      }
    },
    parseMarkdown: (token: any, helpers: any) => {
      const text = (token?.text ?? '') as string
      const needsDouble = text.includes('`')
      // 去掉尾随空白后再判断：内容 ``Cmd/Ctrl + ` `` 解析出来是
      // "Cmd/Ctrl + ` "（结尾是「反引号+空格」），直接看 endsWith('`')
      // 会漏判，序列化时就会因为分隔符与内容里的反引号相邻而产生歧义。
      const needsPad =
        text.trimEnd().endsWith('`') || text.trimStart().startsWith('`')
      const attrs = needsDouble ? { doubleBacktick: true, ...(needsPad ? { padSpaces: true } : {}) } : undefined
      return helpers.applyMark('code', [{ type: 'text', text }], attrs)
    },
    renderMarkdown: (node: any, h: any) => {
      const body = (node.content ? (h.renderChildren(node.content) as string) : (node.text ?? '')) as string
      if (!body) return ''
      const delim = node.attrs?.doubleBacktick ? '``' : '`'
      const inner = node.attrs?.padSpaces ? ' ' + body + ' ' : body
      return delim + inner + delim
    },
  }),
  Highlight,
  TaskList,
  TaskItem.configure({ nested: true }),
  MarkdownTable,
  TableRow,
  TableCell,
  TableHeader,
  CodeBlockCMExtension,
  FrontmatterExtension,
  MathExtension,
] as never

/** 编辑器真正使用的 schema。 */
const SCHEMA = getSchema(SCHEMA_EXTENSIONS)

/** Markdown → ProseMirror JSON。 */
function parse(md: string): any {
  // 与应用一致：解析前先修正列表续行的缩进
  return buildManager().parse(normalizeListContinuations(md))
}

/**
 * 用真实 schema 校验解析结果。
 *
 * 这一步能抓住「往返测试抓不到」的一类 bug：某个节点类型没有声明
 * `group: 'block'` 时，它无法作为文档的子节点，**整篇文档就变成
 * 非法文档**——ProseMirror 会在运行时抛
 * “Called contentMatchAt on a node with invalid content”，而
 * 往返测试（只看文本）完全看不出问题。
 */
function assertValidDocument(md: string, label: string) {
  const json = parse(md)
  const doc = PMNode.fromJSON(SCHEMA, json)
  try {
    doc.check()
  } catch (e) {
    throw new Error(
      `${label}: 解析结果不是合法文档（${(e as Error).message}）\n` +
        `顶层节点: ${json.content.map((n: any) => n.type).join(', ')}`,
    )
  }
}

/** ProseMirror JSON → Markdown。 */
function serialize(json: any): string {
  return buildManager().serialize(json)
}

/** 走一遍完整往返。 */
function roundtrip(md: string): string {
  return serialize(parse(md))
}

// ==================================================================== 代码块

test('围栏代码块被保留（曾经被静默丢弃）', () => {
  const md = '# Title\n\n```rust\nfn main() {\n    println!("hi");\n}\n```\n'
  const out = roundtrip(md)
  assert.ok(out.includes('```rust'), `代码块围栏丢失:\n${out}`)
  assert.ok(out.includes('fn main()'), `代码块内容丢失:\n${out}`)
})

test('无语言围栏也保留', () => {
  const md = '```\nplain text\n```\n'
  const out = roundtrip(md)
  assert.ok(out.includes('plain text'), out)
  assert.ok(out.includes('```'), out)
})

test('多个代码块都保留', () => {
  const md = '```js\nconst a = 1\n```\n\n```py\nprint(2)\n```\n'
  const out = roundtrip(md)
  assert.ok(out.includes('const a = 1'), out)
  assert.ok(out.includes('print(2)'), out)
})

test('代码块内的空行与缩进保留', () => {
  const md = '```js\nfunction f() {\n\n  return 1\n}\n```\n'
  const out = roundtrip(md)
  assert.ok(out.includes('function f() {'), out)
  assert.ok(out.includes('  return 1'), out)
})

test('含代码块的文档是合法文档（节点必须在 block 组里）', () => {
  // 回归用例：项目的 codeBlock 扩展一度漏了 `group: 'block'`，
  // 于是任何含代码围栏的文档都是非法文档，编辑器会在运行时抛
  // “Called contentMatchAt on a node with invalid content”。
  assertValidDocument('# H\n\n```rust\nfn main() {}\n```\n', 'code block')
  assertValidDocument('```\nplain\n```\n', 'bare code block')
  assertValidDocument('> quote\n\n```js\nconst a = 1\n```\n', 'code block after quote')
})

test('含公式的文档是合法文档', () => {
  assertValidDocument('inline $E = mc^2$ end\n', 'inline math')
  assertValidDocument('$$\na^2 + b^2 = c^2\n$$\n', 'block math')
})

test('含 frontmatter 的文档是合法文档', () => {
  assertValidDocument('---\ntitle: X\n---\n\nbody\n', 'frontmatter')
})

test('代码块是 codeBlock 节点而不是段落', () => {
  const json = parse('```rust\nlet x = 1;\n```\n')
  const types = json.content.map((n: any) => n.type)
  assert.ok(types.includes('codeBlock'), `期望 codeBlock 节点，实际: ${types.join(', ')}`)
})

// ==================================================================== Frontmatter

test('YAML frontmatter 完整保留（曾经被改写成标题）', () => {
  const md = '---\ntitle: Welcome\ntags: [demo, guide]\n---\n\n# Body\n'
  const out = roundtrip(md)
  assert.ok(out.startsWith('---'), `frontmatter 起始围栏丢失:\n${out}`)
  assert.ok(out.includes('title: Welcome'), `frontmatter 内容丢失:\n${out}`)
  assert.ok(out.includes('tags: [demo, guide]'), `frontmatter 内容丢失:\n${out}`)
  assert.ok(out.includes('# Body'), `正文丢失:\n${out}`)
})

test('frontmatter 是 frontmatter 节点', () => {
  const json = parse('---\ntitle: X\n---\n\nbody\n')
  assert.equal(json.content[0].type, 'frontmatter')
})

test('frontmatter 后紧跟正文也能往返', () => {
  const md = '---\na: 1\n---\n正文第一段\n'
  const out = roundtrip(md)
  assert.ok(out.includes('a: 1'), out)
  assert.ok(out.includes('正文第一段'), out)
})

test('文档中间的 --- 仍然是水平线 / setext 标题', () => {
  // frontmatter 只在**文档开头**成立。中部的 `---` 不能被吃掉。
  const md = '# Title\n\n---\n\n正文\n'
  const json = parse(md)
  const types = json.content.map((n: any) => n.type)
  assert.ok(!types.includes('frontmatter'), `中部的 --- 被误判为 frontmatter: ${types.join(', ')}`)
})

test('没有 frontmatter 的普通文档不受影响', () => {
  const md = '# Title\n\n正文\n'
  const json = parse(md)
  assert.ok(!json.content.some((n: any) => n.type === 'frontmatter'))
})

// ==================================================================== 数学公式

test('块级公式 $$…$$ 被识别为公式节点', () => {
  const json = parse('$$\n\\int_0^\\infty e^{-x^2} dx\n$$\n')
  const types = json.content.map((n: any) => n.type)
  assert.ok(types.includes('blockMath'), `期望 blockMath 节点，实际: ${types.join(', ')}`)
})

test('块级公式往返保留', () => {
  const md = '$$\nE = mc^2\n$$\n'
  const out = roundtrip(md)
  assert.ok(out.includes('$$'), out)
  assert.ok(out.includes('E = mc^2'), out)
})

test('行内公式 $…$ 被识别为行内公式节点', () => {
  const json = parse('inline $E = mc^2$ end\n')
  // 行内公式是段落内部的子节点，不是顶层块。
  const inline = json.content
    .flatMap((n: any) => n.content ?? [])
    .map((n: any) => n.type)
  assert.ok(inline.includes('inlineMath'), `期望 inlineMath 节点，实际: ${inline.join(', ')}`)
})

test('行内公式往返保留', () => {
  const out = roundtrip('inline $E = mc^2$ end\n')
  assert.ok(out.includes('$E = mc^2$'), out)
})

test('普通美元符号不会被当成公式', () => {
  const out = roundtrip('价格是 $5 和 $10。\n')
  assert.ok(out.includes('$5'), out)
  assert.ok(out.includes('$10'), out)
})

// ==================================================================== 其它块

test('表格往返', () => {
  const md = '| a | b |\n| --- | --- |\n| 1 | 2 |\n'
  const out = roundtrip(md)
  assert.ok(out.includes('| a | b |'), out)
  assert.ok(out.includes('| 1 | 2 |'), out)
})

test('任务列表往返', () => {
  const md = '- [x] done\n- [ ] todo\n'
  const out = roundtrip(md)
  assert.ok(out.includes('[x]') || out.includes('- [x]'), out)
  assert.ok(out.includes('done'), out)
  assert.ok(out.includes('todo'), out)
})

test('标题、列表、引用、链接往返', () => {
  const md = '# H1\n\n## H2\n\n- item\n\n> quote\n\n[link](https://example.com)\n'
  const out = roundtrip(md)
  assert.ok(out.includes('# H1'), out)
  assert.ok(out.includes('## H2'), out)
  assert.ok(out.includes('- item'), out)
  assert.ok(out.includes('> quote'), out)
  assert.ok(out.includes('[link](https://example.com)'), out)
})

test('行内代码与强调往返', () => {
  const md = 'Some **bold** and `code` and *italic*.\n'
  const out = roundtrip(md)
  assert.ok(out.includes('**bold**'), out)
  assert.ok(out.includes('`code`'), out)
  assert.ok(out.includes('*italic*'), out)
})

// ==================================================================== 组合场景

test('真实文档：frontmatter + 代码块 + 表格 一起往返', () => {
  const md = [
    '---',
    'title: Welcome',
    'tags: [demo, guide]',
    '---',
    '',
    '# Welcome to MarkPure',
    '',
    'This is a **WYSIWYG** markdown editor.',
    '',
    '## Table',
    '',
    '| Feature | Status |',
    '| --- | --- |',
    '| Tables | yes |',
    '',
    '## Code',
    '',
    '```rust',
    'fn main() {',
    '    println!("hello");',
    '}',
    '```',
    '',
    '> A quote with a `code span`.',
    '',
  ].join('\n')

  const out = roundtrip(md)

  // 逐项断言：每一块都必须还在。
  assert.ok(out.startsWith('---'), `frontmatter 丢失:\n${out}`)
  assert.ok(out.includes('title: Welcome'), `frontmatter 丢失:\n${out}`)
  assert.ok(out.includes('tags: [demo, guide]'), `frontmatter 丢失:\n${out}`)
  assert.ok(out.includes('# Welcome to MarkPure'), `标题丢失:\n${out}`)
  assert.ok(out.includes('**WYSIWYG**'), `强调丢失:\n${out}`)
  assert.ok(out.includes('| Feature | Status |'), `表头丢失:\n${out}`)
  assert.ok(out.includes('| Tables | yes |'), `表格行丢失:\n${out}`)
  assert.ok(out.includes('```rust'), `代码块围栏丢失:\n${out}`)
  assert.ok(out.includes('fn main() {'), `代码块内容丢失:\n${out}`)
  assert.ok(out.includes('println!("hello");'), `代码块内容丢失:\n${out}`)
  assert.ok(out.includes('> A quote with a `code span`.'), `引用丢失:\n${out}`)
})

test('空文档往返为空', () => {
  const out = roundtrip('')
  assert.ok(out.trim() === '' || out.trim() === '---', out)
})


// ==================================================================== 语料扫描

/**
 * 仓库里所有 Markdown 文档的语料扫描。
 *
 * 单元用例只能覆盖我们**想得到**的写法；语料扫描覆盖的是真实文件。
 * 它一次性检查三件事：
 *
 *  1. **合法性** —— 解析结果必须是一篇合法文档（`doc.check()`）。
 *     节点的 `group` 漏声明之类的 schema 问题在这里会暴露。
 *  2. **幂等性** —— 解析→序列化→再解析→再序列化，两次结果必须一致。
 *     不一致说明往返在某处会悄悄改变内容（改写 frontmatter、
 *     丢掉代码块、表格被重排……）。
 *  3. **不丢内容** —— 往返前后可见文本的字符集合不能减少。
 */
const REPO_ROOT = path.resolve(import.meta.dirname ?? '.', '..')
const SKIP_DIRS = new Set(['node_modules', 'target', '.git', 'graphify-out', 'dist'])

function collectMarkdown(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue
    const full = path.join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) collectMarkdown(full, out)
    else if (entry.endsWith('.md')) out.push(full)
  }
  return out
}

/**
 * 文档的**块结构**（按类型计数）。
 *
 * 比字符数更准确：markdown 序列化本来就会规范化排版（表格分隔行
 * `| --- |` → `|---|`、列表标记、空白等），文字字符数变化属正常。
 * 而「代码块 / 公式 / frontmatter / 表格 / 列表项」这些**块**如果
 * 在往返中消失，就是真正的内容丢失——这才是要防的。
 */
function blockCounts(md: string): Record<string, number> {
  const counts: Record<string, number> = {}
  const doc = PMNode.fromJSON(SCHEMA, parse(md))
  doc.descendants((node: any) => {
    if (node.isText) return true
    const name = node.type.name
    counts[name] = (counts[name] ?? 0) + 1
    return true
  })
  return counts
}

test('仓库内所有 Markdown 文档都能解析成合法文档', () => {
  const files = collectMarkdown(REPO_ROOT)
  assert.ok(files.length > 0, '没有找到任何 .md 文件')

  const failures: string[] = []
  for (const file of files) {
    const md = readFileSync(file, 'utf8')
    try {
      const json = parse(md)
      const doc = PMNode.fromJSON(SCHEMA, json)
      doc.check()
    } catch (e) {
      failures.push(`${path.relative(REPO_ROOT, file)}: ${(e as Error).message}`)
    }
  }
  assert.deepEqual(failures, [], `以下文档不是合法文档:\n${failures.join('\n')}`)
})

test('仓库内所有 Markdown 文档往返幂等（不会越往返越变形）', () => {
  const files = collectMarkdown(REPO_ROOT)
  const failures: string[] = []
  for (const file of files) {
    const md = readFileSync(file, 'utf8')
    try {
      const once = serialize(parse(md))
      const twice = serialize(parse(once))
      // 幂等的判据是**文档不再变化**，而不是字节完全一致：
      // Markdown 序列化会做等价的规范化（例如 ``a`` → `a`、
      // 行尾空白增删），这些都不算「越往返越变形」。因此比较的是
      // 两次结果的**解析后文档**（块结构 + 文字内容）。
      const docOnce = PMNode.fromJSON(SCHEMA, parse(once))
      const docTwice = PMNode.fromJSON(SCHEMA, parse(twice))
      if (
        docOnce.textContent !== docTwice.textContent ||
        JSON.stringify(blockCounts(once)) !== JSON.stringify(blockCounts(twice))
      ) {
        failures.push(
          `${path.relative(REPO_ROOT, file)}: 往返后文档仍在变化`,
        )
      }
    } catch (e) {
      failures.push(`${path.relative(REPO_ROOT, file)}: ${(e as Error).message}`)
    }
  }
  assert.deepEqual(failures, [], `以下文档往返不幂等:\n${failures.join('\n')}`)
})

test('仓库内所有 Markdown 文档往返不丢内容', () => {
  const files = collectMarkdown(REPO_ROOT)
  const failures: string[] = []
  for (const file of files) {
    const md = readFileSync(file, 'utf8')
    try {
      const before = blockCounts(md)
      const after = blockCounts(serialize(parse(md)))
      // 判据：往返后每一种块的数量都不能减少。允许数量增加
      // （例如列表被拆成更多段落），但不允许任何块消失。
      for (const [type, n] of Object.entries(before)) {
        if ((after[type] ?? 0) < n) {
          failures.push(
            `${path.relative(REPO_ROOT, file)}: ${type} 从 ${n} 块变成 ` +
              `${after[type] ?? 0} 块`,
          )
        }
      }
    } catch (e) {
      failures.push(`${path.relative(REPO_ROOT, file)}: ${(e as Error).message}`)
    }
  }
  assert.deepEqual(failures, [], `以下文档往返丢了内容:\n${failures.join('\n')}`)
})
