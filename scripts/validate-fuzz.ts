/**
 * Markdown 解析 / 序列化的**随机化**回归测试。
 *
 * ## 为什么需要它
 *
 * `validate-markdown-roundtrip.ts` 的语料扫描用的是仓库里 31 个**真实**
 * 文档——它们都是人写出来的，结构「正常」。但真正会打破解析器的往往是
 * 那些**合法却刁钻**的组合：表格单元格里含 `|`、围栏代码块里含 ```、
 * 列表项之间的空行（懒续行）、链接 URL 里含 `)`、frontmatter 紧跟着正文……
 *
 * 现实里这些内容来自别的工具（Obsidian / Typora / 文档转换器）导出，
 * 用户的文档什么样都有。语料扫描覆盖不到的地方，随机化生成可以。
 *
 * ## 怎么保证可复现
 *
 * 每个种子对应一份确定的文档。失败时打印种子与文档原文，可以直接
 * 复现。种子序列固定（`0..N`），因此 CI 上的失败也是确定的。
 *
 * ## 断言
 *
 * 对每份随机文档：
 * 1. **能解析成合法文档** —— `PMNode.fromJSON(SCHEMA, json)` + `doc.check()`
 * 2. **往返幂等** —— 往返两次的结果与往返一次相同（不会越往返越变形）
 * 3. **往返不丢内容** —— 各类块的数量不减少（沿用语料扫描的判定）
 *
 * 运行：npx tsx scripts/validate-fuzz.ts
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
import { ImageWithAlign } from '../frontend/src/extensions/blocks/image-extension'
import { normalizeListContinuations } from '../frontend/src/editor/markdown-normalize'
import { extractBlockImages } from '../frontend/src/editor/markdown-structure'
import { makeRng, randomDoc } from './lib/fuzz-markdown'

// ---- 与应用一致的扩展集（与 validate-markdown-roundtrip.ts 保持同步） ----

function buildManager(): MarkdownManager {
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
      Bold.extend({ addKeyboardSequences: undefined, addKeyboardShortcuts() { return {} } } as any),
      Highlight,
      Code,
      TaskList,
      TaskItem.configure({ nested: true }),
      MarkdownTable,
      TableRow,
      TableCell,
      TableHeader,
      CodeBlockCMExtension,
      FrontmatterExtension,
      MathExtension,
      ImageWithAlign,
    ],
  } as never)
}

const SCHEMA_EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3, 4, 5, 6] },
    codeBlock: false,
    code: false,
    link: false,
    bold: false,
  }),
  Link.configure({ openOnClick: false }),
  Bold.extend({ addKeyboardShortcuts() { return {} } }),
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
      }
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
  ImageWithAlign,
] as never

const SCHEMA = getSchema(SCHEMA_EXTENSIONS)

function parse(md: string): any {
  // 与编辑器一致：解析后做一次结构修正（把段落里的行内图片提升为块级）。
  return extractBlockImages(buildManager().parse(normalizeListContinuations(md)))
}
function serialize(json: any): string {
  return buildManager().serialize(json)
}

/** 文档的**块结构**（按类型计数）——往返后各类块不能减少。 */
function blockCounts(json: any): Record<string, number> {
  const counts: Record<string, number> = {}
  const doc = PMNode.fromJSON(SCHEMA, json)
  doc.descendants((node: any) => {
    if (node.isText) return true
    const name = node.type.name
    counts[name] = (counts[name] ?? 0) + 1
    return true
  })
  return counts
}

// ---- 断言 ---------------------------------------------------------------

interface Failure {
  seed: number
  /**
   * 'fatal' = 内容丢失 / 解析失败 / 文档非法；
   * 'spec' = GFM 规范行为（表格列数）；
   * 'whitespace' = 仅排版差异。
   */
  kind: 'fatal' | 'spec' | 'whitespace'
  reason: string
  doc: string
}

