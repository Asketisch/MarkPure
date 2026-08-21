//! 工作区级的 IPC 处理器。
//!
//! 主题：不属于单个文档或 Markdown 扩展辅助的全应用状态。
//! 标签页持久化、配置读写、最近文件、主题 / 快捷键 / i18n 注册表、
//! 书签、应用信息、多根目录工作区，以及文件夹扫描
//! （标签 / 片段 / 样式 / 反链）。
//!
//! 凡是「应用长什么样」而不是「这个文档里有什么」的内容都放在这里。
//!
//! # 子模块
//!
//! - [`tabs`]          —— 标签页持久化（`get_tabs` / `save_tabs` / `tearoff_tab`）
//! - [`config_io`]     —— `get_config` / `set_config` / 最近文件 / 展开目录
//! - [`i18n_keys`]     —— `get_locale` / `set_locale` / `get_translations`
//! - [`keybindings`]   —— 快捷键读写 / 重置 / 更新
//! - [`themes`]        —— `get_themes` / 导入 / 导出 / 删除
//! - [`bookmarks`]     —— 书签 CRUD
//! - [`workspace_scans`] —— 标签索引 / 片段 / 按工作区 CSS / 反链
//! - [`app_info`]      —— `get_app_info`
//! - [`workspace_roots`] —— 多根目录工作区 IPC

pub mod tabs;
pub mod config_io;
pub mod i18n_keys;
pub mod keybindings;
pub mod themes;
pub mod bookmarks;
pub mod workspace_scans;
pub mod backlinks;
pub mod app_info;
pub mod workspace_roots;

// 再导出所有 `cmd_*`，让现有调用点（`workspace_ops::cmd_foo`、调度表）
// 在拆分后无需改动即可继续工作。
pub use tabs::*;
pub use config_io::*;
pub use i18n_keys::*;
pub use keybindings::*;
pub use themes::*;
pub use bookmarks::*;
pub use workspace_scans::*;
pub use backlinks::*;
pub use app_info::*;
pub use workspace_roots::*;
