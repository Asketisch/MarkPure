/**
 * 由 Rust WebView 宿主注入的全局量的环境声明
 * （见 `backend/apps/desktop/src/main.rs`）。
 *
 * wry 宿主通过 `webview.evaluate_script` 把
 * `window.__mt_dispatch(json)` 响应推回渲染进程，渲染进程则通过
 * `window.ipc.postMessage(json)` 推送请求。在此声明，调用方就
 * 不必写 `(window as any).ipc` / `(window as any).__mt_dispatch`
 * 之类的类型断言。
 *
 * 每当新增 `__mt_*` 全局量时，请保持本文件与 `main.rs` 同步。
 */

export {}

declare global {
  interface Window {
    /** 出站 IPC。由前端推送，经 `wry::WebView::evaluate_script`
     *  派发给 Rust。 */
    ipc: {
      postMessage: (json: string) => void
    }
    /** 入站 IPC。Rust 在命令响应就绪时推送；渲染进程解析 JSON
     *  并 resolve 匹配的待处理 Promise。 */
    __mt_dispatch: (json: string) => void
    /** 渲染进程希望 Rust 开始推送文件监视事件时设置。Rust 以 JSON
     *  字符串（事件数组）调用它，包装层负责解析。 */
    __mt_on_file_changes: ((json: string) => void) | null
    /** 快速插入弹出层运行时（Tiptap suggestion）。严格来说不属于
     *  IPC 桥的一部分，但由编辑器的 QuickInsert 扩展注入。 */
    __qi_props?: unknown
    __qi_active?: number
  }

  interface ImportMetaEnv {
    /** 是否运行在 Vite 的开发服务器下。 */
    readonly DEV: boolean
    /** 是否为生产构建。 */
    readonly PROD: boolean
    /** 是否为 SSR——在我们的纯客户端应用里恒为 false。 */
    readonly SSR: boolean
  }
}
