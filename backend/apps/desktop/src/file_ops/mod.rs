//! File-system IPC handlers.
//!
//! Topic: opening / saving / CRUD-ing files inside a workspace.
//! The "workspace" concept is enforced here at the IPC layer
//! because only the desktop host knows which directory the
//! user has open; the `fs` crate stays generic.
//!
//! Path validation lives in [`path_guard::ensure_path_in_workspace`]
//! so any future CRUD handler can adopt the same policy.
//!
//! # Submodules
//!
//! - [`dialogs`]    — `pick_open_file` / `pick_save_file` / `pick_directory`
//! - [`open_save`]  — `open_file` / `save_file` / `get_doc_stats`
//! - [`tree_watch`] — `get_directory_tree` / `watch_directory` / `unwatch_directory`
//! - [`path_guard`] — `ensure_path_in_workspace` + `active_workspace_root(s)`
//! - [`crud`]       — create / delete / rename / reveal-in-finder
//! - [`file_drop`]  — `open_dropped_files`

pub mod dialogs;
pub mod open_save;
pub mod tree_watch;
pub mod path_guard;
pub mod crud;
pub mod file_drop;

// Re-export so existing call sites keep using
// `file_ops::cmd_foo` after the split.
pub use dialogs::*;
pub use open_save::*;
pub use tree_watch::*;
pub use path_guard::*;
pub use crud::*;
pub use file_drop::*;
