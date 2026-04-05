use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Tab state for persistence across sessions
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TabState {
    /// Unique tab identifier
    pub id: String,
    /// Display name (file name or "Untitled")
    pub name: String,
    /// File path if saved, None if new/untitled
    pub path: Option<String>,
    /// Current content
    pub content: String,
    /// Whether the file has unsaved changes
    pub is_modified: bool,
    /// Scroll position as ratio (0.0 - 1.0)
    pub scroll_ratio: f64,
    /// Whether the file is read-only
    pub read_only: bool,
}

impl TabState {
    pub fn new(id: String, name: String) -> Self {
        Self {
            id,
            name,
            path: None,
            content: String::new(),
            is_modified: false,
            scroll_ratio: 0.0,
            read_only: false,
        }
    }

    pub fn with_path(id: String, path: String) -> Self {
        let name = std::path::Path::new(&path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "Untitled".to_string());
        Self {
            id,
            name,
            path: Some(path),
            content: String::new(),
            is_modified: false,
            scroll_ratio: 0.0,
            read_only: false,
        }
    }
}

/// Tab state for a specific window
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowTabs {
    /// Window identifier (e.g., "main", or UUID for child windows)
    pub window_id: String,
    /// Currently active tab ID
    pub active_tab_id: Option<String>,
    /// All tabs in this window
    pub tabs: Vec<TabState>,
}

/// Load window tabs from config directory
pub fn load_tabs(config_dir: &PathBuf) -> std::io::Result<Vec<WindowTabs>> {
    let tabs_path = config_dir.join("tabs.json");
    if !tabs_path.exists() {
        return Ok(Vec::new());
    }
    let content = std::fs::read_to_string(&tabs_path)?;
    serde_json::from_str(&content).map_err(|e| {
        std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string())
    })
}

/// Save window tabs to config directory
pub fn save_tabs(config_dir: &PathBuf, windows: &[WindowTabs]) -> std::io::Result<()> {
    let tabs_path = config_dir.join("tabs.json");
    if let Some(parent) = tabs_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let content = serde_json::to_string_pretty(windows).map_err(|e| {
        std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string())
    })?;
    std::fs::write(&tabs_path, content)
}

/// Get the default tabs file path
pub fn tabs_path() -> PathBuf {
    config_dir().join("tabs.json")
}

/// Get the default config directory
fn config_dir() -> PathBuf {
    if cfg!(target_os = "macos") {
        dirs::home()
            .map(|h| h.join("Library").join("Application Support").join("marktext-rs"))
            .unwrap_or_else(|| PathBuf::from("."))
    } else if cfg!(target_os = "windows") {
        std::env::var("APPDATA")
            .ok()
            .map(|p| PathBuf::from(p).join("marktext-rs"))
            .unwrap_or_else(|| PathBuf::from("."))
    } else {
        std::env::var("XDG_CONFIG_HOME")
            .ok()
            .map(|p| PathBuf::from(p).join("marktext-rs"))
            .or_else(|| std::env::var("HOME").ok().map(|h| PathBuf::from(h).join(".config").join("marktext-rs")))
            .unwrap_or_else(|| PathBuf::from("."))
    }
}

mod dirs {
    use std::path::PathBuf;

    pub fn home() -> Option<PathBuf> {
        std::env::var("HOME").ok().map(PathBuf::from)
    }
}
