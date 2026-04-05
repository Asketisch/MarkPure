# 计划：实现文件管理功能（对齐 milkup，含多窗口）

> 状态：✅ 已实现（阶段 1-3 完成）

## 已完成的功能

### 阶段 1：Rust 基础设施 ✅

#### 1.1 目录扫描 - `crates/mt-fs/src/walk.rs`
```rust
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Vec<FileEntry>,
    pub mtime: Option<f64>,
}
pub async fn walk_directory(path: &Path, depth: u32) -> Result<Vec<FileEntry>>
```

#### 1.2 文件监视 - `crates/mt-fs/src/watcher.rs`
```rust
pub struct FileWatcher { ... }
pub struct FileChangeEvent {
    pub path: String,
    pub kind: String, // "modified" | "created" | "deleted"
}
```

#### 1.3 文件操作 - `crates/mt-fs/src/io.rs`（扩展）
- `create_file()`, `create_directory()`, `delete_file()`, `rename_file()`

#### 1.4 Tab 状态 - `crates/mt-core/src/tab.rs`
```rust
pub struct TabState { id, name, path, content, is_modified, scroll_ratio, read_only }
pub struct WindowTabs { window_id, active_tab_id, tabs }
pub fn load_tabs(config_dir: &Path) -> Result<Vec<WindowTabs>>
pub fn save_tabs(config_dir: &Path, windows: &[WindowTabs]) -> Result<()>
```

#### 1.5 最近文件 - `crates/mt-core/src/config.rs`（扩展）
```rust
pub struct AppConfig {
    pub recent_files: Vec<String>,  // 最多 10 个
    pub last_workspace: Option<String>,
}
impl AppConfig {
    pub fn add_recent_file(&mut self, path: &str)
    pub fn get_recent_files(&self) -> &[String]
    pub fn clear_recent_files(&mut self)
    pub fn set_last_workspace(&mut self, path: Option<String>)
}
```

### 阶段 2：Rust IPC 命令 ✅

**`src-rust/src/main.rs`** 添加了所有 IPC 命令：
- 文件对话框：`pick_open_file`, `pick_save_file`, `pick_directory`
- 文件操作：`open_file`, `save_file`, `get_doc_stats`
- 目录树：`get_directory_tree`, `watch_directory`, `unwatch_directory`
- 文件 CRUD：`create_file`, `create_directory`, `delete_file`, `rename_file`
- 大纲：`get_outline`
- 最近文件：`get_recent_files`, `add_recent_file`, `clear_recent_files`
- Tab 状态：`get_tabs`, `save_tabs`, `tearoff_tab`

### 阶段 3：前端组件 ✅

#### 3.1 文件树 - `src/lib/components/WorkSpace.svelte`
- 打开文件夹工作区
- 树形显示 markdown 文件
- 搜索/过滤
- 右键菜单（新建文件/文件夹、重命名、删除、刷新）

#### 3.2 侧边栏容器 - `src/lib/components/SideBar.svelte`
- 标签切换：文件树 / 大纲
- 可折叠（Ctrl/Cmd+B）
- 与编辑器面板并列显示

#### 3.3 大纲 - `src/lib/components/Outline.svelte`
- 调用 `get_outline` 获取标题
- 点击标题（待实现导航功能）

#### 3.4 App.svelte 重构
- 集成 SideBar
- 调整布局（侧边栏 + 编辑器面板 + 状态栏）
- Workspace 菜单项

#### 3.5 commands.ts 扩展
添加了所有新 IPC 调用的类型和函数。

## 待实现功能

### Tab Tear-off 多窗口（阶段 4）

**状态：部分实现**（Rust 端有 `tearoff_tab` 命令，但实际的窗口创建和事件循环处理未完成）

需要的工作：
- 扩展事件循环支持多窗口
- 子窗口初始化逻辑
- 窗口间通信机制

**参考实现方案：**
```
1. 主窗口通过 `tearoff_tab` 命令创建新窗口
2. 新窗口使用 `--child-window=<base64>` 参数启动
3. 子窗口加载同样的应用但以 tear-off 模式运行
4. 状态通过 tabs.json 文件同步
```

## 验证

```bash
# 编译检查
cargo check --workspace && npm run build

# 开发模式
npm run dev
cargo run -- --dev
```

## 文件清单

| 文件 | 状态 |
|------|------|
| `crates/mt-fs/src/walk.rs` | ✅ 新建 |
| `crates/mt-fs/src/watcher.rs` | ✅ 新建 |
| `crates/mt-fs/src/io.rs` | ✅ 扩展 |
| `crates/mt-core/src/tab.rs` | ✅ 新建 |
| `crates/mt-core/src/config.rs` | ✅ 扩展 |
| `crates/mt-core/src/lib.rs` | ✅ 扩展导出 |
| `crates/mt-markdown/src/lib.rs` | ✅ 添加 extract_headings 导出 |
| `src-rust/src/main.rs` | ✅ 大幅扩展 |
| `src/lib/commands.ts` | ✅ 扩展 |
| `src/lib/components/WorkSpace.svelte` | ✅ 新建 |
| `src/lib/components/SideBar.svelte` | ✅ 新建 |
| `src/lib/components/Outline.svelte` | ✅ 新建 |
| `src/App.svelte` | ✅ 重构 |
| `AGENTS.md` | ✅ 更新 |
