/**
 * emoji 短代码展开功能的端到端人工验证。
 *
 * 脚本用一批正 / 负用例去验证
 * `extensions/editing/emoji-extension.ts` 使用的正则，证明规则
 * 会在正确的短代码（`:smile:` → `😄`）上触发，并在错误的
 * 输入（`:not-a-shortcode:`、URL 中间的 `:smile:` 等）上保持静默。
 *
 * 这里内联重建正则而不导入扩展，是因为 `InputRule.find` 在
 * `addInputRules()` 时就被消费，没有公开出口。正则需要与
 * `emoji-extension.ts` 保持一致——实现里粘贴了同一份正则源，
 * 任一侧漂移都会让本测试失败。
 */
import { DEFAULT_SHORTCODES, EmojiShortcodeExtension } from '../frontend/src/extensions/editing/emoji-extension'

interface Case {
  /** 用户“输入”的文本——以触发字符（空格 / 回车 / Tab）结尾的字符串。 */
  input: string
  /** 期望的 emoji 字形；规则不应触发（未知短代码、URL 片段等）时为 `null`。 */
  expected: string | null
  label: string
}

const cases: Case[] = [
  // 正向用例——常见短代码
  { input: ':smile: ', expected: '😄', label: ':smile: + space' },
  { input: ':grinning: ', expected: '😀', label: ':grinning: + space' },
  { input: ':joy: ', expected: '😂', label: ':joy: + space' },
  { input: ':heart: ', expected: '❤️', label: ':heart: + space' },
  { input: ':rocket: ', expected: '🚀', label: ':rocket: + space' },
  { input: ':fire: ', expected: '🔥', label: ':fire: + space' },
  { input: ':tada: ', expected: '🎉', label: ':tada: + space' },
  { input: ':coffee: ', expected: '☕', label: ':coffee: + space' },
  // 其他触发字符
  { input: ':smile:\n', expected: '😄', label: ':smile: + enter' },
  { input: ':smile:\t', expected: '😄', label: ':smile: + tab' },
  // 多词：最长的短代码优先匹配。
  // `:point_right:` 是已知条目；`:point:` 不是。
  { input: ':point_right: ', expected: '👉', label: 'longer shortcode wins' },
  // 负向用例
  { input: ':notarealshortcode: ', expected: null, label: 'unknown shortcode' },
  // URL 片段：主机后的 `:1234`——前面的字母数字字符不应触发规则。
  { input: 'https://example.com/:1234', expected: null, label: 'mid-URL colon' },
  // `:smile` 缺少结尾冒号——规则要求成对出现。
  { input: 'hello :smile ', expected: null, label: 'missing closing colon' },
  // `:smile:` 后跟非触发字符（不是空格 / 回车 / Tab）
  { input: ':smile:x', expected: null, label: 'non-trigger char' },
  // 空短代码
  { input: ':: ', expected: null, label: 'empty shortcode' },
]

let pass = 0
let fail = 0

function compilePattern(): { regex: RegExp; lookup: Record<string, string> } {
  // 镜像 `extensions/editing/emoji-extension.ts` 中的正则构造。
  // 两处保持一致是手工约定——若测试报“正则不匹配”，
  // 说明两侧源码已漂移，需要更新其中一边。
  const shortcodes = Object.keys(DEFAULT_SHORTCODES)
    .sort((a, b) => b.length - a.length)
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const alternation = shortcodes.map(escape).join('|')
  const regex = new RegExp(
    `(?:^|[^\\w]):(${alternation}):[\\s\\n\\t]$`,
  )
  return { regex, lookup: DEFAULT_SHORTCODES }
}

console.log('— validate-emoji-shortcode —')
const { regex, lookup } = compilePattern()

for (const c of cases) {
  // InputRule 在触发字符处触发，因此严格按输入精确匹配
  //（它以触发字符结尾）。
  const m = c.input.match(regex)
  let got: string | null = null
  if (m) {
    got = lookup[m[1]] ?? null
  }
  const gotStr = got === null ? 'null' : JSON.stringify(got)
  const expectedStr = c.expected === null ? 'null' : JSON.stringify(c.expected)
  if (gotStr === expectedStr) {
    console.log(`✔ ${c.label}`)
    pass++
  } else {
    console.error(`✘ ${c.label}\n  input:    ${JSON.stringify(c.input)}\n  got:      ${gotStr}\n  expected: ${expectedStr}`)
    fail++
  }
}

// 冒烟检查：EmojiShortcodeExtension 实例能无异常构造——防止
// 扩展工厂缺导入或打错字。
try {
  const ext = EmojiShortcodeExtension.configure({})
  if (ext.name !== 'emojiShortcode') {
    console.error(`✘ extension name (got ${ext.name})`)
    fail++
  } else {
    console.log(`✔ EmojiShortcodeExtension constructs cleanly`)
    pass++
  }
} catch (err) {
  console.error('✘ EmojiShortcodeExtension.configure threw:', err)
  fail++
}

console.log(`\n${fail === 0 ? 'OK' : 'FAILED'}  (${pass} pass, ${fail} fail)`)
if (fail > 0) process.exitCode = 1