use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// 可用的主题标识符
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum ThemeId {
    Light,
    Dark,
    OneDark,
    Graphite,
    Ulysses,
    MaterialDark,
    BlueTopaz,
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
            ThemeId::BlueTopaz => "Blue Topaz",
        }
    }

    pub fn is_dark(&self) -> bool {
        matches!(
            self,
            ThemeId::Dark | ThemeId::OneDark | ThemeId::Graphite | ThemeId::MaterialDark | ThemeId::BlueTopaz
        )
    }

    /// 返回所有可用的主题
    pub fn all() -> &'static [ThemeId] {
        &[
            ThemeId::Light,
            ThemeId::Dark,
            ThemeId::OneDark,
            ThemeId::Graphite,
            ThemeId::Ulysses,
            ThemeId::MaterialDark,
            ThemeId::BlueTopaz,
        ]
    }

    /// 循环切换到下一个主题
    pub fn cycle(&self) -> Self {
        let all = Self::all();
        let idx = all.iter().position(|t| *t == *self).unwrap_or(0);
        all[(idx + 1) % all.len()]
    }

    /// 根据字符串解析出对应的主题标识符。
    ///
    /// 同时接受三种写法：**CSS class 名**（`theme-dark`、空串表示
    /// 浅色——前端 `<div class="app-root {theme}">` 用的就是它）、
    /// **枚举名**（`Dark`）与**人类可读标签**（`Dark`/`Cadmium Light`）。
    ///
    /// 配置文件里的 `theme` 字段必须认得 CSS class 名：文档与
    /// `cmd_set_config` 都以它为准，用户手改 config.toml 时自然
    /// 会照着写。而这个字段一旦解析失败，整份配置都会被丢弃
    /// （工作区根、最近文件、界面语言……全部回退默认值），代价
    /// 远大于「主题认不出来」。
    pub fn from_id(s: &str) -> Option<Self> {
        match s {
            "" | "Light" | "Cadmium Light" => Some(ThemeId::Light),
            "Dark" | "theme-dark" => Some(ThemeId::Dark),
            "One Dark" | "OneDark" | "theme-one-dark" => Some(ThemeId::OneDark),
            "Graphite" | "theme-graphite" => Some(ThemeId::Graphite),
            "Ulysses" | "theme-ulysses" => Some(ThemeId::Ulysses),
            "Material Dark" | "MaterialDark" | "theme-material-dark" => {
                Some(ThemeId::MaterialDark)
            }
            "Blue Topaz" | "BlueTopaz" | "theme-blue-topaz" => Some(ThemeId::BlueTopaz),
            _ => None,
        }
    }
}

/// 反序列化走 [`ThemeId::from_id`]，因此配置文件里写 CSS class 名
/// （`theme-dark`）、枚举名（`Dark`）或标签都能识别。
///
/// 序列化仍输出枚举名——那是 `config.toml` 里既有的写法，改动它
/// 只会让用户的配置文件无缘无故地变一次。
impl<'de> Deserialize<'de> for ThemeId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let raw = String::deserialize(deserializer)?;
        ThemeId::from_id(&raw).ok_or_else(|| {
            serde::de::Error::custom(format!(
                "unknown theme '{raw}' (expected one of: {}{})",
                "'', 'Light', 'Dark', 'OneDark', 'Graphite', 'Ulysses', 'MaterialDark', 'BlueTopaz'",
                " or the matching CSS class name (e.g. 'theme-dark')"
            ))
        })
    }
}

impl std::fmt::Display for ThemeId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.label())
    }
}

/// 自定义主题的定义
///
/// `#[serde(default)]` 让**缺失**的字段回落到 [`Theme::default`]：
/// 用户手写的主题 JSON（或旧版本导出的文件）通常只写少数几个颜色，
/// 没有它的话导入会直接失败——「导入自定义主题」对用户来说就是
/// 完全不能用。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Theme {
    pub id: String,
    pub name: String,
    pub author: String,
    pub description: String,
    pub is_dark: bool,
    pub colors: ThemeColors,
}

