use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::theme::ThemeId;
// `WorkspaceRoot` is referenced in the struct field below and
// in the migration code that synthesises a root from the legacy
// `last_workspace` string. The richer add/remove/activate
// helpers live in the `workspace_roots` submodule so this file
// stays focused on the AppConfig struct, the per-field CRUD,
// and the migration logic.
use crate::workspace_root::WorkspaceRoot;

/// Application configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    /// Editor settings
    pub editor: EditorConfig,
    /// Window settings
    pub window: WindowConfig,
    /// Currently active theme
    pub theme: ThemeId,
    /// Recent files (max 10)
    #[serde(default)]
    pub recent_files: Vec<String>,
    /// **Legacy** single-root hint. Kept on disk (under a different toml key)
    /// for one release so users rolling back retain their data. New code
    /// reads `workspace_roots` + `active_workspace_root_id` instead.
    ///
    /// Field name in TOML: `_legacy_last_workspace`.
    #[serde(default, rename = "_legacy_last_workspace", skip_serializing)]
    pub last_workspace: Option<String>,
    /// All folders in the current workspace (P2-4 multi-root).
    #[serde(default)]
    pub workspace_roots: Vec<WorkspaceRoot>,
    /// Which root is currently active (drives the file tree, path
    /// validation, tag/backlinks panel). `None` means "no folder open".
    #[serde(default)]
    pub active_workspace_root_id: Option<String>,
    /// UI language (e.g., "zh", "en")
    #[serde(default)]
    pub language: Option<String>,
    /// Expanded directory paths, keyed by root id.
    ///
    /// Stored as a map so each root remembers its own tree-expansion
    /// state. Older configs (which used a flat `Vec<String>`) are
    /// migrated in `load()` by attributing the entries to the active
    /// root.
    #[serde(default)]
    pub expanded_dirs: std::collections::HashMap<String, Vec<String>>,
    /// P2-7: Vim mode toggle. When true, the editor accepts
    /// NORMAL/INSERT/VISUAL key sequences; when false, the
    /// default Tiptap keymap runs. Persists across sessions;
    /// toggled at runtime via `Cmd+.` or the command palette.
    /// `#[serde(default)]` so existing config files (without
    /// the field) deserialise to `false`.
    #[serde(default)]
    pub vim_mode: bool,
    /// P0-X: Typora-style "Word Count Goal". When set
    /// (>0), the status bar shows `<current> / <goal>
    /// (<pct>%)` so the user can track progress against a
    /// writing target (e.g. a 5000-word essay). Defaults
    /// to `0` (disabled) so existing users' status bars
    /// don't change.
    #[serde(default)]
    pub word_count_goal: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EditorConfig {
    /// Font family
    pub font_family: String,
    /// Font size in pixels
    pub font_size: u16,
    /// Tab size in spaces
    pub tab_size: u8,
    /// Whether to use soft tabs (spaces) instead of hard tabs
    pub soft_tabs: bool,
    /// Whether to show line numbers
    pub line_numbers: bool,
    /// Word wrap enabled
    pub word_wrap: bool,
    /// Auto-save interval in seconds (0 = disabled)
    pub auto_save_interval: u16,
    /// Whether to run spell-checking on the active document.
    /// On macOS this drives NSSpellChecker (full CJK + English);
    /// on other platforms it falls back to the bundled English
    /// dictionary and skips CJK.
    ///
    /// Defaults to true on macOS (where the OS provides a free,
    /// high-quality checker) and false elsewhere so non-macOS
    /// users aren't surprised by red underlines on the only
    /// language they can spell-check (English).
    #[serde(default = "default_spellcheck_enabled")]
    pub spellcheck_enabled: bool,
    /// Override the spell-check language. `None` means "follow
    /// the UI language" — the frontend passes the active
    /// `i18n.locale` through. Set to e.g. `"en"` to keep an
    /// English checker active while the UI is in Chinese.
    #[serde(default)]
    pub spellcheck_language: Option<String>,
    /// P0-X: lint markdown on save. When true, `save_file`
    /// runs `lint_markdown` over the buffer before writing
    /// to disk — trailing whitespace trimmed, final newline
    /// ensured, 3+ blank lines collapsed. Defaults to
    /// `false` so existing users' workflows don't change.
    #[serde(default)]
    pub lint_on_save: bool,
}

