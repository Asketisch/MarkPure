//! 文件系统相关的 IPC 处理器。
//!
//! 职责范围：在工作区内打开 / 保存 / 增删改查文件。
//! “工作区”这一概念在 IPC 层强制落实，因为只有桌面宿主
//! 才知道用户当前打开了哪个目录；`fs` crate 保持通用、不感知工作区。
//!
//! 路径校验集中在 [`path_guard::ensure_path_in_workspace`]，
//! 这样未来新增的 CRUD 处理器都可以采用同一套策略。
//!
//! # 子模块
//!
//! - [`dialogs`]    —— `pick_open_file` / `pick_save_file` / `pick_directory`
//! - [`open_save`]  —— `open_file` / `save_file` / `get_doc_stats`
//! - [`tree_watch`] —— `get_directory_tree` / `watch_directory` / `unwatch_directory`
//! - [`path_guard`] —— `ensure_path_in_workspace` + `active_workspace_root(s)`
//! - [`crud`]       —— 新建 / 删除 / 重命名 / 在访达中显示
//! - [`file_drop`]  —— `open_dropped_files`

pub mod dialogs;
pub mod open_save;
pub mod tree_watch;
pub mod path_guard;
pub mod crud;
pub mod file_drop;

// 重新导出，使拆分后既有的调用点仍能继续使用 `file_ops::cmd_foo` 风格。
pub use dialogs::*;
pub use open_save::*;
pub use tree_watch::*;
pub use path_guard::*;
pub use crud::*;
pub use file_drop::*;
