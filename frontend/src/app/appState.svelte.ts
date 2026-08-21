/**
 * App.svelte 的集中式 UI / 标签页状态（单一响应式对象）。
 *
 * 为什么集中：App.svelte 曾是 3000+ 行的 god component，各逻辑模块
 * （tabOps / fileOps / editorInit / appEvents …）需要读写同一批状态。
 * 把所有响应式状态收进一个对象后，模块只需拿到
 * `app: AppRef` 即可直接读写（`app.tabs = …`），Svelte 5 的深度
 * 响应式保证模板与 `$effect` 对这些写入保持追踪。
 *
 * 采用 class + `$state` 字段（与 stores/workspace.svelte.ts 的
 * WorkspaceStore 同构）：`$state()` 只允许出现在模块顶层或
 * class 字段位置，不能包在工厂函数里。
 *
 * 刻意**不**放进本对象的：编辑器实例与 DOM 容器引用
 * （`editor` / `editorContainer` / `insertImageInput` 等）——它们需要
 * `$state.raw` 语义（避免 Tiptap Editor 被深度 Proxy 包裹），因此
 * 仍作为 App.svelte 的局部 raw 状态存在，经由访问器注入各模块。
 */
import type { DocStats } from '$lib/editor/commands'
import type { ErrorRange } from '$lib/stores/spellcheck.svelte'
import type { VimMode } from '$lib/plugins/vim'
import type { Tab } from './handlers/types'

/** 「保存后关闭？」提示的四种变体（或 null 表示无提示）。
 *  `kind` 决定用户选择「不保存」或保存成功后续走哪个关闭流程。 */
export type UnsavedClosePrompt =
  | null
  | { tabId: number; name: string; kind: 'single' }
  | { tabId: number; name: string; kind: 'other'; keepId: number }
  | { tabId: number; name: string; kind: 'all' }
  | { tabId: number; name: string; kind: 'right'; anchorId: number }

/** 分屏视图下编辑器布局的三种模式。 */
export type ViewMode = 'wysiwyg' | 'source' | 'split'

/** 链接自动补全的候选项。 */
export interface LinkSuggestItem {
  title: string
  insert: string
  hint?: string
}

/** 从设置读取的编辑器偏好（内存镜像；设置保存时写回）。 */
export interface EditorPrefs {
  font_family: string
  font_size: number
  tab_size: number
  soft_tabs: boolean
  line_numbers: boolean
  word_wrap: boolean
  auto_save_interval: number
}

