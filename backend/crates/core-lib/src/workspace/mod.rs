//! 工作区模型，拆分为三个子模块。
//!
//! - [`pane`] —— `Pane` + `Orientation`
//! - [`workspace_state`] —— `WorkspaceState`（面板哈希表 + 根/活动标识符）
//! - [`folder`] —— `FolderInfo` + `Workspace`（旧的逐面板文件夹模型，
//!   已被 `crate::workspace_root` 中的多根 `WorkspaceRoot` 取代）
//!
//! 多根工作区系统位于 `crate::workspace_root` 并在 `AppConfig` 上持久化；
//! 此处保留的类型用于向后兼容以及内存中的面板树。

pub mod pane;
pub mod workspace_state;
pub mod folder;

// 重新导出公共类型，使既有的调用点
// （`mt_core::Pane`、`mt_core::WorkspaceState` 等）在拆分后无需改动即可继续工作。
pub use pane::{Orientation, Pane};
pub use workspace_state::WorkspaceState;
pub use folder::{FolderInfo, Workspace};
