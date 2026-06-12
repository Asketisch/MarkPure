use crate::state::{lock_or_recover, AppState};
use std::collections::HashMap;
use mt_core::AppConfig;
// ============================== Config ==============================

pub fn cmd_get_config(state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let config = lock_or_recover(&state.config);
    let theme_class = match config.theme {
        mt_core::ThemeId::Light => "",
        mt_core::ThemeId::Dark => "theme-dark",
        mt_core::ThemeId::OneDark => "theme-one-dark",
        mt_core::ThemeId::Graphite => "theme-graphite",
        mt_core::ThemeId::Ulysses => "theme-ulysses",
        mt_core::ThemeId::MaterialDark => "theme-material-dark",
        mt_core::ThemeId::BlueTopaz => "theme-blue-topaz",
    };
    let result = serde_json::json!({
        "theme": theme_class,
        "language": config.language,
        "last_workspace": config.last_workspace,
        "editor": {
            "font_family": config.editor.font_family,
            "font_size": config.editor.font_size,
            "tab_size": config.editor.tab_size,
            "soft_tabs": config.editor.soft_tabs,
            "line_numbers": config.editor.line_numbers,
            "word_wrap": config.editor.word_wrap,
        }
    });
    Ok(result)
}

pub fn cmd_get_recent_files(state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let config = lock_or_recover(&state.config);
    let arr: Vec<&String> = config.get_recent_files().iter().collect();
    Ok(serde_json::Value::Array(
        arr.into_iter()
            .map(|s| serde_json::Value::String(s.clone()))
            .collect(),
    ))
}

pub fn cmd_clear_recent_files(state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let mut config = lock_or_recover(&state.config);
    config.clear_recent_files();
    let _ = config.save(&mt_core::AppConfig::config_path());
    Ok(serde_json::Value::Null)
}

pub fn cmd_set_config(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let mut config = lock_or_recover(&state.config);

    // Theme (accept both CSS class names and human-readable labels)
    if let Some(theme_str) = params.get("theme").and_then(|v| v.as_str()) {
        match theme_str {
            "Cadmium Light" | "Light" | "" => config.theme = mt_core::ThemeId::Light,
            "Dark" | "theme-dark" => config.theme = mt_core::ThemeId::Dark,
            "One Dark" | "theme-one-dark" => config.theme = mt_core::ThemeId::OneDark,
            "Graphite" | "theme-graphite" => config.theme = mt_core::ThemeId::Graphite,
            "Ulysses" | "theme-ulysses" => config.theme = mt_core::ThemeId::Ulysses,
            "Material Dark" | "theme-material-dark" => {
                config.theme = mt_core::ThemeId::MaterialDark
            }
            "Blue Topaz" | "theme-blue-topaz" => config.theme = mt_core::ThemeId::BlueTopaz,
            _ => {}
        }
    }

    if let Some(language) = params.get("language").and_then(|v| v.as_str()) {
        config.set_language(Some(language.to_string()));
    }

    if let Some(workspace) = params.get("last_workspace") {
        config.set_last_workspace(workspace.as_str().map(|s| s.to_string()));
    }

    if let Some(editor) = params.get("editor") {
        if let Some(v) = editor.get("font_family").and_then(|v| v.as_str()) {
            config.editor.font_family = v.to_string();
        }
        if let Some(v) = editor.get("font_size").and_then(|v| v.as_u64()) {
            config.editor.font_size = v as u16;
        }
        if let Some(v) = editor.get("tab_size").and_then(|v| v.as_u64()) {
            config.editor.tab_size = v as u8;
        }
        if let Some(v) = editor.get("soft_tabs").and_then(|v| v.as_bool()) {
            config.editor.soft_tabs = v;
        }
        if let Some(v) = editor.get("line_numbers").and_then(|v| v.as_bool()) {
            config.editor.line_numbers = v;
        }
        if let Some(v) = editor.get("word_wrap").and_then(|v| v.as_bool()) {
            config.editor.word_wrap = v;
        }
    }

    drop(config);
    state.save_config();
    Ok(serde_json::Value::Null)
}

pub fn cmd_get_expanded_dirs(state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let config = lock_or_recover(&state.config);
    Ok(serde_json::json!({ "expanded_dirs": config.get_expanded_dirs() }))
}

pub fn cmd_set_expanded_dirs(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let mut config = lock_or_recover(&state.config);
    if let Some(dirs) = params.get("expanded_dirs").and_then(|v| v.as_array()) {
        let expanded: Vec<String> = dirs
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
        config.set_expanded_dirs(expanded);
    }
    drop(config);
    state.save_config();
    Ok(serde_json::Value::Null)
}
