/**
 * 「保存时保留存储格式」的前端 → 后端集成验证。
 *
 * 这个脚本做两件事，缺一不可：
 *
 * 1. **捕获真实前端产出的 IPC 载荷。** 它 import 的是仓库里真正的
 *    `frontend/src/editor/commands/file.ts` 与 `editor.ts`，用一个
 *    `window.ipc` 桩把 `save_file` / `doc_open` 的 params 原样截下来。
 *    断言的是**前端代码实际发出的字节**，而不是我们手写的期望值——
 *    前端漏传 `encoding` 时这里立刻失败。
 *
 * 2. **把捕获到的载荷原样喂给真实 Rust handler。** 通过 `mt_harness`
 *    走与桌面应用完全相同的路由表，然后检查磁盘上的字节。
 *    这样「前端传的格式」与「后端写盘的格式」在同一条链路上被验证，
 *    中间没有手抄的中间量。
 *
 * 覆盖：GBK / Shift_JIS / Big5 / CRLF / UTF-8 BOM / 纯 UTF-8，
 * 以及「另存为到新路径」时沿用源格式。
 *
 * 运行：npx tsx scripts/validate-file-format.ts
 */
import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const HARNESS_BIN = join(REPO_ROOT, 'target', 'debug', 'mt_harness')

// ---- 断言helpers -------------------------------------------------------

let failures = 0
function assertEq<T>(label: string, got: T, expected: T): void {
  const g = JSON.stringify(got)
  const e = JSON.stringify(expected)
  if (g === e) {
    console.log(`✔ ${label}`)
  } else {
    failures++
    console.error(`✘ ${label}\n   expected: ${e}\n   got:      ${g}`)
  }
}
function assertTrue(label: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`✔ ${label}`)
  } else {
    failures++
    console.error(`✘ ${label}${detail ? `\n   ${detail}` : ''}`)
  }
}

// ---- window 桩：捕获前端真实产出的 IPC 载荷 ---------------------------

interface IpcCapture {
  cmd: string
  params: Record<string, unknown>
}

const captures: IpcCapture[] = []
/** `pick_save_file` 的模拟返回值。 */
let pickSaveFileResult: string | null = null

const g = globalThis as unknown as {
  window: {
    ipc: { postMessage: (json: string) => void }
    __mt_dispatch: (json: string) => void
  }
}

g.window = {
  ipc: {
    postMessage(json: string) {
      const msg = JSON.parse(json) as { id: number; cmd: string; params: Record<string, unknown> }
      captures.push({ cmd: msg.cmd, params: msg.params })
      // 立刻回一个响应，让 `ipc()` 的 Promise 落地。
      // `__mt_dispatch` 由 ipc 模块在 import 时覆盖，这里动态取，
      // 保证用的是真正的分发函数。
      const result = msg.cmd === 'pick_save_file' ? pickSaveFileResult : null
      g.window.__mt_dispatch(JSON.stringify({ id: msg.id, result }))
    },
  },
  // 真正的实现由 `commands/ipc.ts` 在 import 时装上。
  __mt_dispatch: () => {},
}

// 动态 import：ESM 的静态 import 会被提升，桩还没装好就执行。
const { saveFile, saveFileAs } = await import('../frontend/src/editor/commands/file.ts')
const { docOpen } = await import('../frontend/src/editor/commands/editor.ts')

// ---- harness 客户端 ----------------------------------------------------

class Harness {
  private proc: ChildProcessWithoutNullStreams
  private nextId = 1
  private buffer = ''
  private pending = new Map<number, (line: string) => void>()