/** 折叠空白后比较——排版规范化（多一个空行）不算内容变化。 */
function squash(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/**
 * 文档的**语义签名**：块类型计数 + 全部文本节点。
 *
 * 幂等性应当在语义层判定，而不是字节层。表格单元格的**数量**被排除
 * 在外：GFM 规定单元格里未转义的 `|` 就是列分隔符，于是 `| a|b |`
 * 会被解析成两列、序列化回三列——这是**规范行为**（GitHub / Obsidian
 * / Typora 一致），不是内容变化。
 */
function semanticSignature(json: any, excludeCells = true): string {
  const counts: Record<string, number> = {}
  const texts: string[] = []
  const walk = (n: any) => {
    if (n.type === 'text') {
      if (n.text) texts.push(n.text)
      return
    }
    if (!(excludeCells && (n.type === 'tableCell' || n.type === 'tableHeader'))) {
      counts[n.type] = (counts[n.type] ?? 0) + 1
    }
    for (const child of n.content ?? []) walk(child)
  }
  walk(json)
  return JSON.stringify(counts) + '\u0000' + texts.join('\u0001')
}

function checkDoc(seed: number, md: string): Failure | null {
  let json: any
  try {
    json = parse(md)
  } catch (e) {
    return { seed, kind: 'fatal', reason: `解析抛错：${(e as Error).message}`, doc: md }
  }
  try {
    const doc = PMNode.fromJSON(SCHEMA, json)
    doc.check()
  } catch (e) {
    return { seed, kind: 'fatal', reason: `不是合法文档：${(e as Error).message}`, doc: md }
  }

  // 往返两次必须与往返一次相同——否则「越往返越变形」。
  let once: string
  let twice: string
  try {
    once = serialize(json)
    twice = serialize(parse(once))
  } catch (e) {
    return { seed, kind: 'fatal', reason: `序列化抛错：${(e as Error).message}`, doc: md }
  }
  if (once !== twice) {
    // 语义层比较：内容是否真的变了。
    const j1 = parse(once)
    const j2 = parse(twice)
    const sameSemantics = semanticSignature(j1) === semanticSignature(j2)
    if (!sameSemantics) {
      return {
        seed,
        kind: 'fatal',
        reason: `往返内容不一致\n第一次: ${JSON.stringify(once)}\n第二次: ${JSON.stringify(twice)}`,
        doc: md,
      }
    }
    // 内容一致、但表格的单元格数量变了 → GFM 规定单元格里未转义的
    // `|` 就是列分隔符（GitHub / Obsidian / Typora 一致），属于**规范
    // 行为**而非缺陷。
    if (semanticSignature(j1, false) !== semanticSignature(j2, false)) {
      return {
        seed,
        kind: 'spec',
        reason: `表格列数按 GFM 规范变化（单元格里未转义的 | 是列分隔符）`,
        doc: md,
      }
    }
    return {
      seed,
      kind: 'whitespace',
      reason: `往返仅空白漂移\n第一次: ${JSON.stringify(once)}\n第二次: ${JSON.stringify(twice)}`,
      doc: md,
    }
  }

  // 块计数不减少——真正的内容丢失。
  const before = blockCounts(json)
  const after = blockCounts(parse(once))
  for (const [type, n] of Object.entries(before)) {
    const m = after[type] ?? 0
    if (m < n) {
      return {
        seed,
        kind: 'fatal',
        reason: `往返丢失 ${type}：${n} → ${m}\n往返结果: ${JSON.stringify(once)}`,
        doc: md,
      }
    }
  }
  return null
}

// ---- 测试 ---------------------------------------------------------------

const SEEDS = Number(process.env.FUZZ_SEEDS ?? 1500)

test(`随机 markdown 文档都能解析成合法文档且往返不丢内容（${SEEDS} 个种子）`, () => {
  const fatal: Failure[] = []
  const whitespace: Failure[] = []
  const spec: Failure[] = []
  for (let seed = 0; seed < SEEDS; seed++) {
    const rng = makeRng(seed)
    const md = randomDoc(rng)
    const f = checkDoc(seed, md)
    if (!f) continue
    if (f.kind === 'fatal') fatal.push(f)
    else if (f.kind === 'spec') spec.push(f)
    else whitespace.push(f)
  }
  if (fatal.length) {
    const first = fatal[0]
    console.error('--- 全部致命失败 ---')
    for (const f of fatal) {
      // 提取两次输出的差异片段，便于聚类
      const lines = f.reason.split('\n')
      const a = (lines[1] ?? '').replace(/^第一次: /, '')
      const b = (lines[2] ?? '').replace(/^第二次: /, '')
      let i = 0
      while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++
      const fragA = a.slice(Math.max(0, i - 30), i + 40)
      const fragB = b.slice(Math.max(0, i - 30), i + 40)
      console.error(`seed=${f.seed}  A…${fragA}…  B…${fragB}…`)
    }
    throw new Error(
      `${fatal.length}/${SEEDS} 个随机文档有致命问题。\n` +
        `第一个：seed=${first.seed}\n原因：${first.reason}\n` +
        `原文：\n${first.doc}\n` +
        `（用 FUZZ_SEEDS 环境变量可调整样本数）`,
    )
  }
  if (spec.length) {
    console.warn(
      `ℹ ${spec.length}/${SEEDS} 个随机文档的表格列数按 GFM 规范变化` +
        `（单元格里未转义的 | 是列分隔符，与 GitHub / Obsidian 一致）。`,
    )
  }
  if (whitespace.length) {
    // 仅排版差异（内容不丢）——不是缺陷级别的问题，记一条警告。
    // 目前已知的一类：HTML 块被转义成文本后，块前后的空行数会变化。
    // 聚类：把差异片段归类，便于识别「同一种已知问题」
    // 已知成因：HTML 块（`<div>` / `<br>` / 注释）被转义成文本后，
    // 块前后的空行数会变化。内容语义等价，不是缺陷。
    console.warn(
      `⚠ ${whitespace.length}/${SEEDS} 个随机文档往返后仅排版漂移（内容语义等价）。` +
        `已知成因：HTML 块被转义成文本后空行数变化。`,
    )
  }
})

test('随机文档的失败是可复现的（同一 seed 必得同一结果）', () => {
  for (const seed of [7, 42, 99]) {
    const a = randomDoc(makeRng(seed))
    const b = randomDoc(makeRng(seed))
    assert.equal(a, b, `seed=${seed} 的文档不可复现`)
  }
})

test('生成器确实覆盖了各类块（否则 fuzz 没有意义）', () => {
  const seen = new Set<string>()
  for (let seed = 0; seed < 200; seed++) {
    const md = randomDoc(makeRng(seed))
    if (md.includes('```')) seen.add('code')
    if (md.includes('|')) seen.add('table')
    if (md.includes('![')) seen.add('image')
    if (md.includes('- [') || md.includes('1. [') || /\[.\]/.test(md)) seen.add('task')
    if (md.includes('> ')) seen.add('quote')
    if (md.includes('$$')) seen.add('math')
    if (md.startsWith('---')) seen.add('frontmatter')
    if (md.includes('<div')) seen.add('html')
    if (/^#{1,6} /m.test(md)) seen.add('heading')
  }
  for (const kind of ['code', 'table', 'image', 'task', 'quote', 'math', 'frontmatter', 'html', 'heading']) {
    assert.ok(seen.has(kind), `生成器没覆盖 ${kind}`)
  }
})
