/**
 * 开发期 IPC 桥：让前端在**普通浏览器**里也能连上真正的 Rust 后端。
 *
 * ## 为什么需要它
 *
 * 桌面应用的 IPC 走 `window.ipc.postMessage` → wry → Rust。但在浏览器里
 * 打开前端时 `window.ipc` 根本不存在，页面一加载就抛错，显示层因此
 * 无法在浏览器里调试或做自动化测试。
 *
 * 这个插件挂一个 `/__ipc` 中间件：收到请求后把 JSON 转发给
 * `mt_harness` 进程（与 `scripts/test_backend.py` 用的是同一个二进制、
 * 同一条路由表），再把响应原样送回浏览器。前端只需在 dev 模式下把
 * `window.ipc.postMessage` 换成一次 `fetch`。
 *
 * 桥在两种模式下都可用：
 *
 * - `vite`（开发服务器）—— `configureServer`
 * - `vite preview`（预览**生产构建**）—— `configurePreviewServer`
 *
 * 生产构建没有 HMR 的 WebSocket 干扰，是做浏览器端回归与启动耗时
 * 测量更贴近真实的环境。
 *
 * ## 与生产环境的关系
 *
 * 插件带 `apply: 'serve'`，**只在开发/预览服务器里生效**；生产构建
 * 产物里不包含任何这段代码，桌面应用仍然走 wry 的原生 IPC。
 *
 * ## 环境变量
 *
 * - `MARKPURE_CONFIG_DIR` —— 后端配置目录（默认使用用户真实配置）。
 *   自动化测试应当指向临时目录，避免污染用户设置。
 * - `MARKPURE_DEV_WORKSPACE` —— 预置的工作区目录；启动时会被注册为
 *   第一个工作区根，浏览器一打开就能看到文件树。
 * - `MARKPURE_IPC_POLL=0` —— 关闭文件变更轮询（默认开启）。
 * - `MARKPURE_SKIP_IPC_BRIDGE=1` —— 完全禁用桥（回到「没有后端」的
 *   纯前端模式）。
 * - `MARKPURE_IPC_DEBUG=1` —— 打印每条经过桥的命令名。
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'path'
import type { Connect, Plugin } from 'vite'

// 本文件位于 `<repo>/scripts/`，仓库根目录是它的上一级。
const REPO_ROOT = path.resolve(import.meta.dirname ?? '.', '..')
const HARNESS_BIN = path.join(REPO_ROOT, 'target', 'debug', 'mt_harness')

/** 与 harness 的一次 JSON-lines 往返。 */
class HarnessClient {
  private proc: ChildProcessWithoutNullStreams | null = null
  private nextId = 1
  /** 等待中的请求：harness 侧的 id → 浏览器侧的解析器。 */
  private pending = new Map<
    number,
    { browserId: number; resolve: (line: string) => void; reject: (e: Error) => void }
  >()

  private readonly env: NodeJS.ProcessEnv

  constructor(env: NodeJS.ProcessEnv) {
    this.env = env
  }

  private ensure(): ChildProcessWithoutNullStreams {
    if (this.proc && !this.proc.killed) return this.proc

    if (!existsSync(HARNESS_BIN)) {
      throw new Error(
        `IPC bridge: harness binary not found at ${HARNESS_BIN}.\n` +
          `Build it first:  cargo build --bin mt_harness`,
      )
    }

    const proc = spawn(HARNESS_BIN, [], {
      cwd: REPO_ROOT,
      env: this.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    proc.stdout.setEncoding('utf8')
    proc.stderr.setEncoding('utf8')

    let buffer = ''
    proc.stdout.on('data', (chunk: string) => {
      buffer += chunk
      let idx: number
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 1)
        if (!line.trim()) continue
        this.dispatch(line)
      }
    })
    proc.stderr.on('data', (chunk: string) => {
      // harness 的 stderr 只用于诊断；默认不打印到 Vite 的输出里，
      // 否则会淹没 HMR 日志。
      if (process.env.MARKPURE_IPC_DEBUG === '1') {
        process.stderr.write(chunk)
      }
    })
    proc.on('exit', () => {
      this.proc = null
      for (const [, entry] of this.pending) {
        entry.reject(new Error('IPC bridge: harness exited'))
      }
      this.pending.clear()
    })

    this.proc = proc
    return proc
  }