/// 主题配色
///
/// `#[serde(default)]` 让缺失的颜色回落到 [`ThemeColors::default`]，
/// 这样只写少数几个颜色的主题文件也能导入成功。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ThemeColors {
    // === UI 颜色 ===
    pub bg: String,
    pub bg_secondary: String,
    pub bg_tab_active: String,
    pub bg_tab_inactive: String,
    pub text: String,
    pub text_secondary: String,
    pub accent: String,
    pub accent_hover: String,
    pub border: String,
    pub menu_hover_bg: String,
    pub menu_hover_text: String,
    pub status_bg: String,
    pub scrollbar_thumb: String,
    pub highlight_bg: String,
    pub cell_selected_bg: String,

    // === 标题颜色 ===
    pub heading1_color: String,
    pub heading2_color: String,
    pub heading3_color: String,
    pub heading4_color: String,
    pub heading5_color: String,
    pub heading6_color: String,

    // === 标题字号 ===
    pub heading1_size: String,
    pub heading2_size: String,
    pub heading3_size: String,
    pub heading4_size: String,
    pub heading5_size: String,
    pub heading6_size: String,

    // === 代码 ===
    pub code_bg: String,
    pub code_block_bg: String,

    // === 链接 ===
    pub link_color: String,
    pub link_hover_color: String,

    // === 引用块 ===
    pub blockquote_border: String,
    pub blockquote_bg: String,

    // === 其他 ===
    pub hr_color: String,
    pub table_border: String,
    pub table_header_bg: String,
}

