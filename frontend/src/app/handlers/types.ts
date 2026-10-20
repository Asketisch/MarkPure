/**
 * App 级处理器共用的类型。
 *
 * `Tab` 接口是渲染进程对已打开文档的事实来源。id 是单调递增的
 * `number`（应用运行期间保存在渲染进程；Rust 文档注册表现在以
 * `String` 存储它，用于跨重启持久化）。未保存（未命名）标签页的
 * `path` 为 `null`。
 */
export interface Tab {
  id: number
  path: string | null
  name: string
  dirty: boolean
  content: string
  /** true = 预览标签页（欢迎页“打开文件”流程）。打开其他文件时
   *  关闭，避免残留。 */
  preview?: boolean
  /** 打开时的文件修改时间（unix 秒，浮点）。用于从磁盘重新加载的
   *  提示，以检测外部改动。 */
  mtime: number | null
  /** 源文件的编码标签（"UTF-8" / "UTF-8 BOM" / "GBK" / …）。
   *  另存为到新路径时沿用它，避免 GBK 文档被存成 UTF-8。 */
  encoding?: string | null
  /** 源文件的行尾（"\n" / "\r\n"）。同上，另存为时沿用。 */
  lineEnding?: string | null
}

/** 一次根切换的驱逐：`set_active_workspace_root` IPC 完成后，
 *  Rust 告诉渲染进程“丢弃这些 doc id”。App 从工作区 store 读取
 *  `evictedDocIds` 并关闭匹配的标签页。 */
export interface DocEviction {
  docIds: string[]
}
