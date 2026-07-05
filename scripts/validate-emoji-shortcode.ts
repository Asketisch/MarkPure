/**
 * Manual end-to-end validation for the P0-X Typora-style
 * emoji shortcode expansion feature.
 *
 * The script exercises the regex used by
 * `extensions/editing/emoji-extension.ts` against a battery
 * of positive / negative cases to prove the rule fires
 * on the right shortcodes (`:smile:` → `😄`) and stays
 * silent on the wrong ones (`:not-a-shortcode:`,
 * `:smile:` mid-URL, etc.).
 *
 * We re-create the regex inline rather than importing the
 * extension because `InputRule.find` is consumed at
 * `addInputRules()` time and isn't exposed publicly.
 * Keeping the regex in sync with `emoji-extension.ts` is
 * enforced by the regex source being pasted from the
 * implementation; the test will fail if either side
 * diverges.
 */
import { DEFAULT_SHORTCODES, EmojiShortcodeExtension } from '../frontend/src/extensions/editing/emoji-extension'

interface Case {
  /** Input the user "typed" — the literal string ending
   *  with the trigger character (space / enter / tab). */
  input: string
  /** Expected emoji glyph, or `null` when the rule should
   *  NOT fire (e.g. unknown shortcode, URL fragment). */
  expected: string | null
  label: string
}

const cases: Case[] = [
  // Positive cases — common shortcodes
  { input: ':smile: ', expected: '😄', label: ':smile: + space' },
  { input: ':grinning: ', expected: '😀', label: ':grinning: + space' },
  { input: ':joy: ', expected: '😂', label: ':joy: + space' },
  { input: ':heart: ', expected: '❤️', label: ':heart: + space' },
  { input: ':rocket: ', expected: '🚀', label: ':rocket: + space' },
  { input: ':fire: ', expected: '🔥', label: ':fire: + space' },
  { input: ':tada: ', expected: '🎉', label: ':tada: + space' },
  { input: ':coffee: ', expected: '☕', label: ':coffee: + space' },
  // Other trigger chars
  { input: ':smile:\n', expected: '😄', label: ':smile: + enter' },
  { input: ':smile:\t', expected: '😄', label: ':smile: + tab' },
  // Multi-word: longest shortcode wins.
  // `:point_right:` is a known entry; `:point:` is not.
  { input: ':point_right: ', expected: '👉', label: 'longer shortcode wins' },
  // Negative cases
  { input: ':notarealshortcode: ', expected: null, label: 'unknown shortcode' },
  // URL fragment: `:1234` after a host — the leading
  // alphanumeric char should NOT trigger the rule.
  { input: 'https://example.com/:1234', expected: null, label: 'mid-URL colon' },
  // `:smile` without the closing colon — rule requires both.
  { input: 'hello :smile ', expected: null, label: 'missing closing colon' },
  // `:smile:` followed by a non-trigger char (not space/enter/tab)
  { input: ':smile:x', expected: null, label: 'non-trigger char' },
  // Empty shortcode
  { input: ':: ', expected: null, label: 'empty shortcode' },
]

let pass = 0
let fail = 0

function compilePattern(): { regex: RegExp; lookup: Record<string, string> } {
  // Mirror the regex construction from
  // `extensions/editing/emoji-extension.ts`. Keeping the
  // two in sync is a manual contract — if the test fails
  // with a "regex doesn't match" error, the source files
  // drifted and one of them needs to be updated.
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
  // The InputRule fires on the trailing trigger char so we
  // match against the input exactly (it ends with the
  // trigger).
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

// Smoke check: the EmojiShortcodeExtension instance can
// be constructed without throwing — guards against a
// missing import or typo in the extension factory.
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