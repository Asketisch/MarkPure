/**
 * 显示层自动化测试的公共设施。
 *
 * 显示层的 bug（布局错乱、交互失效、块不渲染）有两个共同特点：
 *
 * 1. **纯函数测试抓不到** —— 它们要么依赖真实排版引擎，要么依赖
 *    真实事件派发。
 * 2. **必须跑在真实构建上** —— `vite dev` 有 HMR 的 WebSocket 干扰，
 *    且模块拆分/懒加载的产物与发布版不同。
 *
 * 因此这里提供三件套：**生产构建** → **preview 服务**（挂 IPC 桥，
 * 把浏览器的 IPC 转发给真正的 Rust 后端 `mt_harness`）→ **无头
 * Chrome**（用 Chrome DevTools Protocol 驱动）。
 *
 * 供 `validate-layout.ts`（布局几何）与 `validate-interactions.ts`
 * （交互行为）共用。
 */

import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(__dirname, '..', '..')
const HARNESS_BIN = join(REPO_ROOT, 'target', 'debug', 'mt_harness')

// ---- Chrome 查找 --------------------------------------------------------

/**
 * 找一个可用的 Chrome / Chromium。
 *
 * 查找顺序：`$MARKPURE_CHROME` → 各平台默认安装路径。
 * 返回 null 表示本机没有——调用方应**跳过**而不是失败：布局与交互
 * 断言需要真实排版引擎，缺它时无法验证，但也不该让整个测试套件变红。
 */
export function findChrome(): string | null {
  const candidates = [
    process.env.MARKPURE_CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].filter((c): c is string => Boolean(c))
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return null
}

/** `mt_harness` 是否已构建。IPC 桥靠它把浏览器请求转给真实后端。 */
export function harnessReady(): boolean {
  return existsSync(HARNESS_BIN)
}

// ---- CDP 客户端 ---------------------------------------------------------

/**
 * 一个极简的 Chrome DevTools Protocol 客户端。
 *
 * 只实现测试需要的能力：导航、执行表达式、切视口、截图。
 * 用 Node 内置的全局 `WebSocket`，不引入任何依赖。
 */
export class CdpClient {
  private ws!: WebSocket
  private nextId = 1
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()

