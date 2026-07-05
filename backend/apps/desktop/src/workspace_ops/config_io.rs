use crate::state::{lock_or_recover, AppState};
use std::collections::HashMap;
use mt_core::AppConfig;
// ============================== Config ==============================

/// Shared helper: serialise the current `AppConfig` into
/// the JSON shape the Settings UI consumes. Kept in one
/// place so `cmd_get_config` (runtime read) and
/// `cmd_export_config` (full backup) stay in lock-step —
/// the export has to include every field the Settings
/// panel can edit, otherwise a restore misses user
/// customisations.
fn config_to_json(config: &AppConfig) -> serde_json::Value {
    let theme_class = match config.theme {
        mt_core::ThemeId::Light => "",
        mt_core::ThemeId::Dark => "theme-dark",
        mt_core::ThemeId::OneDark => "theme-one-dark",
        mt_core::ThemeId::Graphite => "theme-graphite",
        mt_core::ThemeId::Ulysses => "theme-ulysses",
        mt_core::ThemeId::MaterialDark => "theme-material-dark",
        mt_core::ThemeId::BlueTopaz => "theme-blue-topaz",
    };
    serde_json::json!({
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
            "auto_save_interval": config.editor.auto_save_interval,
            "spellcheck_enabled": config.editor.spellcheck_enabled,
            "spellcheck_language": config.editor.spellcheck_language,
            // P0-X: lint-on-save toggle. Surfaced in
            // Settings and round-tripped through the
            // export/import plumbing.
            "lint_on_save": config.editor.lint_on_save,
            // P0-X: Typora-style word-count goal (top-
            // level AppConfig field, not inside editor
            // — word-count target is a writing-flow
            // preference, not a code-editor knob).
            "word_count_goal": config.word_count_goal,
        },
        // P2-7: global Vim mode toggle. Persisted as a
        // top-level AppConfig field; export must include
        // it for a restore to put the user's Vim setting
        // back.
        "vim_mode": config.vim_mode,
    })
}

pub fn cmd_get_config(state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let config = lock_or_recover(&state.config);
    Ok(config_to_json(&config))
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
        // P0-X: `lint_on_save` toggle for Typora-style
        // automatic markdown cleanup. Persisted via the
        // same `editor.*` namespace so the Settings UI
        // can read/write it through the existing
        // `get_config` / `set_config` plumbing.
        if let Some(v) = editor.get("lint_on_save").and_then(|v| v.as_bool()) {
            config.editor.lint_on_save = v;
        }
    }

    // P0-X: word-count goal is a top-level AppConfig
    // field (not under `editor.*` — it's a writing-flow
    // preference, not a code-editor knob). `0` disables
    // the status-bar chip.
    if let Some(goal) = params.get("word_count_goal").and_then(|v| v.as_u64()) {
        let mut config = lock_or_recover(&state.config);
        config.word_count_goal = goal as u32;
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

// ============================== Config export / import ==============================
//
// P0-X: Typora-style "Export Preferences" / "Import
// Preferences" — a single JSON file that captures every
// user-tunable setting (theme, editor prefs, keybindings,
// custom themes) for backup / migration / sync. The Rust
// side walks the live `AppConfig` + keybindings file +
// custom-themes directory and emits a self-describing
// payload; the host (App.svelte) wires the IPCs to
// Settings buttons and offers a file-picker save dialog.

/// Build the full export payload. Kept in one place so
/// the export and the per-component getters can't drift.
fn build_export_payload(state: &AppState) -> serde_json::Value {
    let config = lock_or_recover(&state.config);
    let cfg_json = config_to_json(&config);
    drop(config);

    // Keybindings — read the on-disk JSON file directly
    // so the export matches what the user would see if
    // they peeked into `~/.config/markpure/keybindings.json`.
    let keybindings_path = mt_core::keymap::keybindings_path();
    let keybindings: serde_json::Value = std::fs::read_to_string(&keybindings_path)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .unwrap_or_else(|| serde_json::json!([]));

    // Custom themes — read the on-disk themes directory
    // and inline every JSON file as a string so the
    // export is a single self-contained blob.
    let themes_dir = mt_core::theme::themes_dir();
    let mut themes: Vec<serde_json::Value> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&themes_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue
            }
            if let Ok(text) = std::fs::read_to_string(&path) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                    themes.push(json);
                }
            }
        }
    }

    serde_json::json!({
        "version": 1,
        "app": "MarkPure",
        "exported_at": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
        "config": cfg_json,
        "keybindings": keybindings,
        "themes": themes,
    })
}

