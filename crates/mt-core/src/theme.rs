use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// Available theme IDs
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ThemeId {
    Light,
    Dark,
    OneDark,
    Graphite,
    Ulysses,
    MaterialDark,
}

impl ThemeId {
    pub fn label(&self) -> &str {
        match self {
            ThemeId::Light => "Cadmium Light",
            ThemeId::Dark => "Dark",
            ThemeId::OneDark => "One Dark",
            ThemeId::Graphite => "Graphite",
            ThemeId::Ulysses => "Ulysses",
            ThemeId::MaterialDark => "Material Dark",
        }
    }

    pub fn is_dark(&self) -> bool {
        matches!(
            self,
            ThemeId::Dark | ThemeId::OneDark | ThemeId::Graphite | ThemeId::MaterialDark
        )
    }

    /// All available themes
    pub fn all() -> &'static [ThemeId] {
        &[
            ThemeId::Light,
            ThemeId::Dark,
            ThemeId::OneDark,
            ThemeId::Graphite,
            ThemeId::Ulysses,
            ThemeId::MaterialDark,
        ]
    }

    /// Cycle to the next theme
    pub fn cycle(&self) -> Self {
        let all = Self::all();
        let idx = all.iter().position(|t| *t == *self).unwrap_or(0);
        all[(idx + 1) % all.len()]
    }

    /// Get theme ID from string
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "Light" | "Cadmium Light" => Some(ThemeId::Light),
            "Dark" => Some(ThemeId::Dark),
            "One Dark" => Some(ThemeId::OneDark),
            "Graphite" => Some(ThemeId::Graphite),
            "Ulysses" => Some(ThemeId::Ulysses),
            "Material Dark" => Some(ThemeId::MaterialDark),
            _ => None,
        }
    }
}

impl std::fmt::Display for ThemeId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.label())
    }
}

/// Custom theme definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Theme {
    pub id: String,
    pub name: String,
    pub author: String,
    pub description: String,
    pub is_dark: bool,
    pub colors: ThemeColors,
}

/// Theme colors
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeColors {
    pub bg: String,
    pub bg_secondary: String,
    pub bg_tab_active: String,
    pub bg_tab_inactive: String,
    pub text: String,
    pub text_secondary: String,
    pub accent: String,
    pub border: String,
    pub menu_hover_bg: String,
    pub menu_hover_text: String,
    pub status_bg: String,
}

impl Default for ThemeColors {
    fn default() -> Self {
        Self {
            bg: "#ffffff".to_string(),
            bg_secondary: "#f5f5f5".to_string(),
            bg_tab_active: "#ffffff".to_string(),
            bg_tab_inactive: "#e0e0e0".to_string(),
            text: "#333333".to_string(),
            text_secondary: "#888888".to_string(),
            accent: "#4a90d9".to_string(),
            border: "#e0e0e0".to_string(),
            menu_hover_bg: "#e8e8e8".to_string(),
            menu_hover_text: "#333333".to_string(),
            status_bg: "#f0f0f0".to_string(),
        }
    }
}

impl Default for Theme {
    fn default() -> Self {
        Self {
            id: "custom".to_string(),
            name: "Custom".to_string(),
            author: "User".to_string(),
            description: "Custom theme".to_string(),
            is_dark: false,
            colors: ThemeColors::default(),
        }
    }
}

/// Get themes directory
pub fn themes_dir() -> PathBuf {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("markpure")
        .join("themes");
    fs::create_dir_all(&config_dir).ok();
    config_dir
}

/// Load all custom themes
pub fn load_custom_themes() -> Vec<Theme> {
    let dir = themes_dir();
    let mut themes = Vec::new();

    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "json").unwrap_or(false) {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(theme) = serde_json::from_str::<Theme>(&content) {
                        themes.push(theme);
                    }
                }
            }
        }
    }

    themes
}

/// Validate that a theme ID is safe to use as a filename
fn validate_theme_id(id: &str) -> std::result::Result<(), String> {
    if id.is_empty() {
        return Err("theme ID is empty".into());
    }
    if id.contains("..") || id.contains('/') || id.contains('\\') || id.contains('\0') {
        return Err(format!("invalid theme ID: '{}'", id));
    }
    Ok(())
}

/// Save a custom theme
pub fn save_custom_theme(theme: &Theme) -> Result<(), String> {
    validate_theme_id(&theme.id)?;
    let dir = themes_dir();
    let file_path = dir.join(format!("{}.json", theme.id));
    let content = serde_json::to_string_pretty(theme).map_err(|e| e.to_string())?;
    fs::write(&file_path, content).map_err(|e| e.to_string())?;
    Ok(())
}

/// Delete a custom theme
pub fn delete_custom_theme(id: &str) -> Result<bool, String> {
    validate_theme_id(id)?;
    let dir = themes_dir();
    let file_path = dir.join(format!("{}.json", id));
    // Ensure the resolved path is still within the themes directory
    let canonical_dir = dir.canonicalize().map_err(|e| e.to_string())?;
    let canonical_file = file_path.canonicalize().unwrap_or_else(|_| file_path.clone());
    if !canonical_file.starts_with(&canonical_dir) {
        return Err("invalid theme ID: path escapes themes directory".into());
    }
    if file_path.exists() {
        fs::remove_file(&file_path).map_err(|e| e.to_string())?;
        Ok(true)
    } else {
        Ok(false)
    }
}

/// Import theme from file path
pub fn import_theme_from_path(file_path: &str) -> Result<Theme, String> {
    let content = fs::read_to_string(file_path).map_err(|e| e.to_string())?;
    let mut theme: Theme = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    // Ensure unique ID
    theme.id = format!("custom_{}", generate_id());

    save_custom_theme(&theme)?;
    Ok(theme)
}

/// Export theme to file path
pub fn export_theme_to_path(id: &str, dest_path: &str) -> Result<bool, String> {
    let themes = load_custom_themes();
    let theme = themes.iter().find(|t| &t.id == id).ok_or("Theme not found")?;

    let content = serde_json::to_string_pretty(theme).map_err(|e| e.to_string())?;
    fs::write(dest_path, content).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Generate a unique ID
fn generate_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let rand_suffix = (now as u64).wrapping_mul(2654435761).rotate_left(17);
    format!("{:x}{:08x}", now, rand_suffix & 0xFFFFFFFF)
}
