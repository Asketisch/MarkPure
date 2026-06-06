use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::theme::ThemeId;

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
    /// Last opened workspace directory
    #[serde(default)]
    pub last_workspace: Option<String>,
    /// UI language (e.g., "zh", "en")
    #[serde(default)]
    pub language: Option<String>,
    /// Expanded directory paths in workspace tree
    #[serde(default)]
    pub expanded_dirs: Vec<String>,
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
            language: None,
            expanded_dirs: Vec::new(),
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
        match toml::from_str(&raw) {
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

    /// Set last workspace directory
    pub fn set_last_workspace(&mut self, path: Option<String>) {
        self.last_workspace = path;
    }

    /// Get last workspace directory
    pub fn get_last_workspace(&self) -> Option<&String> {
        self.last_workspace.as_ref()
    }

    /// Get UI language
    pub fn get_language(&self) -> Option<&String> {
        self.language.as_ref()
    }

    /// Set UI language
    pub fn set_language(&mut self, lang: Option<String>) {
        self.language = lang;
    }

    /// Get expanded directory paths
    pub fn get_expanded_dirs(&self) -> &[String] {
        &self.expanded_dirs
    }

    /// Set expanded directory paths
    pub fn set_expanded_dirs(&mut self, dirs: Vec<String>) {
        self.expanded_dirs = dirs;
    }

    /// Add an expanded directory
    pub fn add_expanded_dir(&mut self, path: String) {
        if !self.expanded_dirs.contains(&path) {
            self.expanded_dirs.push(path);
        }
    }

    /// Remove an expanded directory
    pub fn remove_expanded_dir(&mut self, path: &str) {
        self.expanded_dirs.retain(|p| p != path);
    }
}
