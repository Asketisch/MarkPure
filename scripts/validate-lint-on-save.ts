/**
 * “保存时整理”功能的端到端人工验证。
 *
 * 脚本经由一个小的独立 Rust 二进制
 * （`backend/crates/core-lib/examples/lint_cli.rs`）调用
 * Rust 端的 `lint_markdown` IPC 处理器。该二进制把输入作为 CLI
 * 参数，向 stdout 打印 `{content, report}` JSON。TypeScript 侧
 * 在已知脏输入上断言每条规则的执行结果，这样三条规则
 * （去除行尾空白、确保以换行结尾、将连续 3+ 个空行折叠为 2 个）
 * 中任一条回归都能立刻被发现。
 *
 * 运行方式：
 *   cargo run -p mt_core --example lint_cli --quiet -- <input>
 *
 * 或者先构建一次该二进制，再由 CI 通过管道输入。
 */
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface LintReport {
  trimmed_lines: number
  added_final_newline: boolean
  collapsed_runs: number
  delta_chars: number
}

interface LintResult {
  content: string
  report: LintReport
}

/** 用 `input` 运行 Rust 示例二进制，返回解析后的 `{content, report}` JSON。 */
function runLint(input: string): LintResult {
  // 直接调用预构建的二进制而非 `cargo run`，让每个用例
  // 控制在 1 秒以内（冷缓存时 cargo run 重新链接示例约需 1 分钟）。
  const bin = resolve(
    __dirname,
    '..',
    'target',
    'debug',
    'examples',
    'lint_cli',
  )
  const r = spawnSync(bin, [input], { encoding: 'utf8' })
  if (r.status !== 0) {
    throw new Error(
      `lint_cli failed (status=${r.status}):\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
    )
  }
  const lastLine = r.stdout.trim().split('\n').pop() ?? '{}'
  return JSON.parse(lastLine) as LintResult
}

// ---- 测试用例 -----------------------------------------------------------

function assertEq<T>(label: string, got: T, expected: T): void {
  const gotStr = JSON.stringify(got)
  const expectedStr = JSON.stringify(expected)
  if (gotStr !== expectedStr) {
    console.error(`✘ ${label}\n  got:      ${gotStr}\n  expected: ${expectedStr}`)
    process.exitCode = 1
  } else {
    console.log(`✔ ${label}`)
  }
}

const cases: Array<{ label: string; input: string; expected: { content: string; report: Partial<LintReport> } }> = [
  {
    label: 'trims trailing whitespace (LF)',
    input: 'hello   \nworld\t\t\n',
    expected: { content: 'hello\nworld\n', report: { trimmed_lines: 2 } },
  },
  {
    label: 'preserves CRLF when trimming trailing whitespace',
    input: 'hello   \r\nworld\t\r\n',
    expected: { content: 'hello\r\nworld\r\n', report: { trimmed_lines: 2 } },
  },
  {
    label: 'ensures final newline when missing',
    input: 'hello\nworld',
    expected: {
      content: 'hello\nworld\n',
      report: { added_final_newline: true },
    },
  },
  {
    label: 'collapses 3+ blank lines into 2',
    input: 'a\n\n\n\n\nb\n',
    expected: { content: 'a\n\n\nb\n', report: { collapsed_runs: 1 } },
  },
  {
    label: 'preserves exactly two blank lines',
    input: 'a\n\n\nb\n',
    expected: { content: 'a\n\n\nb\n', report: { collapsed_runs: 0 } },
  },
  {
    label: 'clean input is untouched (idempotent)',
    input: 'hello\nworld\n',
    expected: {
      content: 'hello\nworld\n',
      report: {
        trimmed_lines: 0,
        added_final_newline: false,
        collapsed_runs: 0,
        delta_chars: 0,
      },
    },
  },
  {
    label: 'runs all rules together',
    input: 'hello   \n\n\n\n\nworld  ',
    expected: {
      content: 'hello\n\n\nworld\n',
      report: {
        trimmed_lines: 2,
        added_final_newline: true,
        collapsed_runs: 1,
      },
    },
  },
]

console.log('— validate-lint-on-save —')
for (const c of cases) {
  const r = runLint(c.input)
  assertEq(`${c.label} (content)`, r.content, c.expected.content)
  for (const [key, value] of Object.entries(c.expected.report)) {
    assertEq(`${c.label} (report.${key})`, r.report[key as keyof LintReport], value)
  }
}
console.log(process.exitCode ? '\nFAILED' : '\nOK')