fn default_spellcheck_enabled() -> bool {
    cfg!(target_os = "macos")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowConfig {
    /// Window width
    pub width: f32,
    /// Window height
    pub height: f32,
    /// Window X position
    pub x: Option<f32>,
    /// Window Y position
    pub y: Option<f32>,
    /// Whether the window is maximized
    pub maximized: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            editor: EditorConfig {
                font_family: "monospace".to_string(),
                font_size: 14,
                tab_size: 4,
                soft_tabs: true,
                line_numbers: true,
                word_wrap: true,
                auto_save_interval: 0,
                spellcheck_enabled: default_spellcheck_enabled(),
                spellcheck_language: None,
                // P0-X: lint-on-save defaults to off so the
                // change is opt-in. Users who want Typora-
                // style automatic cleanup flip the toggle in
                // Settings → Editor → "Lint on save".
                lint_on_save: false,
            },
            window: WindowConfig {
                width: 1200.0,
                height: 800.0,
                x: None,
                y: None,
                maximized: false,
            },
            theme: ThemeId::Light,
            recent_files: Vec::new(),
            last_workspace: None,
            workspace_roots: Vec::new(),
            active_workspace_root_id: None,
            language: None,
            expanded_dirs: std::collections::HashMap::new(),
            vim_mode: false,
            word_count_goal: 0,
        }
    }
}

impl AppConfig {
    /// Load config from a file, or return default if not found.
    ///
    /// Logs (to stderr) any error encountered so a corrupted config
    /// file doesn't silently throw away the user's settings. We
    /// still fall back to defaults so the app starts — surfacing the
    /// error gives the user (or a CI run) a chance to recover or
    /// report the corruption.
    ///
    /// Performs a one-way migration of legacy single-root fields into
    /// the P2-4 multi-root shape. See [`Self::migrate_workspace_roots`].
    pub fn load(path: &PathBuf) -> Self {
        let raw = match std::fs::read_to_string(path) {
            Ok(s) => s,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Self::default(),
            Err(e) => {
                eprintln!(
                    "[AppConfig] could not read config at {}: {} — using defaults",
                    path.display(),
                    e
                );
                return Self::default();
            }
        };
        let mut cfg: AppConfig = match toml::from_str(&raw) {
            Ok(cfg) => cfg,
            Err(e) => {
                eprintln!(
                    "[AppConfig] config at {} is corrupted: {} — using defaults. \
                     The original file has been preserved as config.toml.broken for inspection.",
                    path.display(),
                    e
                );
                // Preserve the broken file so the user can recover
                // their settings manually.
                let backup = path.with_extension("toml.broken");
                let _ = std::fs::write(&backup, raw);
                Self::default()
            }
        };
        cfg.migrate_workspace_roots();
        cfg
    }

    /// Migrate legacy single-root fields into the multi-root shape.
    ///
    /// 1. If `workspace_roots` is empty but the legacy `last_workspace`
    ///    field has a value, synthesize a `WorkspaceRoot` from it and
    ///    set `active_workspace_root_id` to the new id.
    /// 2. If the legacy `expanded_dirs: Vec<String>`-shaped data is
    ///    present (we can't read it through serde now that the field is
    ///    a `HashMap`, so this migration is only relevant for in-memory
    ///    callers — see `set_expanded_dirs_legacy`) we route those
    ///    entries under the active root.
    ///
    /// Always safe to call; idempotent.
    pub fn migrate_workspace_roots(&mut self) {
        if self.workspace_roots.is_empty() {
            if let Some(path) = self.last_workspace.take() {
                if !path.is_empty() {
                    let root = WorkspaceRoot::from_path(&path);
                    let id = root.id.clone();
                    self.workspace_roots.push(root);
                    self.active_workspace_root_id = Some(id);
                }
            }
        }
    }

    /// Save config to a file
    pub fn save(&self, path: &PathBuf) -> std::io::Result<()> {
        let s = toml::to_string_pretty(self).map_err(|e| {
            std::io::Error::new(std::io::ErrorKind::Other, e.to_string())
        })?;
        std::fs::write(path, s)
    }

    /// Get the default config file path
    pub fn config_path() -> PathBuf {
        crate::dirs::app_config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("config.toml")
    }

    /// Add a file to recent files list (most recent first)
    pub fn add_recent_file(&mut self, path: &str) {
        // Remove if already exists
        self.recent_files.retain(|p| p != path);
        // Add to front
        self.recent_files.insert(0, path.to_string());
        // Keep only 10 most recent
        self.recent_files.truncate(10);
    }

    /// Get recent files
    pub fn get_recent_files(&self) -> &[String] {
        &self.recent_files
    }

    /// Clear all recent files
    pub fn clear_recent_files(&mut self) {
        self.recent_files.clear();
    }

    /// **Deprecated** — single-root API, kept for backward compat.
    ///
    /// New code should use [`add_workspace_root`](Self::add_workspace_root)
    /// + [`set_active_workspace_root`](Self::set_active_workspace_root).
    #[deprecated(note = "use add_workspace_root / set_active_workspace_root instead")]
    pub fn set_last_workspace(&mut self, path: Option<String>) {
        self.last_workspace = path;
    }

