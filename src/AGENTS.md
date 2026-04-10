# AGENTS.md — 前端 (Svelte 5 + Tiptap)

## 目录结构

```
src/
├── main.ts          # 应用入口，mount App 到 #app
├── App.svelte       # 主组件：菜单栏、标签栏、工具栏、编辑器容器、状态栏
├── app.css          # 全局样式 + Tiptap ProseMirror 编辑器渲染样式 + 6 个主题的 CSS 变量
└── lib/
    ├── editor.ts    # Tiptap 编辑器工厂函数（createEditor, getMarkdown, setContent）
    ├── commands.ts  # 自定义 IPC 封装（所有命令 + TypeScript 接口定义）
    ├── i18n.svelte.ts  # 响应式 i18n（createI18n/useI18n/t()），基于 Svelte 5 runes
    ├── components/
    │   ├── SideBar.svelte          # 侧边栏容器（文件树/大纲/书签标签切换，可折叠，横向布局）
    │   ├── WorkSpace.svelte        # 文件树浏览器（搜索、递归树、右键菜单 CRUD）
    │   ├── Outline.svelte          # 文档大纲（直接从 ProseMirror doc 提取标题，零 IPC）
    │   ├── Bookmarks.svelte        # 书签管理（增删改查、标签过滤、i18n 接入）
    │   ├── SearchBar.svelte        # 搜索替换栏（正则/大小写/全词匹配）
    │   ├── WorkspaceSearch.svelte  # 工作区全文搜索（防抖 + 请求序列号 + i18n）
    │   ├── Settings.svelte         # 设置面板（通用/外观/快捷键/关于，i18n 接入）
    │   ├── EmptyState.svelte       # 欢迎页（打开文件/文件夹，i18n 接入）
    │   ├── ContextMenu.svelte      # 通用右键菜单
    │   ├── Dialog.svelte           # 模态对话框（确认/输入）
    │   ├── SourceEditor.svelte     # 源码模式编辑器（CodeMirror 6，字体用 CSS 变量）
    │   ├── QuickInsertPopup.svelte # @ 快速插入弹窗（标题、代码块、表格等）
    │   ├── ColorPicker.svelte      # 颜色选择器（主题颜色编辑）
    │   └── ThemeEditor.svelte      # 主题编辑器（自定义主题编辑）
    ├── extensions/
    │   ├── code-block-cm-extension.ts  # Tiptap 扩展：CodeMirror 代码块节点
    │   ├── math-extension.ts           # Tiptap 扩展：KaTeX 数学公式
    │   ├── instant-render-extension.ts # Tiptap 扩展：即时渲染注册
    │   ├── search-extension.ts         # Tiptap 扩展：搜索注册
    │   ├── quick-insert-extension.ts   # Tiptap 扩展：@ 快速插入
    │   ├── quick-insert-config.ts      # 快速插入的命令配置列表
    │   └── cm-theme.ts                 # CodeMirror 主题（跟随 app 主题 CSS 变量）
    ├── plugins/
    │   ├── instant-render.ts   # ProseMirror 插件：Typora 风格即时渲染（增量装饰更新）
    │   └── search.ts           # ProseMirror 插件：搜索高亮 + 位置映射
    └── nodeviews/
        └── code-block-view.ts  # ProseMirror NodeView：CodeMirror 6 代码块编辑器
```

## App.svelte 状态模型

使用 Svelte 5 runes：

```
i18n: I18n              # 响应式 i18n 实例（createI18n()，通过 Svelte context 向下传递）
tabs: Tab[]              # 打开的文档列表，每个含 { id, path, name, dirty, content }
activeTabId: number      # 当前激活的标签 ID
editor: Editor|null      # Tiptap Editor 实例（标签切换时 destroy 重建）
stats: DocStats          # 实时统计（通过 Rust 文档注册表计算）
theme: string            # '' | 'theme-dark' | 'theme-one-dark' | 'theme-graphite' | 'theme-ulysses' | 'theme-material-dark'
saving: boolean          # 保存中状态
workspacePath: string | null  # 工作区目录路径
showSidebar: boolean     # 侧边栏可见性
sourceMode: boolean      # 源码模式开关
instantRenderEnabled: boolean  # 即时渲染开关
```

### 配置变更回调

Settings 组件通过 `onConfigChange` 回调通知 App.svelte，实现设置立即生效：

```typescript
handleConfigChange(updates) → {
  theme → 直接更新 CSS class
  editor → applyEditorConfig() → 设置 CSS 变量 --editor-font-family / --editor-font-size
  language → i18n.changeLocale() → 所有 t() 自动刷新
}
```

## 编辑器生命周期

1. `initEditor()` — 销毁旧实例 → 清空容器 → `docOpen(tabId, content)` 注册到 Rust → `createEditor()` 创建 Tiptap 实例
2. 标签切换时先保存当前内容到 tab.content，再 initEditor 加载新标签内容
3. `onChange` 回调：`editor.getMarkdown()` → 更新 tab.content → `syncToRust(tabId, md)` 同步到 Rust 文档注册表 → `updateStats(tabId)` 从 Rust 获取统计
4. 关闭标签页时 `docClose(tabId)` 从 Rust 注销
5. **关键**：`createEditor()` 必须设置 `contentType: 'markdown'`，否则表格等语法不渲染

