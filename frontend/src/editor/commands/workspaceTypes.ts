/**
 * 应用级（非文档）IPC 包装的共享数据类型。
 * 从 `workspace.ts` 中拆出，让类型定义紧邻其使用者，同时不
 * 臃肿 IPC 函数文件。这些都是纯粹的数据契约——每一个都会
 * 经 JSON 往返到 Rust 宿主——审查时在这里核对结构、在
 * `workspace.ts` 里核对 IPC 命令名即可。
 */

/** 单条书签。`workspace_root_id` 把书签关联到某个多根工作区成员，
 *  这样移除根目录时可以顺带清理其书签。 */
export interface Bookmark {
  id: string
  path: string
  title: string
  description: string
  tags: string[]
  created_at: number
  updated_at: number
  /** 该书签属于哪个 WorkspaceRoot.id。 */
  workspace_root_id?: string | null
}

/** 用户可配置的键盘绑定。`accelerator` 是平台无关的字符串形式
 *  （`CmdOrCtrl+Shift+A`）；宿主派发时按操作系统翻译。 */
export interface KeyBinding {
  id: string
  label: string
  accelerator: string | null
}

/** 偏好设置的导出负载。`config` 是序列化后的 `AppConfig`（部分字段
 *  + 自由键，这样未来的新字段不会破坏旧备份）；`keybindings` 与
 *  `themes` 是原始 JSON 数组，导入时由宿主重新校验。 */
export interface ConfigExportPayload {
  version: number
  app: string
  exported_at: number
  config: {
    theme?: string
    language?: string | null
    last_workspace?: string | null
    editor?: Record<string, unknown>
    vim_mode?: boolean
    [key: string]: unknown
  }
  keybindings: unknown[]
  themes: unknown[]
}

/** `cmd_import_config` 生成的报告——设置对话框在恢复后闪烁显示的一行摘要。 */
export interface ConfigImportReport {
  ok: boolean
  restored: string[]
  themes_restored: number
  themes_skipped: number
  keybindings_restored: number
}

/** 当前界面语言 + 可用语言的目录（`available` 是 `[code, displayName]` 对）。 */
export interface LocaleInfo {
  current: string
  available: [string, string][]
  translations: Record<string, string>
}

/** 静态的应用横幅信息。 */
export interface AppInfo {
  name: string
  version: string
  description: string
}

/** 单个工作区根目录——用户添加到当前多根工作区的文件夹。`id`
 *  在重启之间保持稳定（被 TabState.workspace_root_id、监视句柄、
 *  LRU 清理使用），`added_at` 是 unix 秒时间戳。`exists` 在每次
 *  `list_workspace_roots` IPC 时重新计算，路径缺失（例如外部磁盘
 *  被卸载）时为 `false`。我们不会自动删除缺失的根目录——必须由
 *  用户显式调用 `remove_missing_workspace_roots`。 */
export interface WorkspaceRoot {
  id: string
  path: string
  name: string
  added_at: number
  exists?: boolean
}

export interface WorkspaceRoots {
  roots: WorkspaceRoot[]
  active_id: string | null
}

/** 工作区级标签索引中的单个条目。`count` 是该标签在整个工作区
 *  中的出现总次数，`files` 是至少包含一次该标签的文件路径去重集合。 */
export interface WorkspaceTag {
  name: string
  count: number
  files: string[]
}

/** 单条反向链接命中：`source_path` 是包含 `[[page]]` 的文件，
 *  `line` 是从 1 开始的行号，`context` 是该行去除首尾空白后的摘录。 */
export interface Backlink {
  source_path: string
  line: number
  context: string
}

/** 拼接后的每工作区 CSS + 构建它所用的源文件名（供设置页调试视图使用）。 */
export interface WorkspaceStyles {
  css: string
  files: string[]
}

/** 用户自定义片段：`name` 是短代码，`content` 是展开后的 markdown 文本。 */
export interface Snippet {
  name: string
  content: string
}