//! Application configuration: per-user settings that survive
//! across launches. Stored as TOML at the OS-appropriate path
//! returned by [`AppConfig::config_path`].
//!
//! The 530-line monolith used to live in `config.rs`. It is now
//! split into:
//!
//! - [`legacy`] — the `AppConfig` struct itself plus the
//!   load/save/migrate machinery and the per-field CRUD
//!   (recent files, language, theme, editor prefs).
//! - [`workspace_roots`] — the multi-root workspace helpers
//!   (`add_workspace_root`, `remove_workspace_root`,
//!   `set_active_workspace_root`, per-root expanded dirs).
//!
//! Both files declare `impl AppConfig` blocks so the public API
//! is unchanged — callers see the same method set, the split
//! is purely an implementation detail.

mod legacy;
mod workspace_roots;

// `legacy.rs` already declares `pub struct AppConfig` plus its
// inherent methods; we re-export the type here so the public
// path stays `mt_core::AppConfig`. The `workspace_roots` mod
// adds more inherent methods via its own `impl AppConfig` block.
pub use legacy::AppConfig;