  constructor(configDir: string) {
    if (!existsSync(HARNESS_BIN)) {
      throw new Error(
        `harness binary not found at ${HARNESS_BIN}\n` +
          `Build it first:  cargo build --bin mt_harness`,
      )
    }
    this.proc = spawn(HARNESS_BIN, [], {
      cwd: REPO_ROOT,
      env: { ...process.env, MARKPURE_CONFIG_DIR: configDir },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.proc.stdout.setEncoding('utf8')
    this.proc.stdout.on('data', (chunk: string) => {
      this.buffer += chunk
      let idx: number
      while ((idx = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, idx)
        this.buffer = this.buffer.slice(idx + 1)
        if (!line.trim()) continue
        this.dispatch(line)
      }
    })
    this.proc.stderr.setEncoding('utf8')
    this.proc.stderr.on('data', (c: string) => process.stderr.write(`[harness] ${c}`))
  }

  private dispatch(line: string): void {
    let parsed: { id?: number }
    try {
      parsed = JSON.parse(line)
    } catch {
      return
    }
    const waiter = typeof parsed.id === 'number' ? this.pending.get(parsed.id) : undefined
    if (!waiter) return
    this.pending.delete(parsed.id!)
    waiter(line)
  }

  async call(
    cmd: string,
    params: Record<string, unknown> = {},
  ): Promise<{ result?: unknown; error?: string }> {
    const id = this.nextId++
    const line = new Promise<string>((resolveLine) => {
      this.pending.set(id, resolveLine)
      setTimeout(() => {
        if (this.pending.delete(id)) {
          resolveLine(JSON.stringify({ id, error: `timeout waiting for ${cmd}` }))
        }
      }, 30_000)
    })
    this.proc.stdin.write(JSON.stringify({ id, cmd, params }) + '\n')
    return JSON.parse(await line)
  }

  close(): void {
    try {
      this.proc.stdin.write(JSON.stringify({ id: 0, cmd: '__shutdown', params: {} }) + '\n')
      this.proc.stdin.end()
    } catch {
      /* 进程可能已退出 */
    }
    this.proc.kill()
  }
}

// ---- 测试主体 -----------------------------------------------------------

const workDir = mkdtempSync(join(tmpdir(), 'markpure-format-'))
const configDir = join(workDir, 'config')
const { mkdirSync } = await import('node:fs')
mkdirSync(configDir, { recursive: true })

const harness = new Harness(configDir)

interface Sample {
  name: string
  file: string
  text: string
  bytes: Buffer
}

const gbkText = '# 标题\n\n这是一段中文正文 body。\n'
const sjisText = '# タイトル\n\n本文 body。\n'
const big5Text = '# 標題\n\n正文 body。\n'
const utf8Text = '# Title\n\nbody\n'

const samples: Sample[] = [
  {
    name: 'GBK',
    file: 'gbk.md',
    text: gbkText,
    bytes: Buffer.from(gbkText, 'binary'), // 占位，下面用 iconv 风格替换
  },
  {
    name: 'Shift_JIS',
    file: 'sjis.md',
    text: sjisText,
    bytes: Buffer.from(sjisText, 'binary'),
  },
  {
    name: 'Big5',
    file: 'big5.md',
    text: big5Text,
    bytes: Buffer.from(big5Text, 'binary'),
  },
  { name: 'UTF-8', file: 'utf8.md', text: utf8Text, bytes: Buffer.from(utf8Text, 'utf8') },
  {
    name: 'UTF-8 BOM',
    file: 'bom.md',
    text: utf8Text,
    bytes: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(utf8Text, 'utf8')]),
  },
  {
    name: 'CRLF',
    file: 'crlf.md',
    text: utf8Text,
    bytes: Buffer.from(utf8Text.replace(/\n/g, '\r\n'), 'utf8'),
  },
]

// Node 没有内置 GBK / Shift_JIS / Big5 编码器。用 iconv 命令行
// 把样本写成目标编码（macOS 自带 iconv）。
function encodeWithIconv(text: string, from: string, to: string): Buffer {
  return execFileSync('iconv', ['-f', from, '-t', to], { input: Buffer.from(text, 'utf8') })
}

samples[0].bytes = encodeWithIconv(gbkText, 'UTF-8', 'GBK')
samples[1].bytes = encodeWithIconv(sjisText, 'UTF-8', 'SHIFT_JIS')
samples[2].bytes = encodeWithIconv(big5Text, 'UTF-8', 'BIG5')

/** 把某条 IPC 载荷（前端捕获的）原样发给 Rust。 */
async function sendCaptured(cap: IpcCapture): Promise<{ result?: unknown; error?: string }> {
  return harness.call(cap.cmd, cap.params)
}

console.log('— validate-file-format —')