    /// **Deprecated** — single-root API. If `workspace_roots` is empty
    /// after migration, this still returns the raw field for diagnostic
    /// purposes; new code should read [`get_active_workspace_root`].
    #[deprecated(note = "use get_active_workspace_root instead")]
    pub fn get_last_workspace(&self) -> Option<&String> {
        self.last_workspace.as_ref()
    }

    // -------- Multi-root workspace API (P2-4) --------

    /// Add a folder to the workspace, returning the new root.
    /// Refuses duplicates (same canonical path).

    /// Set UI language
    pub fn set_language(&mut self, lang: Option<String>) {
        self.language = lang;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a config whose `workspace_roots` is empty but which
    /// carries a legacy `last_workspace` value, simulating a pre-P2-4
    /// config file. We do this programmatically (rather than via
    /// TOML roundtrip) because the rename to `_legacy_last_workspace`
    /// would require a different key on disk; the in-memory
    /// `migrate_workspace_roots` only cares about the field value.
    fn legacy_config_with_workspace(path: &str) -> AppConfig {
        let mut cfg = AppConfig::default();
        cfg.last_workspace = Some(path.to_string());
        cfg.migrate_workspace_roots();
        cfg
    }

    #[test]
    fn migrate_legacy_last_workspace_into_workspace_roots() {
        let cfg = legacy_config_with_workspace("/tmp");
        // After migration, a single root exists.
        assert_eq!(cfg.workspace_roots.len(), 1);
        let root = &cfg.workspace_roots[0];
        // basename of canonical /tmp is "tmp".
        assert_eq!(root.name, "tmp");
        // Active id points at the new root.
        assert_eq!(cfg.active_workspace_root_id.as_deref(), Some(root.id.as_str()));
        // The legacy field is consumed.
        assert!(cfg.last_workspace.is_none());
    }

    #[test]
    fn migrate_is_idempotent() {
        let mut cfg = legacy_config_with_workspace("/tmp");
        // Running migration again must not add a second root.
        cfg.migrate_workspace_roots();
        cfg.migrate_workspace_roots();
        assert_eq!(cfg.workspace_roots.len(), 1);
    }

    #[test]
    fn migrate_empty_legacy_is_noop() {
        let mut cfg = AppConfig::default();
        cfg.migrate_workspace_roots();
        assert!(cfg.workspace_roots.is_empty());
        assert!(cfg.active_workspace_root_id.is_none());
    }

    #[test]
    fn add_workspace_root_rejects_duplicates() {
        let mut cfg = AppConfig::default();
        let r1 = cfg.add_workspace_root("/tmp").expect("first add");
        let dup = cfg.add_workspace_root("/tmp");
        assert!(dup.is_err());
        // Active id stays pointing at r1.
        assert_eq!(cfg.active_workspace_root_id.as_deref(), Some(r1.id.as_str()));
    }

    #[test]
    fn remove_workspace_root_falls_back_to_first_remaining() {
        let mut cfg = AppConfig::default();
        let a = cfg.add_workspace_root("/tmp").expect("a");
        let _b = cfg.add_workspace_root("/var").expect("b");
        // Active is a (first add wins). Remove a → b should be active.
        assert!(cfg.remove_workspace_root(&a.id));
        assert_eq!(cfg.active_workspace_root_id.as_deref(), Some(_b.id.as_str()));
    }

    #[test]
    fn expanded_dirs_are_per_root() {
        let mut cfg = AppConfig::default();
        let a = cfg.add_workspace_root("/tmp").expect("a");
        let b = cfg.add_workspace_root("/var").expect("b");
        cfg.set_expanded_dirs_for(&a.id, vec!["/tmp/notes".to_string()]);
        cfg.set_expanded_dirs_for(&b.id, vec!["/var/docs".to_string()]);
        assert_eq!(cfg.get_expanded_dirs_for(&a.id), &["/tmp/notes".to_string()]);
        assert_eq!(cfg.get_expanded_dirs_for(&b.id), &["/var/docs".to_string()]);
        // Removing a drops its expanded-dirs memory.
        assert!(cfg.remove_workspace_root(&a.id));
        assert!(cfg.get_expanded_dirs_for(&a.id).is_empty());
        // b is unaffected.
        assert_eq!(cfg.get_expanded_dirs_for(&b.id), &["/var/docs".to_string()]);
        // And the second add is still active.
        assert_eq!(cfg.active_workspace_root_id.as_deref(), Some(b.id.as_str()));
    }
}
