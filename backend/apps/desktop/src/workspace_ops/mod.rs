//! Workspace-level IPC handlers.
//!
//! Topic: app-wide state that isn't a single document or a
//! markdown-extension helper. Tab persistence, config
//! get/set, recent files, theme / keymap / i18n registry,
//! bookmarks, app info, multi-root workspace, and folder
//! scans (tags / snippets / styles / backlinks).
//!
//! Anything that's "what does the app look like" rather than
//! "what does this document contain" lives here.
//!
//! # Submodules
//!
//! - [`tabs`]          — tab persistence (`get_tabs` / `save_tabs` / `tearoff_tab`)
//! - [`config_io`]     — `get_config` / `set_config` / recent files / expanded dirs
//! - [`i18n_keys`]     — `get_locale` / `set_locale` / `get_translations`
//! - [`keybindings`]   — keybinding get/set/reset/update
//! - [`themes`]        — `get_themes` / import / export / delete
//! - [`bookmarks`]     — bookmark CRUD
//! - [`workspace_scans`] — tag index / snippets / per-workspace CSS / backlinks
//! - [`app_info`]      — `get_app_info`
//! - [`workspace_roots`] — multi-root workspace IPC (P2-4)

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

// Re-export every `cmd_*` so existing call sites
// (`workspace_ops::cmd_foo`, the dispatch table) keep working
// unchanged after the split.
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
