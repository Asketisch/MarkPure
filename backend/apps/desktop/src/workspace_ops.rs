//! Workspace-level IPC handlers.
//!
//! Topic: app-wide state that isn't a single document or a
//! markdown-extension helper. Tab persistence, config
//! get/set, recent files, theme / keymap / i18n registry,
//! bookmarks, app info. Anything that's "what does the app
//! look like" rather than "what does this document contain".

use super::state::{lock_or_recover, AppState};
use mt_core::tab::{save_tabs, TabState, WindowTabs};
use std::collections::HashMap;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;

// ============================== Tabs ==============================

/// P0-7: aggregate every `#tag` across the workspace into a
/// `{name, count, files[]}` index. The renderer uses this to
/// populate the Tag Pane and to build "filter by tag" search
/// results.
///
/// Scope: only files with a `.md` / `.markdown` / `.mdx`
/// extension are scanned. Non-text content is skipped via the
/// same UTF-8 read-and-fallback the workspace search uses
/// (left as a future improvement; the renderer already
/// tolerates unreadable files).
pub fn cmd_get_workspace_tags(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let path_str = params["path"]
        .as_str()
        .ok_or("Missing 'path' parameter")?;
    let root = Path::new(path_str);
    if !root.exists() {
        return Err(format!("Workspace path does not exist: {}", path_str));
    }

    let max_depth = params["max_depth"].as_u64().unwrap_or(10) as usize;
    let show_hidden = params["show_hidden"].as_bool().unwrap_or(false);

    // tag -> { count, files }
    let mut index: HashMap<String, (u32, Vec<String>)> = HashMap::new();

    for entry in WalkDir::new(root)
        .max_depth(max_depth)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| show_hidden || !is_hidden(e))
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.to_ascii_lowercase());
        if !matches!(ext.as_deref(), Some("md") | Some("markdown") | Some("mdx")) {
            continue;
        }
        let content = match std::fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => continue, // binary or permission denied — skip
        };
        for tag in markdown::extract_tags(&content) {
            let entry = index.entry(tag.name).or_insert((0, Vec::new()));
            entry.0 += 1;
            let path_str = path.to_string_lossy().to_string();
            if !entry.1.iter().any(|p| p == &path_str) {
                entry.1.push(path_str);
            }
        }
    }

    // Stable, alphabetical ordering for the renderer.
    let mut tags: Vec<serde_json::Value> = index
        .into_iter()
        .map(|(name, (count, files))| {
            serde_json::json!({
                "name": name,
                "count": count,
                "files": files,
            })
        })
        .collect();
    tags.sort_by(|a, b| {
        let an = a["name"].as_str().unwrap_or("");
        let bn = b["name"].as_str().unwrap_or("");
        an.cmp(bn)
    });

    Ok(serde_json::json!({ "tags": tags }))
}

// ============================== Snippets (P2-5) ==============================

/// P2-5: list the user's snippets stored in
/// `~/.config/markpure/snippets/*.md`. Each snippet's name
/// (filename minus `.md`) is the shortcode. Body is the
/// file contents. We don't expand `$1`/`{{date}}` here — the
/// renderer does that. The list is alphabetical.
pub fn cmd_list_snippets() -> std::result::Result<serde_json::Value, String> {
    let dir = mt_core::AppConfig::config_path()
        .parent()
        .map(|p| p.join("snippets"))
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return Err(format!("Failed to create snippets dir: {}", e));
    }
    let mut entries: Vec<(String, String)> = Vec::new();
    for entry in WalkDir::new(&dir)
        .max_depth(2)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let p = entry.path();
        if !p.is_file() {
            continue;
        }
        let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("");
        if !ext.eq_ignore_ascii_case("md") {
            continue;
        }
        let name = p
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string())
            .unwrap_or_default();
        if name.is_empty() {
            continue;
        }
        if let Ok(content) = std::fs::read_to_string(p) {
            entries.push((name, content));
        }
    }
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    let snippets: Vec<serde_json::Value> = entries
        .into_iter()
        .map(|(name, content)| serde_json::json!({ "name": name, "content": content }))
        .collect();
    Ok(serde_json::json!({ "snippets": snippets }))
}

// ============================== Per-workspace CSS (P1-7) ==============================

