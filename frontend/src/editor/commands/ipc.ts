/**
 * 所有命令包装器共用的 IPC 通信层。
 *
 * 早期它一直位于 `commands.ts`（后来膨胀到 700+ 行）的顶部，
 * 拆分出来后，每个主题模块（file、editor、workspace、export）
 * 只需 `import { ipc }`，不会拖入无关类型。
 *
 * `__mt_dispatch` 全局量由 Rust 宿主通过
 * `wry::WebView::evaluate_script` 注入；对应的 `window.ipc`
 * postMessage 是我们发回命令的方式。环境的类型声明见
 * `frontend/src/lib/ipc.d.ts`。
 */

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  timeoutId?: ReturnType<typeof setTimeout>
}

let nextId = 1
const pending = new Map<number, PendingRequest>()
// 追踪已超时的请求 ID，让 Rust 的迟到响应（超时触发后仍可能到达）
// 不至于石沉大海。我们无法再把它呈现给调用方——其 Promise 早已
// 落定——但可以记录日志，让用户（和 CI）发现长期缓慢的 IPC 路径。
// 迟到响应若永远不到（例如后端 panic），对应 id 永远不会被移除——
// 因此限制集合大小，只保留最近的一批（Set 保持插入顺序）。
const timedOut = new Set<number>()
const TIMED_OUT_MAX = 100

// IPC 请求的默认超时（30 秒）
const DEFAULT_TIMEOUT_MS = 30000

// 由 Rust 通过 evaluate_script 调用
window.__mt_dispatch = (json: string) => {
  try {
    const resp = JSON.parse(json)
    const req = pending.get(resp.id)
    if (!req) {
      // 要么是重复派发，要么是超时后的迟到响应。我们把迟到的情况
      // 显式呈现，让长期缓慢的处理器变得可见。
      if (timedOut.has(resp.id)) {
        timedOut.delete(resp.id)
        console.warn(
          `[IPC] Late response for request ${resp.id} (already timed out)` +
          (resp.error ? ` — backend error: ${resp.error}` : ' — backend returned result')
        )
      }
      return
    }
    if (req.timeoutId) clearTimeout(req.timeoutId)
    pending.delete(resp.id)
    if (resp.error) {
      req.reject(new Error(resp.error))
    } else {
      req.resolve(resp.result)
    }
  } catch (e) {
    console.error('[IPC] Failed to parse response:', e)
  }
}

/**
 * 向 Rust 宿主发送命令。返回的 promise 以 `result` 字段 resolve，
 * 或以 `error` 字符串 reject。
 *
 * 对 `T` 泛型，调用方无需逐处 `as Foo` 断言即可拿到类型化返回值。
 */
export function ipc<T = unknown>(
  cmd: string,
  params: object = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = nextId++
    const timeoutId = setTimeout(() => {
      const req = pending.get(id)
      if (req) {
        pending.delete(id)
        // 标记该 id，便于诊断迟到响应。
        timedOut.add(id)
        if (timedOut.size > TIMED_OUT_MAX) {
          const oldest = timedOut.values().next().value
          if (oldest !== undefined) timedOut.delete(oldest)
        }
        req.reject(new Error(`IPC request '${cmd}' timed out after ${timeoutMs}ms`))
      }
    }, timeoutMs)
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timeoutId })
    window.ipc.postMessage(JSON.stringify({ id, cmd, params }))
  })
}

/** 重置内部待处理请求的记录。供测试与开发工具使用，不用于生产。 */
export function _resetIpcForTests() {
  pending.clear()
  timedOut.clear()
  nextId = 1
}