pub fn cmd_export_config(
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    Ok(build_export_payload(state))
}

/// Restore the config from a payload previously produced
/// by `cmd_export_config`. Returns a small report
/// describing how many themes were re-imported so the
/// Settings panel can flash "✓ Restored" / "Partial" /
/// "Failed" feedback.
///
/// We deliberately *don't* roll back on partial failure
/// — the user gets a best-effort restore and a report.
pub fn cmd_import_config(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let payload = params.get("payload").ok_or("Missing 'payload'")?;

    // Validate the version so a future-backup-file
    // doesn't silently overwrite a new schema.
    let version = payload.get("version").and_then(|v| v.as_u64()).unwrap_or(0);
    if version != 1 {
        return Err(format!(
            "Unsupported config export version: {version} (expected 1)"
        ));
    }

    // 1. Restore the AppConfig (theme, language, editor prefs).
    let mut restored_keys: Vec<String> = Vec::new();
    if let Some(cfg) = payload.get("config") {
        // Reuse the existing `cmd_set_config` path so all
        // the live-app reconfiguration logic (theme
        // CSS class, font CSS variables, etc.) runs
        // exactly as if the user had clicked through
        // Settings. We rebuild a synthetic IpcMessage
        // shell with just the JSON params.
        let synthetic_params = serde_json::json!({
            "theme": cfg.get("theme"),
            "language": cfg.get("language"),
            "last_workspace": cfg.get("last_workspace"),
            "editor": cfg.get("editor"),
        });
        cmd_set_config(&synthetic_params, state)?;
        if cfg.get("theme").is_some() { restored_keys.push("theme".to_string()) }
        if cfg.get("language").is_some() { restored_keys.push("language".to_string()) }
        if cfg.get("editor").is_some() { restored_keys.push("editor.*".to_string()) }
    }

    // Vim mode is a top-level field on AppConfig — write
    // it directly via the same path the runtime uses.
    if let Some(vim_mode) = payload.get("config").and_then(|c| c.get("vim_mode")).and_then(|v| v.as_bool()) {
        let mut config = lock_or_recover(&state.config);
        config.vim_mode = vim_mode;
        drop(config);
        state.save_config();
        restored_keys.push("vim_mode".to_string());
    }

    // P0-X: word-count goal — same pattern as vim_mode.
    if let Some(goal) = payload.get("config").and_then(|c| c.get("word_count_goal")).and_then(|v| v.as_u64()) {
        let mut config = lock_or_recover(&state.config);
        config.word_count_goal = goal as u32;
        drop(config);
        state.save_config();
        restored_keys.push("word_count_goal".to_string());
    }

    // 2. Restore keybindings by writing the JSON array to
    // the on-disk keybindings file. We don't re-emit
    // individual `update_keybinding` IPCs because the
    // host file is the source of truth — the next editor
    // mount reads from it.
    let mut keybindings_restored = 0usize;
    if let Some(kb) = payload.get("keybindings").and_then(|v| v.as_array()) {
        let path = mt_core::keymap::keybindings_path();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        match std::fs::write(&path, serde_json::to_string_pretty(kb).unwrap_or_else(|_| "[]".to_string())) {
            Ok(_) => keybindings_restored = kb.len(),
            Err(e) => return Err(format!("Failed to write keybindings: {e}")),
        }
        restored_keys.push("keybindings".to_string());
    }

    // 3. Restore custom themes — write each JSON file
    // into the custom-themes directory, skipping entries
    // that already exist with the same id (we don't want
    // a restore to clobber the user's local edits).
    let mut themes_restored = 0usize;
    let mut themes_skipped = 0usize;
    if let Some(themes) = payload.get("themes").and_then(|v| v.as_array()) {
        let dir = mt_core::theme::themes_dir();
        let _ = std::fs::create_dir_all(&dir);
        for theme in themes {
            let Some(id) = theme.get("id").and_then(|v| v.as_str()) else { continue };
            let target = dir.join(format!("{id}.json"));
            if target.exists() {
                themes_skipped += 1;
                continue;
            }
            match std::fs::write(&target, serde_json::to_string_pretty(theme).unwrap_or_else(|_| "{}".to_string())) {
                Ok(_) => themes_restored += 1,
                Err(_) => themes_skipped += 1,
            }
        }
        restored_keys.push("themes".to_string());
    }

    Ok(serde_json::json!({
        "ok": true,
        "restored": restored_keys,
        "themes_restored": themes_restored,
        "themes_skipped": themes_skipped,
        "keybindings_restored": keybindings_restored,
    }))
}