/// P1-7: read every `*.css` file under `<workspace>/.markpure/styles/`
/// and return them concatenated. The renderer injects the
/// returned string into a global <style> element so per-workspace
/// snippets override the global theme. Files are read in
/// alphabetical order so the user can disambiguate with `01-…`,
/// `02-…` prefixes. Files that don't exist are silently ignored —
/// the absence of a `.markpure/styles/` directory is normal, not
/// an error.
pub fn cmd_load_workspace_styles(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let path_str = params["path"]
        .as_str()
        .ok_or("Missing 'path' parameter")?;
    let root = Path::new(path_str);
    if !root.exists() {
        return Err(format!("Workspace path does not exist: {}", path_str));
    }
    let styles_dir = root.join(".markpure").join("styles");
    if !styles_dir.exists() {
        return Ok(serde_json::json!({ "css": "", "files": Vec::<String>::new() }));
    }

    let mut entries: Vec<(String, std::path::PathBuf)> = Vec::new();
    for entry in WalkDir::new(&styles_dir)
        .max_depth(2)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let p = entry.path();
        if p.is_file()
            && p.extension()
                .and_then(|s| s.to_str())
                .map(|s| s.eq_ignore_ascii_case("css"))
                .unwrap_or(false)
        {
            entries.push((p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default(), p.to_path_buf()));
        }
    }
    entries.sort_by(|a, b| a.0.cmp(&b.0));

    let mut combined = String::new();
    let mut files = Vec::new();
    for (name, p) in &entries {
        match std::fs::read_to_string(p) {
            Ok(c) => {
                combined.push_str(&format!("\n/* === {} === */\n", name));
                combined.push_str(&c);
                files.push(name.clone());
            }
            Err(_) => continue,
        }
    }
    Ok(serde_json::json!({ "css": combined, "files": files }))
}

// ============================== Backlinks (P0-6) ==============================

/// A single backlink hit: a file that links *to* the queried
/// page, with a 1-line context excerpt so the renderer can
/// show the user where the link is.
#[derive(Debug, Clone, serde::Serialize)]
struct Backlink {
    /// Absolute path of the file containing the [[link]].
    source_path: String,
    /// 1-based line number where the link was found.
    line: u64,
    /// Trimmed content of the line (truncated to 240 chars).
    context: String,
}

/// P0-6: return every [[Page]] / [[Page|Alias]] in the
/// workspace whose `page` matches the given name (case
/// insensitive, exact match — aliases don't match the
/// target).
///
/// Scope: same as `cmd_get_workspace_tags` — `.md` /
/// `.markdown` / `.mdx` only, up to `max_depth` deep.
/// Unreadable files are skipped silently. The result is
/// not paginated; the renderer is expected to handle
/// long lists with virtual scrolling.
pub fn cmd_get_backlinks(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let page = params["page"]
        .as_str()
        .ok_or("Missing 'page' parameter")?;
    let path_str = params["path"]
        .as_str()
        .ok_or("Missing 'path' parameter")?;
    let root = Path::new(path_str);
    if !root.exists() {
        return Err(format!("Workspace path does not exist: {}", path_str));
    }

    let max_depth = params["max_depth"].as_u64().unwrap_or(10) as usize;
    let show_hidden = params["show_hidden"].as_bool().unwrap_or(false);
    let target = page.to_ascii_lowercase();

    let mut hits: Vec<Backlink> = Vec::new();

    for entry in WalkDir::new(root)
        .max_depth(max_depth)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| show_hidden || !is_hidden(e))
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.to_ascii_lowercase());
        if !matches!(ext.as_deref(), Some("md") | Some("markdown") | Some("mdx")) {
            continue;
        }
        let content = match std::fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        for (line_no, line) in content.lines().enumerate() {
            for link in markdown::extract_wikilinks(line) {
                if link.page.to_ascii_lowercase() == target {
                    let context = if line.chars().count() > 240 {
                        let mut s: String = line.chars().take(240).collect();
                        s.push('…');
                        s
                    } else {
                        line.to_string()
                    };
                    hits.push(Backlink {
                        source_path: path.to_string_lossy().to_string(),
                        line: (line_no as u64) + 1,
                        context,
                    });
                }
            }
        }
    }

    // Stable ordering: by file then line — easier to scan
    // than the read order, which is filesystem-dependent.
    hits.sort_by(|a, b| a.source_path.cmp(&b.source_path).then(a.line.cmp(&b.line)));

    Ok(serde_json::json!({
        "page": page,
        "backlinks": hits.iter().map(|b| serde_json::json!({
            "source_path": b.source_path,
            "line": b.line,
            "context": b.context,
        })).collect::<Vec<_>>(),
    }))
}

/// Cheap "is this entry a dotfile / dotdir?" check that matches
/// the rule used elsewhere in the fs crate for hidden files.
fn is_hidden(entry: &walkdir::DirEntry) -> bool {
    entry
        .file_name()
        .to_str()
        .map(|s| s.starts_with('.'))
        .unwrap_or(false)
}

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