  static async launch(chromePath: string, profileDir: string, port: number): Promise<CdpClient> {
    const chrome = spawn(
      chromePath,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--hide-scrollbars',
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profileDir}`,
        'about:blank',
      ],
      { stdio: 'ignore' },
    )
    const client = new CdpClient()
    client.chrome = chrome

    // 等 DevTools 端点就绪
    let target: { webSocketDebuggerUrl: string } | null = null
    const deadline = Date.now() + 20000
    while (Date.now() < deadline && !target) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
        target = list.find((t: { type: string }) => t.type === 'page') ?? null
      } catch {
        /* 还没起来 */
      }
      if (!target) await sleep(250)
    }
    if (!target) {
      chrome.kill()
      throw new Error('Chrome DevTools 端点未就绪')
    }

    client.ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise<void>((res, rej) => {
      client.ws.addEventListener('open', () => res(), { once: true })
      client.ws.addEventListener('error', rej, { once: true })
    })
    client.ws.addEventListener('message', (ev) => {
      const m = JSON.parse((ev as MessageEvent).data)
      const p = client.pending.get(m.id)
      if (!p) return
      client.pending.delete(m.id)
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result)
    })
    await client.send('Page.enable')
    await client.send('Runtime.enable')
    return client
  }

  private chrome: ChildProcess | null = null

  async send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = this.nextId++
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.delete(id)) rej(new Error(`CDP 超时: ${method}`))
      }, 30000)
    })
  }

  /** 在页面里执行表达式并取回可序列化结果。 */
  async evaluate<T = any>(expression: string): Promise<T> {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    return r.result?.value as T
  }

  async setViewport(width: number, height: number): Promise<void> {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: false,
    })
  }

  async navigate(url: string): Promise<void> {
    await this.send('Page.navigate', { url })
  }

  /**
   * 派发一次真实按键（用于触发应用自己的快捷键处理）。
   *
   * 注意 `modifiers` 的位值：CDP 的定义是 Alt=1 / Ctrl=2 / Meta=4 /
   * Shift=8 —— **直接相加**，不要再左移。早前写成 `1 << bit` 会得到
   * 16（Meta），被 CDP 掩码成 0，修饰键静默丢失、快捷键全部失灵。
   */
  async pressKey(key: string, modifiers: Array<'Alt' | 'Control' | 'Meta' | 'Shift'> = []): Promise<void> {
    const MOD_BITS: Record<string, number> = { Alt: 1, Control: 2, Meta: 4, Shift: 8 }
    const map: Record<string, { code: number; key: string }> = {
      Escape: { code: 27, key: 'Escape' },
      Enter: { code: 13, key: 'Enter' },
      Tab: { code: 9, key: 'Tab' },
      ArrowDown: { code: 40, key: 'ArrowDown' },
      ArrowUp: { code: 38, key: 'ArrowUp' },
    }
    const def = map[key] ?? {
      code: key.toUpperCase().charCodeAt(0),
      key: key.toLowerCase(),
    }
    const mods = modifiers.reduce((acc, m) => acc + (MOD_BITS[m] ?? 0), 0)
    const base = {
      modifiers: mods,
      key: def.key,
      code: def.key.length === 1 ? `Key${def.key.toUpperCase()}` : def.key,
      windowsVirtualKeyCode: def.code,
    }
    await this.send('Input.dispatchKeyEvent', { ...base, type: 'keyDown' })
    await this.send('Input.dispatchKeyEvent', { ...base, type: 'keyUp' })
  }

  /**
   * 在元素中心点做一次真实点击。
   *
   * 用 CDP 的鼠标事件而不是 `element.click()`——ProseMirror 依赖
   * mousedown 的坐标来把选区落到对应位置，合成点击不带坐标，
   * 光标不会真正进入元素（表格列宽拖拽柄就因此测不到：它是
   * prosemirror-tables 以 Decoration 形式挂在**光标所在单元格**上的）。
   */
  async clickElement(selector: string): Promise<boolean> {
    const box = await this.evaluate<{ x: number; y: number } | null>(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return null
      el.scrollIntoView({ block: 'center' })
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
    })()`)
    if (!box) return false
    const base = { x: box.x, y: box.y, button: 'left', clickCount: 1 }
    // `buttons` 告诉浏览器当前按下的是哪个键——缺了它，
    // mousePressed 可能被当成纯移动事件，编辑器不会更新选区。
    await this.send('Input.dispatchMouseEvent', { ...base, type: 'mouseMoved', buttons: 0 })
    await this.send('Input.dispatchMouseEvent', { ...base, type: 'mousePressed', buttons: 1 })
    await this.send('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased', buttons: 0 })
    return true
  }

  /** 在当前焦点处插入文本（等价于用户按键，但不受键盘布局影响）。 */
  async insertText(text: string): Promise<void> {
    await this.send('Input.insertText', { text })
  }

  /** 把焦点移到编辑器正文。 */
  async focusEditor(): Promise<void> {
    await this.evaluate(`(() => {
      const el = document.querySelector('.ProseMirror')
      if (el) { el.focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r) }
      return true
    })()`)
  }

  /**
   * 把鼠标移动到指定坐标（不点击）。
   *
   * 表格列宽拖拽柄由 prosemirror-tables 在**鼠标悬停到列边界附近**
   * 时才生成（`activeHandle` 机制），因此要测它必须模拟移动而不是点击。
   */
  async hoverAt(x: number, y: number): Promise<void> {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 })
  }

  /**
   * 把鼠标移到元素的某个横向位置（相对元素左边缘的偏移比例）。
   */
  async hoverElementEdge(selector: string, edge: 'right' | 'left' = 'right'): Promise<boolean> {
    const box = await this.evaluate<{ x: number; y: number } | null>(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return null
      el.scrollIntoView({ block: 'center' })
      const r = el.getBoundingClientRect()
      return {
        x: Math.round(${JSON.stringify(edge)} === 'right' ? r.right - 1 : r.left + 1),
        y: Math.round(r.y + r.height / 2),
      }
    })()`)
    if (!box) return false
    await this.hoverAt(box.x, box.y)
    return true
  }

  async close(): Promise<void> {
    try { this.ws?.close() } catch { /* ignore */ }
    this.chrome?.kill()
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ---- 测试环境 -----------------------------------------------------------

export interface Harness {
  /** preview 服务的地址（浏览器打开它）。 */
  url: string
  /** 打开的文件所在的目录（工作区根）。 */
  workspaceDir: string
  /** 在工作区里写一个文件，返回其绝对路径。 */
  writeFile(name: string, content: string): string
  /** 停掉 preview 服务并删除临时目录。 */
  stop(): void
}

/**
 * 构建生产产物并起一个 preview 服务（带 IPC 桥）。
 *
 * 产物构建到**临时目录**而不是仓库的 `dist/`——测试不该改动工作区。
 * 注意 IPC 桥的 index.html 路径取自实际 outDir（见
 * `scripts/vite-ipc-bridge.ts`），两者必须一致，否则资源 404 白屏。
 */
export async function startHarness(opts: {
  files: Record<string, string>
  /** 预置的 config.toml（省略则用默认配置）。 */
  configToml?: string
  /** 端口；0 表示随机。 */
  port?: number
} = { files: {} }): Promise<Harness> {
  const workDir = mkdtempSync(join(tmpdir(), 'markpure-ui-'))
  const configDir = join(workDir, 'config')
  const wsDir = join(workDir, 'ws')
  const outDir = join(workDir, 'dist')
  mkdirSync(configDir, { recursive: true })
  mkdirSync(wsDir, { recursive: true })
  for (const [name, content] of Object.entries(opts.files)) {
    writeFileSync(join(wsDir, name), content)
  }
  if (opts.configToml) writeFileSync(join(configDir, 'config.toml'), opts.configToml)

  execFileSync('npx', ['vite', 'build', '--outDir', outDir, '--emptyOutDir'], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
  })

  const port = opts.port ?? 4200 + Math.floor(Math.random() * 400)
  // `--port 0`：让操作系统分配一个空闲端口。两处理由：
  // 1. 随机端口可能撞上**上一次运行残留的** preview 服务——
  //    `--strictPort` 会让新 preview 启动失败，而 HTTP 探测又会打到
  //    那个残留服务上（它服务的是已被删除的临时目录），于是页面加载
  //    失败、所有断言莫名其妙地挂掉。
  // 2. 端口冲突是这个测试最容易踩的坑，值得从根上避免。
  const preview = spawn(
    'npx',
    [
      'vite', 'preview',
      '--port', '0',
      '--strictPort',
      // `--host 127.0.0.1`：显式绑 IPv4。默认绑 `localhost` 时 macOS 会
      // 优先解析到 ::1，用 127.0.0.1 连就会连接失败。
      '--host', '127.0.0.1',
      '--outDir', outDir,
    ],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        MARKPURE_CONFIG_DIR: configDir,
        MARKPURE_DEV_WORKSPACE: wsDir,
        MARKPURE_IPC_POLL: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      // 独立进程组：`stop()` 时整组一起杀。IPC 桥会 spawn 一个
      // `mt_harness` 子进程，只杀 vite preview 会把它留下来——
      // 残留的 harness 会继续持有工作区与端口。
      detached: true,
    },
  )
  preview.stdout?.setEncoding('utf8')
  preview.stderr?.setEncoding('utf8')

  // 从 vite 的输出里读实际分配的端口
  let actualPort = 0
  const portDeadline = Date.now() + 20000
  while (Date.now() < portDeadline && !actualPort) {
    const chunk = await new Promise<string>((res) => {
      const onData = (d: string) => { preview.stdout?.off('data', onData); res(d) }
      preview.stdout?.once('data', onData)
      setTimeout(() => { preview.stdout?.off('data', onData); res('') }, 1000)
    })
    const m = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(chunk)
    if (m) actualPort = Number(m[1])
  }
  if (!actualPort) {
    preview.kill()
    rmSync(workDir, { recursive: true, force: true })
    throw new Error('preview 服务未能在 20s 内报告端口')
  }

  // 等 preview 真的能响应
  const deadline = Date.now() + 20000
  let ready = false
  while (Date.now() < deadline && !ready) {
    try {
      const r = await fetch(`http://127.0.0.1:${actualPort}/`)
      ready = r.ok
    } catch {
      /* 还没起来 */
    }
    if (!ready) await sleep(250)
  }
  if (!ready) {
    stopProcessGroup(preview)
    rmSync(workDir, { recursive: true, force: true })
    throw new Error('preview 服务未能在 20s 内就绪')
  }
  // bridge 会自动注册工作区；给它一点时间
  await sleep(1500)

  return {
    url: `http://127.0.0.1:${actualPort}/`,
    workspaceDir: wsDir,
    writeFile(name: string, content: string) {
      const p = join(wsDir, name)
      writeFileSync(p, content)
      return p
    },
    stop() {
      stopProcessGroup(preview)
      rmSync(workDir, { recursive: true, force: true })
    },
  }
}

