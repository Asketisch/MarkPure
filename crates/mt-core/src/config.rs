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
        }
    }
}

impl AppConfig {
    /// Load config from a file, or return default if not found
    pub fn load(path: &PathBuf) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|s| toml::from_str(&s).ok())
            .unwrap_or_default()
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
        let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
        base.join("marktext-rs").join("config.toml")
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
}

// dirs crate - add to mt-core dependencies if needed, for now use a simple approach
mod dirs {
    use std::path::PathBuf;

    pub fn config_dir() -> Option<PathBuf> {
        if cfg!(target_os = "macos") {
            dirs_macos()
        } else if cfg!(target_os = "windows") {
            std::env::var("APPDATA").ok().map(PathBuf::from)
        } else {
            // Linux / XDG
            std::env::var("XDG_CONFIG_HOME")
                .ok()
                .map(PathBuf::from)
                .or_else(|| {
                    std::env::var("HOME")
                        .ok()
                        .map(|h| PathBuf::from(h).join(".config"))
                })
        }
    }

    fn dirs_macos() -> Option<PathBuf> {
        std::env::var("HOME")
            .ok()
            .map(|h| PathBuf::from(h).join("Library").join("Application Support"))
    }
}