  /** 按响应里的 id 把结果交给对应的等待者。 */
  private dispatch(line: string) {
    let parsed: { id?: number }
    try {
      parsed = JSON.parse(line)
    } catch {
      return
    }
    const entry =
      typeof parsed.id === 'number' ? this.pending.get(parsed.id) : undefined
    if (!entry) {
      if (process.env.MARKPURE_IPC_DEBUG === '1') {
        console.log(`[ipc-bridge] unmatched response id=${parsed.id}`)
      }
      return
    }
    this.pending.delete(parsed.id!)
    if (process.env.MARKPURE_IPC_DEBUG === '1') {
      console.log(
        `[ipc-bridge] response bridgeId=${parsed.id} -> browserId=${entry.browserId}`,
      )
    }
    entry.resolve(line)
  }

  /**
   * 发送一条命令并等待对应响应。
   *
   * 桥自己分配 id 与 harness 通信，再把响应按**浏览器原始 id** 交还。
   * 不能直接用浏览器的 id：页面里的轮询（`__poll_file_changes`）与
   * 普通命令会交错返回，按 id 精确分发才不会串台。
   */
  async call(payload: unknown): Promise<string> {
    const proc = this.ensure()
    const browserId = (payload as { id?: number }).id ?? 0
    const bridgeId = this.nextId++

    const response = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(bridgeId)
        reject(new Error(`IPC bridge: command timed out (id=${browserId})`))
      }, 60_000)

      this.pending.set(bridgeId, {
        browserId,
        resolve: (line) => {
          clearTimeout(timer)
          // 把 harness 的 id 换回浏览器的 id，前端才能对上号。
          try {
            const obj = JSON.parse(line)
            obj.id = browserId
            resolve(JSON.stringify(obj))
          } catch {
            resolve(line)
          }
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        },
      })
    })

    proc.stdin.write(JSON.stringify({ ...(payload as object), id: bridgeId }) + '\n')
    return response
  }

  dispose(): void {
    if (!this.proc) return
    try {
      this.proc.stdin.write(JSON.stringify({ id: 0, cmd: '__shutdown', params: {} }) + '\n')
      this.proc.stdin.end()
    } catch {
      /* 进程可能已经退出 */
    }
    this.proc.kill()
    this.proc = null
  }
}

