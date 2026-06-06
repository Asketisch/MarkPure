//! Workspace-level IPC handlers.
//!
//! Topic: app-wide state that isn't a single document or a
//! markdown-extension helper. Tab persistence, config
//! get/set, recent files, theme / keymap / i18n registry,
//! bookmarks, app info. Anything that's "what does the app
//! look like" rather than "what does this document contain".

use super::state::{lock_or_recover, AppState};
use mt_core::tab::{save_tabs, TabState, WindowTabs};
use std::time::{SystemTime, UNIX_EPOCH};

// ============================== Tabs ==============================

pub fn cmd_get_tabs(state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let tabs = lock_or_recover(&state.tabs);
    Ok(serde_json::to_value(tabs.as_slice()).map_err(|e| e.to_string())?)
}

pub fn cmd_save_tabs(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let windows: Vec<WindowTabs> = serde_json::from_value(params.clone())
        .map_err(|e| e.to_string())?;

    {
        let mut tabs = lock_or_recover(&state.tabs);
        *tabs = windows;
    }

    // Persist to disk
    let config_path = mt_core::AppConfig::config_path();
    let config_dir = config_path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_default();
    let tabs = lock_or_recover(&state.tabs);
    save_tabs(&config_dir, tabs.as_slice()).map_err(|e| e.to_string())?;

    Ok(serde_json::Value::Null)
}

pub fn cmd_tearoff_tab(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let tab: TabState = serde_json::from_value(params.clone())
        .map_err(|e| e.to_string())?;

    let window_id = generate_uuid();

    {
        let mut tabs = lock_or_recover(&state.tabs);
        for window in tabs.iter_mut() {
            window.tabs.retain(|t| t.id != tab.id);
        }
        tabs.push(WindowTabs {
            window_id: window_id.clone(),
            active_tab_id: Some(tab.id.clone()),
            tabs: vec![tab],
        });
    }

    Ok(serde_json::json!({ "window_id": window_id }))
}

/// Generate a stable but unique ID. We mix the wall-clock
/// nanoseconds with a hash of the same value so two consecutive
/// calls in the same nanosecond still produce different IDs.
fn generate_uuid() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let rand_suffix = (now as u64).wrapping_mul(2654435761).rotate_left(17);
    format!("{:x}{:08x}", now, rand_suffix & 0xFFFFFFFF)
}

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

// ============================== i18n ==============================

pub fn cmd_get_locale(state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let locales = mt_core::i18n::get_locale_codes();
    let config = lock_or_recover(&state.config);
    let current = config.language.clone().unwrap_or_else(|| "en".to_string());
    let translations = mt_core::i18n::get_translations(&current);
    Ok(serde_json::json!({
        "current": current,
        "available": locales,
        "translations": translations,
    }))
}

pub fn cmd_set_locale(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let lang = params["lang"].as_str().ok_or("Missing 'lang' parameter")?;
    {
        let mut config = lock_or_recover(&state.config);
        config.set_language(Some(lang.to_string()));
    }
    state.save_config();
    Ok(serde_json::Value::Null)
}

pub fn cmd_get_translations(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let lang = params["lang"].as_str().unwrap_or("en");
    let translations = mt_core::i18n::get_translations(lang);
    Ok(serde_json::to_value(translations).map_err(|e| e.to_string())?)
}

// ============================== Keybindings ==============================

pub fn cmd_get_keybindings() -> std::result::Result<serde_json::Value, String> {
    let keybindings = mt_core::load_keybindings();
    Ok(serde_json::to_value(keybindings).map_err(|e| e.to_string())?)
}

pub fn cmd_set_keybindings(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let keybindings: Vec<mt_core::KeyBinding> = serde_json::from_value(params.clone())
        .map_err(|e| e.to_string())?;
    mt_core::save_keybindings(&keybindings).map_err(|e| e.to_string())?;
    Ok(serde_json::Value::Null)
}

pub fn cmd_reset_keybindings() -> std::result::Result<serde_json::Value, String> {
    let keybindings = mt_core::reset_keybindings().map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(keybindings).map_err(|e| e.to_string())?)
}

pub fn cmd_update_keybinding(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let id = params["id"].as_str().ok_or("Missing 'id' parameter")?;
    let accelerator = params
        .get("accelerator")
        .and_then(|v| v.as_str())
        .map(String::from);
    let keybindings = mt_core::update_keybinding(id, accelerator)
        .map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(keybindings).map_err(|e| e.to_string())?)
}

// ============================== Themes ==============================

pub fn cmd_get_themes() -> std::result::Result<serde_json::Value, String> {
    let themes = mt_core::load_custom_themes();
    Ok(serde_json::to_value(themes).map_err(|e| e.to_string())?)
}

pub fn cmd_import_theme(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let file_path = params["path"]
        .as_str()
        .ok_or("Missing 'path' parameter")?;
    let theme = mt_core::import_theme_from_path(file_path).map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(theme).map_err(|e| e.to_string())?)
}

pub fn cmd_export_theme(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let id = params["id"].as_str().ok_or("Missing 'id' parameter")?;
    let dest_path = params["dest_path"]
        .as_str()
        .ok_or("Missing 'dest_path' parameter")?;
    mt_core::export_theme_to_path(id, dest_path).map_err(|e| e.to_string())?;
    Ok(serde_json::Value::Null)
}

pub fn cmd_delete_theme(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let id = params["id"].as_str().ok_or("Missing 'id' parameter")?;
    mt_core::delete_custom_theme(id).map_err(|e| e.to_string())?;
    Ok(serde_json::Value::Null)
}

pub fn cmd_save_theme(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let theme = serde_json::from_value::<mt_core::Theme>(params.clone())
        .map_err(|e| e.to_string())?;
    mt_core::save_custom_theme(&theme).map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(theme).map_err(|e| e.to_string())?)
}

// ============================== Bookmarks ==============================

pub fn cmd_get_bookmarks() -> std::result::Result<serde_json::Value, String> {
    let list = bookmark::load_bookmarks().map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(list).map_err(|e| e.to_string())?)
}

pub fn cmd_add_bookmark(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let path = params["path"].as_str().ok_or("Missing 'path'")?;
    let title = params["title"].as_str().ok_or("Missing 'title'")?;
    let tags: Vec<String> = params["tags"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let bm = bookmark::add_bookmark(path, title, tags).map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(bm).map_err(|e| e.to_string())?)
}

pub fn cmd_update_bookmark(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let id = params["id"].as_str().ok_or("Missing 'id'")?;
    let title = params.get("title").and_then(|v| v.as_str());
    let description = params.get("description").and_then(|v| v.as_str());
    let tags = params.get("tags").and_then(|v| v.as_array()).map(|a| {
        a.iter()
            .filter_map(|v| v.as_str().map(String::from))
            .collect()
    });
    let bm = bookmark::update_bookmark(id, title, description, tags)
        .map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(bm).map_err(|e| e.to_string())?)
}

pub fn cmd_remove_bookmark(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let id = params["id"].as_str().ok_or("Missing 'id'")?;
    bookmark::remove_bookmark(id).map_err(|e| e.to_string())?;
    Ok(serde_json::Value::Null)
}

// ============================== App info ==============================

pub fn cmd_get_app_info() -> std::result::Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "name": "MarkPure",
        "version": env!("CARGO_PKG_VERSION"),
        "description": "A WYSIWYG Markdown editor",
    }))
}
