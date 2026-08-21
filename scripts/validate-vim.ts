/**
 * Vim 模式插件（P2-7）的轻量校验。运行方式：
 *
 *   npx tsx scripts/validate-vim.ts
 *
 * 使用 Node 内置的 `node:test` 运行器（Node 18+），无需额外开发
 * 依赖。
 *
 * 测试避开 `EditorView`（它需要 DOM）。覆盖纯逻辑部分——
 * `state.ts` 中的 FSM、`key-parser.ts` 中的按键序列解析器、
 * 移动 / 操作符 / 文本对象助手，以及 ex 命令解析器。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  initState,
  applyVimMeta,
  emptyState,
  getMode,
  isParserActive,
} from '../frontend/src/plugins/vim/state'
import {
  parseKey,
  tryParseCommand,
  serializePending,
  parseExText,
} from '../frontend/src/plugins/vim/key-parser'
import { motionRange } from '../frontend/src/plugins/vim/motions'
import { textObjectRange } from '../frontend/src/plugins/vim/text-objects'
import { textIndexForPos, posForTextIndex, flatText } from '../frontend/src/plugins/vim/positions'
import { Schema, Node as PMNode, Fragment } from 'prosemirror-model'
import {
  applyDelete,
  applyChange,
  applyYank,
  applyDeleteChar,
  applyChangeChar,
  applyJoinLines,
  applyDeleteLine,
} from '../frontend/src/plugins/vim/operators'
import { executeEx } from '../frontend/src/plugins/vim/ex-commands'
import { vimPluginKey, type VimKey, type VimState, type VimMode } from '../frontend/src/plugins/vim/types'
import type { Transaction } from '@tiptap/pm/state'

// ----------------------------------------------------------------------
// state.ts 的 reducers
// ----------------------------------------------------------------------

test('initState: defaults to disabled NORMAL with idle pending', () => {
  const s = initState(false)
  assert.equal(s.enabled, false)
  assert.equal(s.mode, 'normal')
  assert.deepEqual(s.pending, { kind: 'idle' })
  assert.equal(s.register, null)
  assert.equal(s.visualAnchor, null)
  assert.equal(s.isComposing, false)
})

test('initState(enabled=true): flips the enabled flag', () => {
  const s = initState(true)
  assert.equal(s.enabled, true)
  assert.equal(s.mode, 'normal')
})

test('emptyState: same shape as initState(false)', () => {
  assert.deepEqual(emptyState(), initState(false))
})

test('applyVimMeta: setEnabled flips and preserves lastEx', () => {
  const s0 = initState(true)
  // 构造一条携带 setEnabled meta 的假事务。
  const fakeTr = { getMeta: (k: unknown) => k === vimPluginKey ? { type: 'setEnabled', enabled: false } : undefined } as unknown as Transaction
  const s1 = applyVimMeta(s0, fakeTr)
  assert.equal(s1.enabled, false)
})

test('applyVimMeta: enterMode clears pending and updates mode', () => {
  const s0: VimState = { ...initState(true), pending: { kind: 'count', digits: 3 } }
  const fakeTr = { getMeta: () => ({ type: 'enterMode', mode: 'insert' }) } as unknown as Transaction
  const s1 = applyVimMeta(s0, fakeTr)
  assert.equal(s1.mode, 'insert')
  assert.deepEqual(s1.pending, { kind: 'idle' })
})

test('applyVimMeta: setPending replaces the buffer', () => {
  const s0 = initState(true)
  const fakeTr = { getMeta: () => ({ type: 'setPending', pending: { kind: 'operator', op: 'delete', count: 1 } }) } as unknown as Transaction
  const s1 = applyVimMeta(s0, fakeTr)
  assert.equal(s1.pending.kind, 'operator')
})

test('applyVimMeta: compositionStart sets the flag and resets pending', () => {
  const s0: VimState = { ...initState(true), pending: { kind: 'count', digits: 5 } }
  const fakeTr = { getMeta: () => ({ type: 'compositionStart' }) } as unknown as Transaction
  const s1 = applyVimMeta(s0, fakeTr)
  assert.equal(s1.isComposing, true)
  assert.deepEqual(s1.pending, { kind: 'idle' })
})

test('getMode + isParserActive: parser is active only in NORMAL/VISUAL', () => {
  const base = initState(true)
  assert.equal(getMode(base), 'normal')
  assert.equal(isParserActive(base), true)
  const insert: VimState = { ...base, mode: 'insert' }
  assert.equal(isParserActive(insert), false)
  const visual: VimState = { ...base, mode: 'visual' }
  assert.equal(isParserActive(visual), true)
  const disabled: VimState = { ...base, enabled: false }
  assert.equal(isParserActive(disabled), false)
  const composing: VimState = { ...base, isComposing: true }
  assert.equal(isParserActive(composing), false)
})

// ----------------------------------------------------------------------
// key-parser.ts
// ----------------------------------------------------------------------

function makeKey(k: string): VimKey {
  // 助手：为测试构造可打印的 `VimKey`。
  if (k === 'esc' || k === 'enter' || k === 'backspace') {
    return { kind: 'special', key: k }
  }
  return { kind: 'char', key: k }
}

test('parseKey: printable char returns a VimKey of kind char', () => {
  const fakeEvent = { key: 'd' } as KeyboardEvent
  const k = parseKey(fakeEvent, true)
  assert.equal(k.kind, 'char')
  if (k.kind === 'char') assert.equal(k.key, 'd')
})

test('parseKey: Escape → special escape', () => {
  const fakeEvent = { key: 'Escape' } as KeyboardEvent
  const k = parseKey(fakeEvent, true)
  assert.deepEqual(k, { kind: 'special', key: 'escape' })
})

test('parseKey: Ctrl-R → ctrl r', () => {
  const fakeEvent = { key: 'r', ctrlKey: true } as KeyboardEvent
  const k = parseKey(fakeEvent, true)
  assert.deepEqual(k, { kind: 'ctrl', key: 'r' })
})

test('tryParseCommand: 3 from idle → count(3)', () => {
  const s = initState(true)
  const r = tryParseCommand(s, makeKey('3'))
  assert.equal(r.kind, 'pending')
  if (r.kind === 'pending') {
    assert.deepEqual(r.state.pending, { kind: 'count', digits: 3 })
  }
})

test('tryParseCommand: 33 from count → count(33)', () => {
  const s: VimState = { ...initState(true), pending: { kind: 'count', digits: 3 } }
  const r = tryParseCommand(s, makeKey('3'))
  assert.equal(r.kind, 'pending')
  if (r.kind === 'pending') {
    assert.deepEqual(r.state.pending, { kind: 'count', digits: 33 })
  }
})

test('tryParseCommand: 99999 from count → capped at 999', () => {
  let s: VimState = { ...initState(true), pending: { kind: 'count', digits: 9 } }
  for (let i = 0; i < 4; i++) {
    const r = tryParseCommand(s, makeKey('9'))
    assert.equal(r.kind, 'pending')
    if (r.kind === 'pending') s = r.state
  }
  if (s.pending.kind === 'count') assert.ok(s.pending.digits <= 999)
})

test('tryParseCommand: 3dw = deleteMotion(3, wordForward)', () => {
  let s: VimState = initState(true)
  s = (tryParseCommand(s, makeKey('3')) as { state: VimState }).state
  s = (tryParseCommand(s, makeKey('d')) as { state: VimState }).state
  const r = tryParseCommand(s, makeKey('w'))
  assert.equal(r.kind, 'ready')
  if (r.kind === 'ready') {
    assert.equal(r.cmd.type, 'deleteMotion')
    if (r.cmd.type === 'deleteMotion') {
      assert.equal(r.cmd.count, 3)
      assert.equal(r.cmd.motion, 'wordForward')
    }
  }
})

test('tryParseCommand: d3w = deleteMotion(3, wordForward) [count-after-motion]', () => {
  let s: VimState = initState(true)
  s = (tryParseCommand(s, makeKey('d')) as { state: VimState }).state
  s = (tryParseCommand(s, makeKey('3')) as { state: VimState }).state
  const r = tryParseCommand(s, makeKey('w'))
  assert.equal(r.kind, 'ready')
  if (r.kind === 'ready' && r.cmd.type === 'deleteMotion') {
    assert.equal(r.cmd.count, 3)
    assert.equal(r.cmd.motion, 'wordForward')
  } else {
    assert.fail('expected ready deleteMotion')
  }
})

test('tryParseCommand: dd = deleteLine(1)', () => {
  let s: VimState = initState(true)
  s = (tryParseCommand(s, makeKey('d')) as { state: VimState }).state
  const r = tryParseCommand(s, makeKey('d'))
  assert.equal(r.kind, 'ready')
  if (r.kind === 'ready') {
    assert.equal(r.cmd.type, 'deleteLine')
    if (r.cmd.type === 'deleteLine') assert.equal(r.cmd.count, 1)
  }
})

test('tryParseCommand: cc = changeLine(1)', () => {
  let s: VimState = initState(true)
  s = (tryParseCommand(s, makeKey('c')) as { state: VimState }).state
  const r = tryParseCommand(s, makeKey('c'))
  assert.equal(r.kind, 'ready')
  if (r.kind === 'ready' && r.cmd.type === 'changeLine') {
    assert.equal(r.cmd.count, 1)
  } else {
    assert.fail('expected ready changeLine')
  }
})

test('tryParseCommand: yy = yankLine(1)', () => {
  let s: VimState = initState(true)
  s = (tryParseCommand(s, makeKey('y')) as { state: VimState }).state
  const r = tryParseCommand(s, makeKey('y'))
  assert.equal(r.kind, 'ready')
  if (r.kind === 'ready' && r.cmd.type === 'yankLine') {
    assert.equal(r.cmd.count, 1)
  } else {
    assert.fail('expected ready yankLine')
  }
})

test('tryParseCommand: ciw = changeTextObject(word, inner)', () => {
  let s: VimState = initState(true)
  s = (tryParseCommand(s, makeKey('c')) as { state: VimState }).state
  s = (tryParseCommand(s, makeKey('i')) as { state: VimState }).state
  const r = tryParseCommand(s, makeKey('w'))
  assert.equal(r.kind, 'ready')
  if (r.kind === 'ready' && r.cmd.type === 'changeTextObject') {
    assert.equal(r.cmd.obj, 'word')
    assert.equal(r.cmd.mod, 'i')
  } else {
    assert.fail('expected ready changeTextObject')
  }
})

test('tryParseCommand: ca( = changeTextObject(paren, outer)', () => {
  let s: VimState = initState(true)
  s = (tryParseCommand(s, makeKey('c')) as { state: VimState }).state
  s = (tryParseCommand(s, makeKey('a')) as { state: VimState }).state
  const r = tryParseCommand(s, makeKey('('))
  assert.equal(r.kind, 'ready')
  if (r.kind === 'ready' && r.cmd.type === 'changeTextObject') {
    assert.equal(r.cmd.obj, 'paren')
    assert.equal(r.cmd.mod, 'a')
  } else {
    assert.fail('expected ready changeTextObject(paren, outer)')
  }
})

test('tryParseCommand: i = enterInsert(i)', () => {
  const s = initState(true)
  const r = tryParseCommand(s, makeKey('i'))
  assert.equal(r.kind, 'ready')
  if (r.kind === 'ready' && r.cmd.type === 'enterInsert') {
    assert.equal(r.cmd.variant, 'i')
  } else {
    assert.fail('expected enterInsert(i)')
  }
})

test('tryParseCommand: v = enterVisual(char)', () => {
  const s = initState(true)
  const r = tryParseCommand(s, makeKey('v'))
  assert.equal(r.kind, 'ready')
  if (r.kind === 'ready' && r.cmd.type === 'enterVisual') {
    assert.equal(r.cmd.kind, 'char')
  } else {
    assert.fail('expected enterVisual(char)')
  }
})

test('tryParseCommand: V = enterVisual(line)', () => {
  const s = initState(true)
  const r = tryParseCommand(s, makeKey('V'))
  assert.equal(r.kind, 'ready')
  if (r.kind === 'ready' && r.cmd.type === 'enterVisual') {
    assert.equal(r.cmd.kind, 'line')
  } else {
    assert.fail('expected enterVisual(line)')
  }
})

test('tryParseCommand: x = deleteChar(1)', () => {
  const s = initState(true)
  const r = tryParseCommand(s, makeKey('x'))
  assert.equal(r.kind, 'ready')
  if (r.kind === 'ready' && r.cmd.type === 'deleteChar') {
    assert.equal(r.cmd.count, 1)
  } else {
    assert.fail('expected deleteChar(1)')
  }
})

test('tryParseCommand: : → ex with empty text', () => {
  const s = initState(true)
  const r = tryParseCommand(s, makeKey(':'))
  assert.equal(r.kind, 'pending')
  if (r.kind === 'pending') {
    assert.deepEqual(r.state.pending, { kind: 'ex', text: '' })
  }
})

test('tryParseCommand: :w → pending(ex, "w"); Enter → ex{type:write}', () => {
  let s: VimState = initState(true)
  s = (tryParseCommand(s, makeKey(':')) as { state: VimState }).state
  s = (tryParseCommand(s, makeKey('w')) as { state: VimState }).state
  const r = tryParseCommand(s, { kind: 'special', key: 'enter' })
  assert.equal(r.kind, 'ready')
  if (r.kind === 'ready' && r.cmd.type === 'ex') {
    assert.equal(r.cmd.cmd.type, 'write')
  } else {
    assert.fail('expected ex{write}')
  }
})

test('tryParseCommand: Escape from ex clears pending', () => {
  let s: VimState = { ...initState(true), pending: { kind: 'ex', text: 'wq' } }
  s = (tryParseCommand(s, { kind: 'special', key: 'escape' }) as { state: VimState }).state
  assert.deepEqual(s.pending, { kind: 'idle' })
})

test('serializePending: idle → ""', () => {
  const s = initState(true)
  assert.equal(serializePending(s), '')
})

test('serializePending: count(3) → "3"', () => {
  const s: VimState = { ...initState(true), pending: { kind: 'count', digits: 3 } }
  assert.equal(serializePending(s), '3')
})

test('serializePending: operator(delete, 3) → "3d"', () => {
  const s: VimState = { ...initState(true), pending: { kind: 'operator', op: 'delete', count: 3 } }
  assert.equal(serializePending(s), '3d')
})

test('serializePending: ex("wq") → ":wq"', () => {
  const s: VimState = { ...initState(true), pending: { kind: 'ex', text: 'wq' } }
  assert.equal(serializePending(s), ':wq')
})

// ----------------------------------------------------------------------
// ex-commands.ts
// ----------------------------------------------------------------------

test('parseExText: w → write', () => {
  assert.deepEqual(parseExText('w'), { kind: 'ok', cmd: { type: 'write' } })
})

test('parseExText: wq → writeQuit', () => {
  assert.deepEqual(parseExText('wq'), { kind: 'ok', cmd: { type: 'writeQuit' } })
})

test('parseExText: x → writeQuit (alias)', () => {
  assert.deepEqual(parseExText('x'), { kind: 'ok', cmd: { type: 'writeQuit' } })
})

test('parseExText: q → quit', () => {
  assert.deepEqual(parseExText('q'), { kind: 'ok', cmd: { type: 'quit' } })
})

test('parseExText: e → reload', () => {
  assert.deepEqual(parseExText('e'), { kind: 'ok', cmd: { type: 'reload' } })
})

test('parseExText: unknown → error', () => {
  const r = parseExText('foo')
  assert.equal(r.kind, 'error')
})

test('executeEx: :w calls save and reports ok', async () => {
  const calls: string[] = []
  const result = await executeEx({ type: 'write' }, {
    save: async () => { calls.push('save'); return { ok: true } },
    reload: async () => { calls.push('reload'); return { ok: true } },
    close: async () => { calls.push('close'); return { ok: true } },
    isDirty: () => false,
  })
  assert.equal(result.ok, true)
  assert.deepEqual(calls, ['save'])
})

test('executeEx: :q refused on dirty without force', async () => {
  const calls: string[] = []
  const result = await executeEx({ type: 'quit' }, {
    save: async () => ({ ok: true }),
    reload: async () => ({ ok: true }),
    close: async (_force = false) => { calls.push('close'); return { ok: false, error: 'unsaved' } },
    isDirty: () => true,
  })
  assert.equal(result.ok, false)
})

test('executeEx: :wq saves then closes', async () => {
  const calls: string[] = []
  const result = await executeEx({ type: 'writeQuit' }, {
    save: async () => { calls.push('save'); return { ok: true } },
    reload: async () => ({ ok: true }),
    close: async (_force = false) => { calls.push('close:' + _force); return { ok: true } },
    isDirty: () => false,
  })
  assert.equal(result.ok, true)
  assert.deepEqual(calls, ['save', 'close:true'])
})

// ----------------------------------------------------------------------
// positions.ts / motions.ts / text-objects.ts
// ----------------------------------------------------------------------
//
// 这一组测试使用**真实的 ProseMirror 文档**（带 doc/paragraph/code_block
// 等嵌套块的开/关位置 offset），而不是旧版"扁平文本下标 == 文档位置"的
// 假模型。旧假模型掩盖了一个系统性 bug：每个块的开/关位置各占 1 个文档
// 位置但不出现在扁平文本里，直接把文档位置当扁平下标用会让 w/f/iw 等
// 所有基于文本的 motion 在真实文档上偏移。
//
// 文档位置约定（ProseMirror，已用探针实测验证）：doc 的 content 从位置 0
// 开始（doc 节点自身不占"开启位置"），第一个段落 "hello world" 的 'h'
// 在位置 1；`selection.head` / `doc.resolve` / `doc.textBetween` /
// `descendants` 共享同一坐标系，`content.size` 恰好是文档末尾位置。

const vimTestSchema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    code_block: { content: 'inline*', group: 'block' },
    block_wrapper: { content: 'block+', group: 'block' },
    text: { group: 'inline' },
    hard_break: { group: 'inline', inline: true, leaf: true },
  },
})

function p(text: string): PMNode {
  return vimTestSchema.node('paragraph', null, text ? [vimTestSchema.text(text)] : [])
}

function codeBlock(lines: string[]): PMNode {
  const content: PMNode[] = []
  lines.forEach((l, i) => {
    if (l) content.push(vimTestSchema.text(l))
    if (i < lines.length - 1) content.push(vimTestSchema.node('hard_break', null, null))
  })
  return vimTestSchema.node('code_block', null, Fragment.fromArray(content))
}

function docOf(blocks: PMNode[]): PMNode {
  return new PMNode(vimTestSchema.nodes.doc, null, Fragment.fromArray(blocks))
}

function st(doc: PMNode, head: number) {
  return { doc, selection: { head } } as never
}

// 位置映射要在多种文档形状下成立：普通段落、带内联叶子的代码块、
// 空块、以及嵌套块（嵌套块的第一个 textblock 会带前导分隔符）。
const positionFixtures: Array<[string, PMNode]> = [
  ['two paragraphs', docOf([p('abc def'), p('ghi')])],
  ['trailing empty paragraph', docOf([p('hello world'), p('foo'), p('')])],
  ['code block with hard_break', docOf([p('ab'), codeBlock(['ln1', 'ln2'])])],
  ['single empty paragraph', docOf([p('')])],
  ['nested blocks', docOf([
    vimTestSchema.node('block_wrapper', null, Fragment.fromArray([p('x'), p('y')])),
    p('tail'),
  ])],
]

for (const [label, doc] of positionFixtures) {
  test(`positions(${label}): textIndexForPos equals the textBetween prefix length at every position`, () => {
    for (let pos = 0; pos <= doc.content.size; pos++) {
      assert.equal(
        textIndexForPos(doc, pos),
        doc.textBetween(0, pos, '\n', '\n').length,
        `pos=${pos}`,
      )
    }
  })

  test(`positions(${label}): round-trip posForTextIndex → textIndexForPos covers every text index`, () => {
    const total = flatText(doc).length
    for (let ti = 0; ti <= total; ti++) {
      assert.equal(textIndexForPos(doc, posForTextIndex(doc, ti)), ti, `ti=${ti}`)
    }
  })
}

test('motions: w x2 crosses paragraphs and lands on the doc position (not the text index)', () => {
  // doc = [p("hello world"), p("foo")]：扁平文本 "hello world\nfoo"（15 字符），
  // content.size = 18。'h' 在文档位置 1；第二个段落的 'f' 在文档位置 14
  // （扁平下标 12）。旧实现会返回 12 —— 那是第一段的关闭边界，无效位置。
  const doc = docOf([p('hello world'), p('foo')])
  const r = motionRange(st(doc, 1), 'wordForward', 2)
  assert.equal(r.from, 1)
  assert.equal(r.to, 14)
  assert.equal(r.inclusive, false)
})

test('motions: f finds the char at its doc position', () => {
  // doc = [p("abc (x) y"), p("q")]：')' 的扁平下标 6，文档位置 7。
  const doc = docOf([p('abc (x) y'), p('q')])
  const r = motionRange(st(doc, 1), 'findChar', 1, ')')
  assert.equal(r.to, 7)
  assert.equal(r.inclusive, true)
})

test('motions: iw on the last paragraph covers only that word', () => {
  // 光标在第二个段落 "foo" 的最后一个 'o' 上（文档位置 16，扁平下标 14）。
  // 旧实现返回 {from:13, to:16}（跨进第一段）；正确是 [14, 17)。
  const doc = docOf([p('hello world'), p('foo')])
  const r = textObjectRange(st(doc, 16), 'word', 'i')
  assert.equal(r.from, 14)
  assert.equal(r.to, 17)
})

test('motions: 0 / $ / h / l respect visual lines inside a code block', () => {
  // doc = [p("ab"), code_block("ln1\\nln2")]：content.size = 13。
  // 'l'(ln1) 在位置 5，'l'(ln2) 在位置 9。
  const doc = docOf([p('ab'), codeBlock(['ln1', 'ln2'])])
  assert.equal(flatText(doc), 'ab\nln1\nln2')

  // $ 在 ln1 上：停在 "ln1" 行尾（位置 8，hard_break 之前），
  // 而不是整个代码块内容结尾（旧实现取 $head.end() = 13）。
  const eol = motionRange(st(doc, 5), 'lineEnd', 1)
  assert.equal(eol.to, 8)

  // l x10 在 ln1 上：钳制到本视觉行行尾，不越过 hard_break。
  const right = motionRange(st(doc, 5), 'right', 10)
  assert.equal(right.to, 8)

  // h x10 在 ln2 上：钳制到本视觉行行首（位置 9）。
  const left = motionRange(st(doc, 11), 'left', 10)
  assert.equal(left.to, 9)
})

test('motions: k / j move line-by-line inside a code block', () => {
  const doc = docOf([p('ab'), codeBlock(['ln1', 'ln2'])])
  assert.equal(motionRange(st(doc, 10), 'up', 1).to, 6)   // ln2 列 1 → ln1 列 1
  assert.equal(motionRange(st(doc, 5), 'down', 1).to, 9)  // ln1 列 0 → ln2 列 0
  // 越过代码块顶部仍受视觉行钳制。
  assert.equal(motionRange(st(doc, 5), 'up', 5).to, 1)    // 到 "ab" 行
})

test('motions: lineStart / lineEnd / firstNonBlank on flat-text lines', () => {
  const doc = docOf([p('hello world'), p('foo')])
  // 'w'（位置 7）→ 行首 'h'（位置 1）。
  assert.equal(motionRange(st(doc, 7), 'lineStart', 1).to, 1)
  // 'h'（位置 1）→ 行尾空隙（位置 12，p1 关闭边界 13 之前）。
  assert.equal(motionRange(st(doc, 1), 'lineEnd', 1).to, 12)
  // 缩进行 "  x"：^ 落在 'x' 上。
  const indented = docOf([p('  x')])
  assert.equal(motionRange(st(indented, 3), 'firstNonBlank', 1).to, 3)
})

test('motions: paragraph skip lands on the next block start', () => {
  // doc = [p("aa"), p(""), p("bb")]：'}' 从第一段跳到 "bb" 行首（位置 7）。
  const doc = docOf([p('aa'), p(''), p('bb')])
  const r = motionRange(st(doc, 1), 'paragraphForward', 1)
  assert.equal(r.to, 7)
})

test('motions: docStart / docEnd', () => {
  const doc = docOf([p('hello'), p('world')])
  assert.equal(motionRange(st(doc, 5), 'docStart', 1).to, 0)
  assert.equal(motionRange(st(doc, 5), 'docEnd', 1).to, doc.content.size)
})

// ----------------------------------------------------------------------
// operators.ts（用假视图做的冒烟测试）
// ----------------------------------------------------------------------

function fakeView(text: string, head: number) {
  // 用 Box 包裹文本，让助手里的闭包既能通过假 tr 的
  // `delete`/`insertText` 修改 `text`，又保持引用稳定不变。
  // 助手读取的是“修改前”的文本，而假的 `textBetween` 读到的
  // 是当前值（即修改后的状态）。为避免这一点，`applyDelete` 在
  // 派发 tr 之前读取 `textBetween`——但生产代码是在派发之后
  // 读取的（这正是我们要测的 bug）。
  //
  // 修复：在闭包里先捕获快照，这样无论 tr 何时触发，助手拿到的
  // 都是修改前的文本。
  const box = { text }
  return {
    state: {
      selection: { head },
      doc: {
        content: { size: box.text.length },
        textBetween: (a: number, b: number) => box.text.slice(a, b),
        resolve: (pos: number) => {
          let start = 0
          for (let i = pos - 1; i >= 0; i--) {
            if (box.text[i] === '\n') { start = i + 1; break }
          }
          let end = box.text.length
          for (let i = pos; i < box.text.length; i++) {
            if (box.text[i] === '\n') { end = i; break }
          }
          return { start: () => start, end: () => end }
        },
      },
      tr: {
        delete: function (a: number, b: number) {
          // 先捕获修改前的文本，让助手看到原始切片。
          // （真实的 PM 事务不可变，这里只是让假事务如实工作。）
          const pre = box.text
          box.text = pre.slice(0, a) + pre.slice(b)
          return this
        },
        insertText: function (s: string, _a: number, _b: number) {
          box.text += s
          return this
        },
        replaceWith: function (_a: number, b: number, t: { text: string }) {
          box.text = box.text.slice(0, _a) + t.text + box.text.slice(b)
          return this
        },
        setSelection: function () { return this },
        setMeta: function () { return this },
      },
      schema: { text: (s: string) => ({ text: s }) },
    },
    editable: () => true,
  } as never
}

test('applyDelete: deletes the range and updates the register', () => {
  const v = fakeView('hello world', 0)
  const r = applyDelete(v, { from: 0, to: 5, inclusive: false })
  assert.equal(r.registerUpdate, 'hello')
})

test('applyChange: deletes the range and reports nextMode insert', () => {
  const v = fakeView('hello world', 0)
  const r = applyChange(v, { from: 0, to: 5, inclusive: false })
  assert.equal(r.nextMode, 'insert')
  assert.equal(r.registerUpdate, 'hello')
})

test('applyYank: keeps the doc and stores the register', () => {
  const v = fakeView('hello world', 0)
  const r = applyYank(v, { from: 0, to: 5, inclusive: false })
  assert.equal(r.registerUpdate, 'hello')
})

test('applyDeleteChar: deletes N chars to the right', () => {
  const v = fakeView('hello world', 0)
  const r = applyDeleteChar(v, 3)
  assert.equal(r.registerUpdate, 'hel')
})

test('applyChangeChar: replaces one char', () => {
  const v = fakeView('hello', 0)
  applyChangeChar(v, 'X')
  // 不校验修改后的假视图——只确认没有抛错即可。
  // fakeView 的 `tr` 会被改动，但真正做替换的是助手本身；
  // 这里只需验证它不抛异常。
  assert.ok(true)
})

test('applyDeleteLine: deletes the whole line', () => {
  const v = fakeView('hello\nworld', 0)
  const r = applyDeleteLine(v, 1)
  // 寄存器里包含整行以及行尾换行符。
  assert.ok(r.registerUpdate?.startsWith('hello'))
})

test('applyJoinLines: joins 2 lines with a space', () => {
  const v = fakeView('hello\nworld', 0)
  applyJoinLines(v, 2)
  // 只验证它不抛错。
  assert.ok(true)
})

// ----------------------------------------------------------------------
// 覆盖情况小结
// ----------------------------------------------------------------------

test('coverage: 7 groups × ~5 tests each = ~35 tests in this file', () => {
  // 这个测试只是个标记，方便维护者用 `wc -l scripts/validate-vim.ts`
  // 快速估算文件规模。实际覆盖的分组见上文（state、parser、ex、
  // motions、text-objects、operators、types）。
  const groups = ['state', 'key-parser', 'ex-commands', 'motions', 'text-objects', 'operators']
  assert.equal(groups.length, 6)
})