## Tiptap 扩展配置

所有扩展在 `lib/editor.ts` 的 `createEditor()` 中统一配置：

| 扩展 | 来源 | 说明 |
|------|------|------|
| StarterKit | @tiptap/starter-kit | 段落、标题(H1-H6)、加粗、斜体、删除线、引用、列表、水平线（codeBlock 禁用） |
| Markdown | @tiptap/markdown | Markdown 双向转换 |
| Table + Row/Cell/Header | @tiptap/extension-table | 表格编辑（resizable: true） |
| TaskList + TaskItem | @tiptap | 任务列表（checkbox，嵌套） |
| Image / Link | @tiptap | 图片和链接 |
| Placeholder | @tiptap | 空文档占位文本 |
| Highlight | @tiptap | 文本高亮 |
| CodeBlockCMExtension | 自定义 | CodeMirror 6 代码块（替代 StarterKit 默认代码块） |
| MathExtension | 自定义 | KaTeX 行内/块级数学公式 |
| InstantRenderExtension | 自定义 | Typora 风格即时渲染 |
| SearchExtension | 自定义 | 搜索高亮 |
| QuickInsertExtension | 自定义 | @ 触发的命令面板 |

## 关键插件

### 即时渲染 (`plugins/instant-render.ts`)

Typora 风格：光标附近显示 `**`、`*`、`` ` `` 等 Markdown 语法标记，远离时隐藏。

性能优化：
- 装饰集 (`DecorationSet`) 缓存在插件 state 中
- 光标移动时仅更新旧/新光标所在的顶层块（`findAffectedRange` + `doc.nodesBetween`）
- 文档变更时全量重建装饰
- 支持：标题 `#`、引用块 `>`、粗体、斜体、删除线、行内代码、高亮

### 搜索 (`plugins/search.ts`)

- `getDocText()` 使用 `doc.textBetween()` 提取文本 + 构建位置映射
- 支持正则、大小写敏感、全词匹配
- 文档变更时自动重新搜索
- `replaceAll` 从后往前替换（避免位置偏移）

### 代码块 (`nodeviews/code-block-view.ts`)

- 每个代码块嵌入独立的 CodeMirror 6 实例
- 支持 14+ 种语言语法高亮（JS/TS/Python/Go/Java/C/Rust/SQL/HTML/CSS/JSON/XML/YAML/Markdown）
- 使用 `Compartment` 实现语言和主题的动态切换
- 暗色模式自动检测（检查 `.app-root` 的 class）

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| Cmd/Ctrl+N | 新建标签 |
| Cmd/Ctrl+O | 打开文件 |
| Cmd/Ctrl+S | 保存 |
| Cmd/Ctrl+B | 切换侧边栏 |
| Cmd/Ctrl+F | 搜索 |
| Cmd/Ctrl+/ | 切换源码模式 |

## IPC 调用模式

```typescript
import { docGetStats, docSetContent, saveFile } from '$lib/commands'

// 文档注册表命令（零拷贝）
await docOpen(tabId, content)         // 注册文档
await docSetContent(tabId, markdown)  // 同步内容
const stats = await docGetStats(tabId) // 获取统计

// 文件操作命令
await saveFile(path, content)
```

`commands.ts` 导出所有命令的封装函数和 TypeScript 接口定义（`FileInfo`、`DocStats`、`FileEntry`、`TabState`、`WindowTabs`、`OutlineItem`、`AppConfig`、`SearchMatch`、`FileChangeEvent`）。

## Svelte 5 模式

- **Runes**：使用 `$state()`、`$derived()`、`$effect()`、`$props()`，不使用旧版 `$:` 语法
- **`{#snippet}` / `{@render}`**：WorkSpace.svelte 使用此模式实现递归文件树渲染
- **`$effect()` 响应式**：Outline.svelte 在 editor 变化时自动提取大纲；WorkSpace.svelte 在 workspacePath 变化时自动加载文件树

## 样式约定

- 全局颜色通过 CSS 变量定义在 `app.css` 的 `:root` / `.theme-dark` / `.theme-one-dark` / `.theme-graphite` / `.theme-ulysses` / `.theme-material-dark`
- 编辑器字体通过 CSS 变量 `--editor-font-family` 和 `--editor-font-size` 控制，由 `applyEditorConfig()` 动态设置
- Tiptap 编辑器内容样式写在 `.ProseMirror` 选择器下，字体使用 `var(--editor-font-family)` / `var(--editor-font-size)`
- 工具栏按钮 `.tb-btn`，分隔线 `.tb-sep`，状态栏 `.status-bar`，标签栏 `.tab-bar`
- 每个组件使用 Svelte scoped `<style>` 块

## i18n 使用模式

```typescript
// 在根组件 App.svelte 中创建
import { createI18n } from '$lib/i18n.svelte'
const i18n = createI18n()
// onMount 中调用 i18n.init() 加载翻译

// 在子组件中使用
import { useI18n } from '$lib/i18n.svelte'
const i18n = useI18n()
// 模板中：{i18n.t('menu.file')}
```
