/**
 * Manual end-to-end validation for the P0-X "lint on
 * save" feature.
 *
 * The script invokes the Rust `lint_markdown` IPC handler
 * via a small standalone Rust binary
 * (`backend/crates/core-lib/examples/lint_cli.rs`) that
 * takes the input as a CLI argument and prints
 * `{content, report}` as JSON to stdout. The TypeScript
 * side asserts each rule's behaviour on a known-dirty
 * input so a regression in any of the three rules
 * (trim trailing whitespace, ensure final newline,
 * collapse 3+ blank lines into 2) is caught immediately.
 *
 * Run via:
 *   cargo run -p mt_core --example lint_cli --quiet -- <input>
 *
 * Or build the binary once and pipe through it from CI.
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

/** Run the Rust example binary with `input` and return
 *  the parsed `{content, report}` JSON. */
function runLint(input: string): LintResult {
  // We invoke the pre-built binary directly instead of
  // going through `cargo run` so the script stays under
  // a second per case (cargo run takes ~1 min to relink
  // the example on cold cache).
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

// ---- Test cases -----------------------------------------------------------

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