/** 杀掉整个进程组（含 vite spawn 出来的 `mt_harness` 子进程）。 */
function stopProcessGroup(proc: ChildProcess): void {
  try {
    // 负的 pid 表示「整个进程组」。IPC 桥 spawn 的 mt_harness 是
    // vite 的子进程，不一起杀会残留。
    process.kill(-proc.pid!, 'SIGTERM')
  } catch {
    try { proc.kill('SIGTERM') } catch { /* 已经退出 */ }
  }
}

// ---- 页面操作助手 -------------------------------------------------------

/**
 * 在文件树里点开某个文件。
 *
 * 文件树是异步渲染的（要走 IPC），因此这里重试若干次。
 * 返回是否点开成功——调用方应把它当成一条断言。
 */
export async function openFileInTree(
  cdp: CdpClient,
  fileName: string,
  tries = 5,
): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    const clicked = await cdp.evaluate<boolean>(`(() => {
      const all = [...document.querySelectorAll('*')].filter(
        n => (n.textContent||'').trim() === ${JSON.stringify(fileName)} && n.children.length === 0)
      const el = all[0]
      if (!el) return false
      const t = el.closest('[role=button], .tree-item, button') || el
      t.click()
      return true
    })()`)
    if (clicked) {
      await sleep(1800)
      if (await cdp.evaluate(`!!document.querySelector('.ProseMirror')`)) return true
    } else {
      await sleep(800)
    }
  }
  return false
}

/** 当前激活的标签页名。 */
export function activeTabName(cdp: CdpClient): Promise<string | null> {
  return cdp.evaluate<string | null>(
    `(() => { const t = document.querySelector('.tab.active .tab-name'); return t ? t.textContent : null })()`,
  )
}