impl Default for ThemeColors {
    fn default() -> Self {
        Self {
            // UI 颜色
            bg: "#ffffff".to_string(),
            bg_secondary: "#f6f8fa".to_string(),
            bg_tab_active: "#ffffff".to_string(),
            bg_tab_inactive: "#e8e8e8".to_string(),
            text: "#24292e".to_string(),
            text_secondary: "#586069".to_string(),
            accent: "#0969da".to_string(),
            accent_hover: "#0550ae".to_string(),
            border: "#d0d7de".to_string(),
            menu_hover_bg: "#0969da".to_string(),
            menu_hover_text: "#ffffff".to_string(),
            status_bg: "#f6f8fa".to_string(),
            scrollbar_thumb: "#c1c1c1".to_string(),
            highlight_bg: "#fff3b0".to_string(),
            cell_selected_bg: "rgba(9, 105, 218, 0.1)".to_string(),

            // 标题颜色 (使用主题默认值)
            heading1_color: "#24292e".to_string(),
            heading2_color: "#24292e".to_string(),
            heading3_color: "#24292e".to_string(),
            heading4_color: "#24292e".to_string(),
            heading5_color: "#24292e".to_string(),
            heading6_color: "#586069".to_string(),

            // 标题字号
            heading1_size: "2em".to_string(),
            heading2_size: "1.5em".to_string(),
            heading3_size: "1.25em".to_string(),
            heading4_size: "1.1em".to_string(),
            heading5_size: "1em".to_string(),
            heading6_size: "0.9em".to_string(),

            // 代码
            code_bg: "#f6f8fa".to_string(),
            code_block_bg: "#f6f8fa".to_string(),

            // 链接
            link_color: "#0969da".to_string(),
            link_hover_color: "#0550ae".to_string(),

            // 引用块
            blockquote_border: "#0969da".to_string(),
            blockquote_bg: "#f6f8fa".to_string(),

            // 其他
            hr_color: "#d0d7de".to_string(),
            table_border: "#d0d7de".to_string(),
            table_header_bg: "#f6f8fa".to_string(),
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

/// 获取主题存放目录
pub fn themes_dir() -> PathBuf {
    // 走 `app_config_dir()`：它尊重 `MARKPURE_CONFIG_DIR`，测试 harness
    // 因此可以把自定义主题隔离到临时目录。
    let config_dir = crate::dirs::app_config_dir().unwrap_or_else(|| PathBuf::from("."));
    let themes = config_dir.join("themes");
    fs::create_dir_all(&themes).ok();
    themes
}

/// 加载全部自定义主题
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

/// 校验主题标识符是否可以安全用作文件名
fn validate_theme_id(id: &str) -> std::result::Result<(), String> {
    if id.is_empty() {
        return Err("theme ID is empty".into());
    }
    if id.contains("..") || id.contains('/') || id.contains('\\') || id.contains('\0') {
        return Err(format!("invalid theme ID: '{}'", id));
    }
    // 检查是否为 Windows 保留文件名
    let upper = id.to_uppercase();
    if upper == "CON" || upper == "PRN" || upper == "AUX" || upper == "NUL"
        || upper.starts_with("COM") || upper.starts_with("LPT")
    {
        return Err(format!("theme ID '{}' is a reserved Windows filename", id));
    }
    Ok(())
}

/// 保存自定义主题
pub fn save_custom_theme(theme: &Theme) -> Result<(), String> {
    validate_theme_id(&theme.id)?;
    let dir = themes_dir();
    let file_path = dir.join(format!("{}.json", theme.id));
    let content = serde_json::to_string_pretty(theme).map_err(|e| e.to_string())?;
    crate::atomic::atomic_write(&file_path, &content).map_err(|e| e.to_string())?;
    Ok(())
}

/// 删除自定义主题
pub fn delete_custom_theme(id: &str) -> Result<bool, String> {
    validate_theme_id(id)?;
    let dir = themes_dir();
    let file_path = dir.join(format!("{}.json", id));
    // 确保解析后的路径仍然位于主题目录之内
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

/// 从文件路径导入主题
pub fn import_theme_from_path(file_path: &str) -> Result<Theme, String> {
    let content = fs::read_to_string(file_path).map_err(|e| e.to_string())?;
    let mut theme: Theme = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    // 确保主题标识符唯一
    theme.id = format!("custom_{}", generate_id());

    save_custom_theme(&theme)?;
    Ok(theme)
}

/// 将主题导出到指定文件路径
pub fn export_theme_to_path(id: &str, dest_path: &str) -> Result<bool, String> {
    let themes = load_custom_themes();
    let theme = themes.iter().find(|t| t.id == id).ok_or("Theme not found")?;

    let content = serde_json::to_string_pretty(theme).map_err(|e| e.to_string())?;
    fs::write(dest_path, content).map_err(|e| e.to_string())?;
    Ok(true)
}

/// 生成唯一的标识符
fn generate_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let rand_suffix = (now as u64).wrapping_mul(2654435761).rotate_left(17);
    format!("{:x}{:08x}", now, rand_suffix & 0xFFFFFFFF)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_id_accepts_css_class_names() {
        // 文档与 `cmd_set_config` 都以 CSS class 名为准，配置文件
        // 必须同样认得——否则用户照文档手改配置就会让**整份配置**
        // 解析失败（工作区、最近文件、语言全部回退默认值）。
        assert_eq!(ThemeId::from_id(""), Some(ThemeId::Light));
        assert_eq!(ThemeId::from_id("theme-dark"), Some(ThemeId::Dark));
        assert_eq!(ThemeId::from_id("theme-one-dark"), Some(ThemeId::OneDark));
        assert_eq!(ThemeId::from_id("theme-graphite"), Some(ThemeId::Graphite));
        assert_eq!(ThemeId::from_id("theme-ulysses"), Some(ThemeId::Ulysses));
        assert_eq!(
            ThemeId::from_id("theme-material-dark"),
            Some(ThemeId::MaterialDark)
        );
        assert_eq!(
            ThemeId::from_id("theme-blue-topaz"),
            Some(ThemeId::BlueTopaz)
        );
    }

    #[test]
    fn from_id_accepts_enum_names_and_labels() {
        assert_eq!(ThemeId::from_id("Light"), Some(ThemeId::Light));
        assert_eq!(ThemeId::from_id("Cadmium Light"), Some(ThemeId::Light));
        assert_eq!(ThemeId::from_id("Dark"), Some(ThemeId::Dark));
        assert_eq!(ThemeId::from_id("One Dark"), Some(ThemeId::OneDark));
        assert_eq!(ThemeId::from_id("OneDark"), Some(ThemeId::OneDark));
        assert_eq!(ThemeId::from_id("Graphite"), Some(ThemeId::Graphite));
        assert_eq!(ThemeId::from_id("Ulysses"), Some(ThemeId::Ulysses));
        assert_eq!(
            ThemeId::from_id("Material Dark"),
            Some(ThemeId::MaterialDark)
        );
        assert_eq!(ThemeId::from_id("Blue Topaz"), Some(ThemeId::BlueTopaz));
        assert_eq!(ThemeId::from_id("nonsense"), None);
    }

    #[test]
    fn deserializes_css_class_names() {
        // 直接从 TOML 的形态反序列化。
        #[derive(serde::Deserialize)]
        struct ThemeOnly {
            theme: ThemeId,
        }
        let cfg: ThemeOnly = toml::from_str("theme = \"theme-dark\"\n").expect("应能解析");
        assert_eq!(cfg.theme, ThemeId::Dark);

        let cfg: ThemeOnly = toml::from_str("theme = \"Dark\"\n").expect("应能解析");
        assert_eq!(cfg.theme, ThemeId::Dark);

        let cfg: ThemeOnly = toml::from_str("theme = \"\"\n").expect("应能解析");
        assert_eq!(cfg.theme, ThemeId::Light);
    }

    #[test]
    fn rejects_unknown_theme() {
        #[derive(serde::Deserialize)]
        struct ThemeOnly {
            theme: ThemeId,
        }
        let err = toml::from_str::<ThemeOnly>("theme = \"no-such-theme\"\n");
        assert!(err.is_err(), "未知主题应当解析失败");
    }
}