export class AppShellState {
  tabs = $state<Tab[]>([])
  activeTabId = $state<number | null>(null)
  nextId = $state(1)
  stats = $state<DocStats>({ words: 0, characters: 0, lines: 0 })
  /** 活动编辑器中的次要光标数量（0 = 单光标）。 */
  multiCursorCount = $state(0)
  /** 列选择拖拽状态（Alt+拖拽矩形）。 */
  columnMode = $state(false)
  /** 当前选区包含的字符数（无选区时为 0）。 */
  selectionChars = $state(0)
  showUndoTree = $state(false)
  undoBranchCount = $state(0)
  undoIsForked = $state(false)
  // Vim 模式：镜像插件状态，使状态栏徽标可以渲染。
  vimEnabled = $state(false)
  vimMode = $state<VimMode>('normal')
  vimPending = $state('')
  theme = $state('')
  saving = $state(false)
  /** 最近一次成功保存的时间戳（毫秒）。 */
  savedAt = $state<number | null>(null)
  zenMode = $state(false)
  /** 文件重载提示：设置后弹出对话框询问是否用磁盘版本覆盖。 */
  fileReloadPrompt = $state<{ tabId: number; path: string; fileName: string } | null>(null)
  unsavedClosePrompt = $state<UnsavedClosePrompt>(null)
  workspacePath = $state<string | null>(null)
  showSidebar = $state(true)
  sidebarWidth = $state(260)
  sidebarResizing = $state(false)
  showOutline = $state(false)
  showTags = $state(false)
  showBacklinks = $state(false)
  /** 工作区级 CSS（`.markpure/styles/*.css` 拼接），经 svelte:head 注入。 */
  workspaceStyles = $state('')
  tabContextMenu = $state<{ x: number; y: number; tabId: number } | null>(null)
  /** 拼写检查右键菜单（右键点击 .spell-error 装饰时设置）。 */
  spellMenu = $state<{ x: number; y: number; error: ErrorRange } | null>(null)
  /** 「复制为 Markdown / HTML / 纯文本」右键菜单。 */
  editorContextMenu = $state<{ x: number; y: number } | null>(null)
  showSearch = $state(false)
  /** 窗口级拖拽遮罩激活标记。 */
  windowDragActive = $state(false)
  showWorkspaceSearch = $state(false)
  showTabBar = $state(true)
  showToolbar = $state(true)
  showStatusBarChrome = $state(true)
  /** 「全部折叠 / 展开标题」：经 CSS 隐藏非标题块，文档不被修改。 */
  allHeadingsExpanded = $state(true)
  /** 经 search.workspace_all_roots 打开搜索时置 true。 */
  workspaceAllRoots = $state(false)
  showSettings = $state(false)
  showCommandPalette = $state(false)
  /** 书签侧边栏可见性（Cmd+Shift+B 或命令面板）。 */
  showBookmarks = $state(false)
  /** 快速文件切换器可见性（Cmd+P）。 */
  showQuickSwitcher = $state(false)
  /** 旧的两态标志，与 `viewMode === 'source'` 保持同步。 */
  sourceMode = $state(false)
  sourceContent = $state('')
  viewMode = $state<ViewMode>('wysiwyg')
  splitWidth = $state(50)
  splitResizing = $state(false)
  qiVisible = $state(false)
  qiQuery = $state('')
  qiPosition = $state({ top: 0, left: 0 })
  /** `[text](` 链接自动补全：扩展经 mt:link-suggest-* 事件驱动。 */
  linkSuggestVisible = $state(false)
  linkSuggestQuery = $state('')
  linkSuggestPosition = $state({ top: 0, left: 0 })
  linkSuggestItems = $state<LinkSuggestItem[]>([])
  linkSuggestRange = $state<{ from: number; to: number } | null>(null)
  /** QuickInsertExtension 发来的当前提示属性（避免 window 全局变量）。 */
  qiProps = $state<any>(null)
  /** 每个标签页独立的自动保存定时器。 */
  autoSaveTimers = $state(new Map<number, ReturnType<typeof setTimeout>>())
  autoSaveInterval = $state(3000)
  editorConfig = $state<EditorPrefs>({
    font_family: '',
    font_size: 15,
    tab_size: 4,
    soft_tabs: true,
    line_numbers: false,
    word_wrap: true,
    auto_save_interval: 0,
  })
  isInTable = $state(false)
  /** 字数目标：0 隐藏指示器；>0 显示 当前/目标。 */
  wordCountGoal = $state(0)
  /** 浮动表格工具栏锚点（位于表格内时显示）。 */
  tableBubblePos = $state<{ top: number; left: number } | null>(null)
  /** 「插入链接」URL 输入对话框（快速插入面板的 Link 项触发；
   *  wry WebView 不实现 window.prompt，故走应用内对话框）。 */
  linkUrlPrompt = $state(false)
  /** 启动门控：i18n + 配置加载完成后才渲染首帧。 */
  ready = $state(false)
  /** 防止「打开文件夹」重复点击的守卫。 */
  openWorkspaceBusy = $state(false)
  // 片段选择器
  snippetPickerOpen = $state(false)
  snippetFilter = $state('')
  snippetCache = $state<{ name: string; content: string }[]>([])
  /** 统计 / Rust 同步的防抖定时器句柄（非敏感数据）。 */
  statsTimer = $state<ReturnType<typeof setTimeout> | null>(null)
  syncTimer = $state<ReturnType<typeof setTimeout> | null>(null)
}

export function createAppState(): AppShellState {
  return new AppShellState()
}

export type AppRef = ReturnType<typeof createAppState>

/** 取活动标签页（`activeTabId` 为 null 时返回 undefined）。 */
export function getActiveTab(app: AppRef): Tab | undefined {
  return app.tabs.find(t => t.id === app.activeTabId)
}
