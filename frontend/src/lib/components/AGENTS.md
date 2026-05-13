# AGENTS.md — 前端组件 (Svelte 5)

组件目录，共 15 个 Svelte 组件，其中 6 个为复杂度较高的大文件。

## 组件概览

| 组件 | 文件大小 | 复杂度 | 说明 |
|------|---------|--------|------|
| App.svelte | ~43KB | 最高 | 主容器：菜单栏、标签栏、工具栏、编辑器、状态栏 |
| ThemeEditor.svelte | ~22KB | 高 | 主题编辑器（自定义主题编辑） |
| Settings.svelte | ~18KB | 高 | 设置面板（通用/外观/快捷键/关于） |
| WorkSpace.svelte | ~10KB | 中高 | 文件树浏览器 |
| WorkspaceSearch.svelte | ~9.4KB | 中高 | 工作区全文搜索 |
| SearchBar.svelte | ~6KB | 中 | 搜索替换栏 |
| QuickInsertPopup.svelte | ~5.5KB | 中 | @ 快速插入弹窗 |
| EmptyState.svelte | ~4KB | 低 | 欢迎页 |
| ColorPicker.svelte | ~3.9KB | 低 | 颜色选择器 |
| Dialog.svelte | ~3.5KB | 低 | 模态对话框 |
| ContextMenu.svelte | ~2KB | 低 | 通用右键菜单 |
| SideBar.svelte | ~2.7KB | 低 | 侧边栏容器 |
| Outline.svelte | ~2.4KB | 低 | 文档大纲 |
| SourceEditor.svelte | ~2.4KB | 低 | 源码模式编辑器 |
| OutlinePanel.svelte | ~1.9KB | 低 | 大纲面板（新版） |

## 大组件详细说明

### App.svelte (~43KB)

主应用容器，管理全局状态和编辑器生命周期。

**状态（$state）：**
```typescript
i18n: I18n
tabs: Tab[]
activeTabId: number
editor: Editor | null
stats: DocStats
theme: string
saving: boolean
workspacePath: string | null
showSidebar: boolean
sourceMode: boolean
instantRenderEnabled: boolean
menuVisible: boolean
showTearoff: boolean
```

**关键方法：**
- `initEditor()` — 销毁旧实例 → 清空容器 → `docOpen()` 注册到 Rust → `createEditor()` 创建 Tiptap
- `handleMenuAction(action)` — 分发菜单操作（新建/打开/保存/导出等）
- `handleConfigChange(updates)` — 配置变更回调，更新 theme、CSS 变量、i18n
- `syncToRust(tabId, md)` — 同步内容到 Rust 文档注册表
- `updateStats(tabId)` — 从 Rust 获取统计

**IPC 命令使用：**
- 文档注册：`docOpen`、`docClose`、`docSetContent`、`docGetStats`
- 文件操作：`pickOpenFile`、`pickDirectory`、`openFile`、`saveFile`
- 配置：`getConfig`、`setConfig`
- i18n：`getLocale`、`setLocale`、`getTranslations`

### Settings.svelte (~18KB)

设置面板，支持多标签页（通用/外观/快捷键/关于）。

**状态：**
```typescript
activeTab: 'general' | 'appearance' | 'shortcuts' | 'about'
config: AppConfig
themes: Theme[]
customThemes: Theme[]
```

**关键功能：**
- General：默认编辑器配置（字体大小、自动保存等）
- Appearance：主题选择（6 内置 + 自定义）、编辑器字体
- Shortcuts：快捷键配置（调用 `updateKeybinding` IPC）
- About：应用信息

**配置变更：** 通过 `onConfigChange` 回调通知父组件实时生效

### ThemeEditor.svelte (~22KB)

自定义主题编辑器，支持颜色选择和实时预览。

**状态：**
```typescript
editingTheme: Theme
colors: ThemeColors
previewContent: string
```

**关键功能：**
- 颜色选择器（ColorPicker 组件）选择主题颜色
- 实时预览（应用 CSS 变量到 `.app-root`）
- 导出/导入 JSON 格式主题文件
- 内置 6 主题不可编辑，仅可复制后修改

### WorkSpace.svelte (~10KB)

文件树浏览器，支持工作区目录浏览和文件 CRUD。

**状态：**
```typescript
workspacePath: string
entries: FileEntry[]
expandedDirs: Set<string>
searchQuery: string
contextMenu: { x, y, path } | null
```

**关键功能：**
- 递归目录树（`{#snippet}` / `{@render}` 实现）
- 文件/目录搜索过滤
- 右键菜单：新建文件/目录、重命名、删除
- 拖拽文件到编辑器打开
- 调用 `getDirectoryTree`、`createFile`、`createDirectory`、`deleteFile`、`renameFile` IPC

### WorkspaceSearch.svelte (~9.4KB)

工作区全文搜索面板。

**状态：**
```typescript
query: string
results: SearchMatch[]
searching: boolean
options: { caseSensitive, wholeWord, useRegex }
debounceTimer: number
requestSeq: number
```

**关键功能：**
- 防抖搜索（500ms）
- 请求序列号处理（避免竞态）
- 搜索结果高亮跳转
- 支持正则、全词、大小写选项
- 调用 `searchWorkspace` IPC

### SearchBar.svelte (~6KB)

编辑器内搜索替换栏。

**状态：**
```typescript
query: string
replacement: string
caseSensitive: boolean
wholeWord: boolean
useRegex: boolean
currentIndex: number
matchCount: number
```

**关键功能：**
- 搜索词高亮
- 正则/全词/大小写选项
- 替换当前/替换全部
- 搜索进度指示器
- 调用 `updateSearch` 插件方法

## 通用组件模式

### ContextMenu.svelte

右键菜单组件，通过 CSS 定位，支持以下场景：
- 文件树右键菜单
- 标签栏右键菜单
- 编辑器右键菜单

使用 `onClick` 外部关闭，Escape 键关闭。

### Dialog.svelte

模态对话框，支持 confirm（确认）和 input（输入）两种模式。

```typescript
mode: 'confirm' | 'input'
title: string
message: string
onConfirm: (inputValue?) => void
onCancel: () => void
```

### ColorPicker.svelte

颜色选择器，支持 HEX 颜色输入和预设颜色列表。

```typescript
color: string
onChange: (color) => void
presets: string[]
```

## 组件间通信

- **App → 子组件**：通过 `$props()` 传递回调和配置
- **子组件 → App**：通过 `$props()` 接收的回调函数（如 `onConfigChange`、`onFileOpen`）
- **跨组件**：通过 Svelte Context (`setContext`/`getContext`)
- **i18n**：`useI18n()` 从 Context 获取翻译函数

## 新增组件注意事项

1. 使用 Svelte 5 runes（`$state`、`$derived`、`$effect`、`$props`）
2. 样式使用 scoped `<style>` 块
3. 颜色/字体通过 CSS 变量（`var(--accent)`、`var(--editor-font-family)`）
4. 需要 i18n 时使用 `useI18n()` 获取翻译函数
5. 大组件考虑拆分逻辑到 `*.ts` 文件