/** 生成注入到页面里的 dev 桥脚本。 */
function devBridgeScript(): string {
  return `
(() => {
  if (window.ipc) return;              // 真实宿主（wry）已注入
  // 是否轮询文件变更事件。由 Vite 插件按环境变量注入。
  window.__mt_ipc_poll_enabled = __MT_IPC_POLL__;
  // 是否把编辑器渲染出的文本上报到服务端（用于自动化验证）。
  window.__mt_ipc_probe = __MT_IPC_PROBE__;
  // 每次页面加载都上报一次，便于确认页面是否被反复重载。
  try {
    void fetch('/__ipc-error', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'PAGE LOAD ' + location.href,
    })
  } catch (_) {}
  // 把「编辑器当前渲染出来的文本」上报给服务端。浏览器自动化工具
  // 往往会在每次动作前重载页面，无法靠截图确认渲染结果；这里用页面
  // 自己的状态作为证据。
  if (window.__mt_ipc_probe) {
    // 后台标签页的定时器会被浏览器节流到 1 次/分钟，因此除了定时
    // 轮询，还要在每次 IPC 响应后主动上报一次。
    let last = ''
    const reportState = () => {
      const el = document.querySelector('.ProseMirror')
      const text = el ? (el.textContent || '') : '(no editor)'
      const tree = Array.from(document.querySelectorAll('.tree-item .item-name'))
        .map((n) => n.textContent || '')
        .join(',')
      const html = el ? el.innerHTML : ''
      const payload = text + ' <<<HTML>>> ' + html + ' <<<TREE>>> ' + tree
      if (payload === last) return
      last = payload
      void fetch('/__ipc-state', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: payload,
      })
    }
    window.__mt_ipc_report_state = reportState
    setInterval(reportState, 500)
  }
  // 调试开关：?ipcdebug=1 时打印每一条 IPC 往返。
  window.__mt_dev_bridge_debug = /[?&]ipcdebug=1/.test(location.search);
  // 把未捕获异常同时送到**服务端**与控制台。页面若在报错后 reload，
  // 控制台记录会被清空；发到服务端才留得住线索。
  const report = (text) => {
    try { console.error('[ipc-bridge] ' + text) } catch (_) {}
    try {
      void fetch('/__ipc-error', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: text,
      })
    } catch (_) {}
  }
  window.addEventListener('error', (e) => {
    report('uncaught: ' + (e.message || '') + ' @ ' + (e.filename || '') + ':' + (e.lineno || 0) +
      (e.error && e.error.stack ? ' | ' + e.error.stack : ''))
  })
  // console.error 也转发到服务端：页面里「[math] …」这类诊断
  // 只有在 console.error 里，浏览器自动化看不到。
  const nativeError = console.error.bind(console)
  console.error = (...args) => {
    nativeError(...args)
    try {
      void fetch('/__ipc-error', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: 'CONSOLE.ERROR ' + args.map((a) => {
          try { return typeof a === 'string' ? a : JSON.stringify(a) } catch (_) { return String(a) }
        }).join(' '),
      })
    } catch (_) {}
  }
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason
    report('unhandled rejection: ' + (r && r.stack ? r.stack : String(r)))
  })
  const post = async (json) => {
    try {
      const res = await fetch('/__ipc', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: json,
      })
      const text = await res.text()
      if (window.__mt_dev_bridge_debug) console.log('[ipc-bridge] <-', text)
      // id=-1 是本脚本自己的文件监视轮询，不走 __mt_dispatch。
      try {
        const parsed = JSON.parse(text)
        if (parsed.id === -1) {
          if (typeof window.__mt_on_file_changes === 'function' && parsed.result) {
            window.__mt_on_file_changes(parsed.result)
          }
          return
        }
        if (window.__mt_dev_bridge_debug) {
          console.log('[ipc-bridge] dispatch id=' + parsed.id +
            ' hasHandler=' + (typeof window.__mt_dispatch))
        }
      } catch (_) { /* 交给 __mt_dispatch 报错 */ }
      window.__mt_dispatch(text)
      // 响应到达意味着应用刚做完一件事——此刻上报渲染结果最准。
      try { window.__mt_ipc_report_state?.() } catch (_) {}
    } catch (e) {
      console.error('[ipc-bridge] request failed', e)
      const id = (() => { try { return JSON.parse(json).id } catch { return 0 } })()
      window.__mt_dispatch(JSON.stringify({ id, error: 'IPC bridge: ' + String(e) }))
    }
  }
  window.ipc = { postMessage: (json) => { if (window.__mt_dev_bridge_debug) console.log('[ipc-bridge] ->', json); void post(json) } }

  // 文件监视事件：桌面版由 Rust 通过 evaluate_script 推送，这里
  // 轮询 harness 的 __poll_file_changes 拿到同样的事件。
  //
  // 轮询可以用 MARKPURE_IPC_POLL=0 关掉——某些自动化工具会等
  // 「网络空闲」，一个永不停止的轮询会让它们一直等下去。
  if (window.__mt_ipc_poll_enabled !== false) {
    setInterval(() => {
      void post(JSON.stringify({ id: -1, cmd: '__poll_file_changes', params: {} }))
    }, 1000)
  }
})();
`
}

