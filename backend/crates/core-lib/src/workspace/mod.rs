//! Workspace model split into three submodules.
//!
//! - [`pane`]            — `Pane` + `Orientation`
//! - [`workspace_state`] — `WorkspaceState` (the panes HashMap + root/active ids)
//! - [`folder`]          — `FolderInfo` + `Workspace` (the older
//!                          per-pane folder model; superseded by the
//!                          P2-4 `WorkspaceRoot` in `crate::workspace_root`)
//!
//! The P2-4 multi-root system lives in `crate::workspace_root` and is
//! persisted on the `AppConfig`; the types here are kept for
//! backward compatibility and the in-memory pane tree.

pub mod pane;
pub mod workspace_state;
pub mod folder;

// Re-export the public types so existing call sites
// (`mt_core::Pane`, `mt_core::WorkspaceState`, ...) keep working
// unchanged after the split.
pub use pane::{Orientation, Pane};
pub use workspace_state::WorkspaceState;
pub use folder::{FolderInfo, Workspace};