for (const s of samples) {
  const path = join(workDir, s.file)
  writeFileSync(path, s.bytes)

  // 1) 前端视角：open_file 拿到内容与格式
  const opened = (await harness.call('open_file', { path })) as {
    result?: { content: string; encoding: string; line_ending: string }
    error?: string
  }
  if (opened.error) {
    failures++
    console.error(`✘ ${s.name}: open_file failed — ${opened.error}`)
    continue
  }
  const info = opened.result!

  // 2) 前端真实代码：构造 format 并调用 saveFile
  captures.length = 0
  await saveFile(path, info.content, {
    encoding: info.encoding,
    lineEnding: info.line_ending,
  })
  assertTrue(
    `${s.name}: 前端发出了一条 save_file`,
    captures.length === 1 && captures[0].cmd === 'save_file',
    JSON.stringify(captures),
  )
  const cap = captures[0]
  assertEq(`${s.name}: save_file 带上 encoding`, cap.params.encoding, info.encoding)
  assertEq(`${s.name}: save_file 带上 line_ending`, cap.params.line_ending, info.line_ending)

  // 3) 载荷原样发给真实 Rust handler
  const saved = await sendCaptured(cap)
  assertTrue(`${s.name}: Rust 接受该载荷`, !saved.error, String(saved.error))

  // 4) 磁盘字节必须完全一致
  const after = readFileSync(path)
  assertTrue(
    `${s.name}: 保存后字节不变（${s.bytes.length}B）`,
    after.equals(s.bytes),
    `expected ${s.bytes.toString('hex')} got ${after.toString('hex')}`,
  )
}

// ---- 另存为到新路径：沿用源文档格式 ------------------------------------

{
  const src = join(workDir, 'gbk.md')
  const opened = (await harness.call('open_file', { path: src })) as {
    result?: { content: string; encoding: string; line_ending: string }
  }
  const info = opened.result!

  // 前端「另存为」：先弹对话框拿到新路径，再发 save_file。
  const dst = join(workDir, 'gbk-copy.md')
  pickSaveFileResult = dst
  captures.length = 0
  const newPath = await saveFileAs(info.content, {
    encoding: info.encoding,
    lineEnding: info.line_ending,
  })
  assertEq('另存为：返回新路径', newPath, dst)
  const cap = captures[captures.length - 1]
  assertEq('另存为：save_file 带上 encoding', cap.params.encoding, info.encoding)

  const saved = await sendCaptured(cap)
  assertTrue('另存为：Rust 接受该载荷', !saved.error, String(saved.error))
  const after = readFileSync(dst)
  assertTrue(
    '另存为：新文件沿用源编码（GBK）',
    after.equals(samples[0].bytes),
    `expected ${samples[0].bytes.toString('hex')} got ${after.toString('hex')}`,
  )
}

// ---- doc_open 注册表路径：格式也必须被记录并沿用 -----------------------

{
  const src = join(workDir, 'gbk.md')
  const opened = (await harness.call('open_file', { path: src })) as {
    result?: { content: string; encoding: string; line_ending: string }
  }
  const info = opened.result!

  captures.length = 0
  await docOpen(7, info.content, {
    encoding: info.encoding,
    lineEnding: info.line_ending,
  })
  const cap = captures[0]
  assertEq('doc_open: 带上 encoding', cap.params.encoding, info.encoding)
  assertEq('doc_open: 带上 line_ending', cap.params.line_ending, info.line_ending)
  assertTrue('doc_open: Rust 接受该载荷', !(await sendCaptured(cap)).error)

  // 用注册表里的文档另存到新路径——格式必须来自注册表。
  const dst = join(workDir, 'from-registry.md')
  const saved = await harness.call('save_file', { path: dst, doc_id: 7 })
  assertTrue('doc_id 保存：Rust 接受', !saved.error, String(saved.error))
  const after = readFileSync(dst)
  assertTrue(
    'doc_id 保存：新文件沿用注册表里的 GBK 编码',
    after.equals(samples[0].bytes),
    `expected ${samples[0].bytes.toString('hex')} got ${after.toString('hex')}`,
  )
}

// ---- 不带格式信息时退回到 UTF-8 + LF -----------------------------------

{
  const dst = join(workDir, 'default.md')
  captures.length = 0
  await saveFile(dst, '# 新文档\n')
  const cap = captures[0]
  assertTrue('无格式信息：不发 encoding', !('encoding' in cap.params))
  assertTrue('无格式信息：不发 line_ending', !('line_ending' in cap.params))
  assertTrue('无格式信息：Rust 接受', !(await sendCaptured(cap)).error)
  const after = readFileSync(dst)
  assertTrue(
    '无格式信息：默认 UTF-8 + LF',
    after.equals(Buffer.from('# 新文档\n', 'utf8')),
    after.toString('hex'),
  )
}

harness.close()
rmSync(workDir, { recursive: true, force: true })

console.log(failures ? `\nFAILED (${failures})` : '\nOK')
process.exitCode = failures ? 1 : 0