/**
 * 创建一个把浏览器 IPC 转发到 Rust harness 的 Vite 插件。
 */
export function ipcDevBridge(): Plugin {
  let client: HarnessClient | null = null

  /**
   * 桥所需的最小服务器结构。
   *
   * `vite` 的开发服务器（`ViteDevServer`）与预览服务器
   * （`PreviewServer`）类型不同，但两者都提供 `middlewares.use`，
   * 因此这里只依赖真正用到的那部分结构。
   */
  interface BridgeServer {
    // Connect 的 `use` 有两种签名（带路径 / 不带路径），这里放宽成
    // 可变参数，两种都能用。
    middlewares: { use: (...args: any[]) => void }
  }

  /** 挂载 `/__ipc` 中间件，并（可选地）预置工作区。 */
  function installBridge(
    devServer: BridgeServer,
    logger: { info: (m: string) => void; warn: (m: string) => void },
  ) {
    if (process.env.MARKPURE_SKIP_IPC_BRIDGE === '1') {
      logger.info('  ➜  IPC bridge disabled (MARKPURE_SKIP_IPC_BRIDGE=1)')
      return
    }

    client = new HarnessClient({ ...process.env })

    // 预置工作区（可选）：让浏览器一打开就有文件树可用。
    const workspace = process.env.MARKPURE_DEV_WORKSPACE
    if (workspace) {
      void client
        .call({ cmd: 'add_workspace_root', params: { path: workspace } })
        .then(() => {
          logger.info(`  ➜  IPC bridge ready (workspace: ${workspace})`)
        })
        .catch((e) => {
          logger.warn(`  ➜  IPC bridge: ${String(e)}`)
        })
    }

    const handler: Connect.NextHandleFunction = (req, res, next) => {
      if (!client) {
        next()
        return
      }
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        let cmd = '?'
        try {
          cmd = JSON.parse(body).cmd
        } catch {
          /* 保留占位符 */
        }
        if (process.env.MARKPURE_IPC_DEBUG === '1') {
          logger.info(`  ➜  IPC ${cmd} (${body.length}B)`)
        }
        client!
          .call(JSON.parse(body))
          .then((line) => {
            res.setHeader('content-type', 'application/json')
            res.end(line)
          })
          .catch((e: unknown) => {
            if (process.env.MARKPURE_IPC_DEBUG === '1') {
              logger.warn(`  ➜  IPC ${cmd} failed: ${String(e)}`)
            }
            res.statusCode = 500
            res.setHeader('content-type', 'application/json')
            res.end(
              JSON.stringify({ id: 0, error: `IPC bridge: ${String(e)}` }),
            )
          })
      })
    }

    devServer.middlewares.use('/__ipc', handler)

    // 页面端上报的未捕获异常。页面 reload 后控制台会被清空，
    // 这里的服务端日志是唯一留得住的线索。
    devServer.middlewares.use(
      '/__ipc-error',
      (req: NodeJS.ReadableStream & { on: (e: string, cb: (c: Buffer) => void) => void },
       res: { statusCode: number; end: () => void }) => {
        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => chunks.push(c))
        req.on('end', () => {
          logger.warn(`  ✗  PAGE ERROR: ${Buffer.concat(chunks).toString('utf8')}`)
          res.statusCode = 204
          res.end()
        })
      },
    )

    // 页面端上报的「编辑器当前渲染文本」。用于在无法截图的环境里
    // 验证显示层确实渲染出了内容。
    devServer.middlewares.use(
      '/__ipc-state',
      (req: NodeJS.ReadableStream & { on: (e: string, cb: (c: Buffer) => void) => void },
       res: { statusCode: number; end: () => void }) => {
        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => chunks.push(c))
        req.on('end', () => {
          logger.info(
            `  ➜  EDITOR STATE: ${Buffer.concat(chunks).toString('utf8').slice(0, 1200)}`,
          )
          res.statusCode = 204
          res.end()
        })
      },
    )

    logger.info('  ➜  IPC bridge: POST /__ipc')

    // 静态资源请求日志（仅调试时开启）。用来确认「按需加载」的
    // chunk 确实在需要时才被拉取——这正是启动优化的关键指标。
    if (process.env.MARKPURE_IPC_DEBUG === '1') {
      devServer.middlewares.use(
        (req: { method?: string; url?: string }, _res: unknown, next: () => void) => {
          const url = req.url ?? ''
          if (req.method === 'GET' && url.startsWith('/assets/')) {
            logger.info(`  ➜  ASSET ${url}`)
          }
          next()
        },
      )
    }
  }

  return {
    name: 'markpure-ipc-dev-bridge',
    apply: 'serve',

    configResolved() {
      // 注入脚本的语法自检。脚本有语法错误时整个 IIFE 不会执行，
      // 页面上的 window.ipc 就不存在——而这只会表现为「IPC 没反应」。
      try {
        const script = devBridgeScript()
          .replace('__MT_IPC_POLL__', 'true')
          .replace('__MT_IPC_PROBE__', 'false')
        // eslint-disable-next-line no-new-func
        new Function(script)
      } catch (e) {
        console.error('[ipc-bridge] injected script has a syntax error:', e)
      }
    },

    configureServer(devServer) {
      installBridge(devServer, devServer.config.logger)
    },

    // `vite preview`（预览**生产构建**）同样挂上桥。生产 bundle 没有
    // HMR 的 WebSocket 干扰，是做浏览器端回归与启动耗时测量的更贴近
    // 真实的环境。
    configurePreviewServer(previewServer) {
      installBridge(previewServer, previewServer.config.logger)

      // `vite preview` 直接把 `dist/index.html` 当静态文件发出去，
      // 不会重新跑 `transformIndexHtml`——因此这里手动把桥脚本
      // 注入到首页里。
      //
      // 注意：首页路径必须取**实际服务的 outDir**，不能硬编码
      // `REPO_ROOT/dist`。构建到自定义 outDir 时（例如布局回归测试
      // 用的临时目录），两边的资源哈希会不一致——注入旧 index.html
      // 而服务新资源，页面会因 404 而白屏。
      const outDir = path.resolve(
        previewServer.config.root,
        previewServer.config.build.outDir,
      )
      const indexPath = path.join(outDir, 'index.html')
      previewServer.middlewares.use((req, res, next) => {
        const url = req.url ?? ''
        if (req.method !== 'GET' || (url !== '/' && !url.startsWith('/index.html'))) {
          next()
          return
        }
        readFile(indexPath, 'utf8')
          .then((html) => {
            const script = devBridgeScript()
              .replace(
                '__MT_IPC_POLL__',
                process.env.MARKPURE_IPC_POLL === '0' ? 'false' : 'true',
              )
              .replace(
                '__MT_IPC_PROBE__',
                process.env.MARKPURE_IPC_PROBE === '1' ? 'true' : 'false',
              )
            res.setHeader('content-type', 'text/html; charset=utf-8')
            // 不缓存：桥脚本是注入的，缓存住旧版 index.html 会让页面
            // 拿着没有桥的 HTML 加载，表现为「IPC 全都发不出去」。
            res.setHeader('cache-control', 'no-store, must-revalidate')
            res.end(html.replace('</head>', `<script>${script}</script></head>`))
          })
          .catch(() => next())
      })
    },

    transformIndexHtml() {
      return [
        {
          tag: 'script',
          injectTo: 'head-prepend',
          children: devBridgeScript()
            .replace(
              '__MT_IPC_POLL__',
              process.env.MARKPURE_IPC_POLL === '0' ? 'false' : 'true',
            )
            .replace(
              '__MT_IPC_PROBE__',
              process.env.MARKPURE_IPC_PROBE === '1' ? 'true' : 'false',
            ),
        },
      ]
    },

    closeBundle() {
      client?.dispose()
      client = null
    },
  }
}
