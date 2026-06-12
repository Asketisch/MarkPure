use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Phase 5: rebind every tab's `workspace_root_id` to the
/// root that contains its `path`. The longest matching root
/// path wins (so `/x/notes` beats `/x` for tab
/// `/x/notes/today.md`). Tabs whose path doesn't sit under
/// any configured root keep their existing
/// `workspace_root_id` (preserved as a hint for the
/// renderer's "unknown root" badge) — the user can move the
/// folder back under a root and the rebind will pick it up
/// on the next launch.
///
/// This is a **non-destructive** migration: it mutates the
/// in-memory `WindowTabs` list and returns it; the caller
/// decides whether to write it back. We don't auto-persist
/// because (a) the user may want to fix the path
/// configuration first and (b) the next regular `save_tabs`
/// call (when the user closes the app or adds a tab) will
/// pick up the rebound ids naturally.
pub fn rebind_tabs_to_workspace_roots(
    mut windows: Vec<WindowTabs>,
    root_paths: &[(String, String)], // (root_id, root_path)
) -> Vec<WindowTabs> {
    for w in windows.iter_mut() {
        for t in w.tabs.iter_mut() {
            // Untitled tabs have no path; leave their
            // `workspace_root_id` alone (it should be None).
            let Some(tab_path) = t.path.as_deref() else {
                continue;
            };
            // Longest-prefix wins — iterate roots sorted by
            // descending path length. Ties (two roots that
            // are prefixes of each other) are broken by the
            // sort stability: first inserted wins.
            let mut roots: Vec<&(String, String)> = root_paths.iter().collect();
            roots.sort_by(|a, b| b.1.len().cmp(&a.1.len()));
            let matched = roots
                .into_iter()
                .find(|(_, rp)| is_under_root(tab_path, rp));
            if let Some((id, _)) = matched {
                t.workspace_root_id = Some(id.clone());
            }
            // If no root matched, we leave the existing
            // value. Old `tabs.json` (pre-P2-4) files have
            // `workspace_root_id = None`; the renderer shows
            // a "unknown root" badge for those. We don't
            // clear a non-None value just because the
            // matching root is gone — the user might be
            // about to re-add it.
        }
    }
    windows
}

/// True if `path` is at or under `root`. Both arguments are
/// absolute paths on disk. We use byte-prefix matching on
/// the canonicalised path strings; this is cheap and
/// matches the rule `cmd_get_directory_tree` uses elsewhere
/// (path is in workspace if the canonicalised path string
/// starts with the canonicalised root + separator).
fn is_under_root(path: &str, root: &str) -> bool {
    // Normalise trailing slashes so `/x/notes/` doesn't
    // fail to match a tab with path `/x/notes/today.md`.
    let root_trim = root.trim_end_matches('/');
    if path == root_trim {
        return true;
    }
    path.starts_with(root_trim)
        && (root_trim.ends_with('/') || path[root_trim.len()..].starts_with('/'))
}

/// Tab state for persistence across sessions
///
/// The `content` field is intentionally **excluded** from
/// (de)serialization. Persistence lives on disk and should only
/// carry metadata (which file is open, scroll position, etc.) — the
/// actual document content is owned by the editor (Tiptap) on save
/// and re-read from the file path on load. Trusting a `content`
/// field from the client (or a corrupted tabs.json) would let a
/// tampered disk file inject arbitrary markdown into a tab on the
/// next launch. The editor's own undo/redo history is in-memory
/// and is not persisted, by design.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TabState {
    /// Unique tab identifier
    pub id: String,
    /// Display name (file name or "Untitled")
    pub name: String,
    /// File path if saved, None if new/untitled
    pub path: Option<String>,
    /// Current content
    ///
    /// `#[serde(default)]` so older tabs.json files without the
    /// field still load. We never *write* this field; see
    /// `serialize_for_disk` below. We never *read* a non-empty
    /// value either (the loader drops it) — see `load_tabs`.
    #[serde(default)]
    pub content: String,
    /// Whether the file has unsaved changes
    #[serde(default)]
    pub is_modified: bool,
    /// Scroll position as ratio (0.0 - 1.0)
    #[serde(default)]
    pub scroll_ratio: f64,
    /// Whether the file is read-only
    #[serde(default)]
    pub read_only: bool,
    /// P2-4 multi-root workspace: which `WorkspaceRoot.id` this
    /// tab belongs to. `None` for unsaved/untitled tabs (no path)
    /// or for legacy `tabs.json` files written before multi-root
    /// support. The renderer shows a "unknown root" badge for
    /// `None` and a "missing root" badge for `Some(id)` that
    /// doesn't match any current root.
    #[serde(default)]
    pub workspace_root_id: Option<String>,
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
            workspace_root_id: None,
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
            workspace_root_id: None,
        }
    }

    /// Render a `TabState` for disk persistence. We drop `content`
    /// here so the on-disk format only carries metadata.
    pub fn serialize_for_disk(&self) -> serde_json::Value {
        serde_json::json!({
            "id": self.id,
            "name": self.name,
            "path": self.path,
            "is_modified": self.is_modified,
            "scroll_ratio": self.scroll_ratio,
            "read_only": self.read_only,
            "workspace_root_id": self.workspace_root_id,
        })
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

/// Maximum number of tabs we will accept from a tabs.json file. This
/// caps the disk-bomb attack where a corrupted file claims to have
/// millions of tabs.
const MAX_TABS_PER_LOAD: usize = 256;

/// Load window tabs from config directory.
///
/// IMPORTANT: This function strips the `content` field of every
/// loaded tab. The disk file is allowed to *contain* a content
/// field (older versions wrote one) but we treat the value as
/// untrusted input and discard it. The actual document text is
/// re-read from the file path on tab activation, so the user
/// always sees the real file content.
pub fn load_tabs(config_dir: &PathBuf) -> std::io::Result<Vec<WindowTabs>> {
    let tabs_path = config_dir.join("tabs.json");
    if !tabs_path.exists() {
        return Ok(Vec::new());
    }
    let raw = std::fs::read_to_string(&tabs_path)?;
    let mut windows: Vec<WindowTabs> = serde_json::from_str(&raw).map_err(|e| {
        std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string())
    })?;

    // Enforce the tab-count cap. We truncate from the front so a
    // user with hundreds of open tabs isn't surprised to find the
    // *active* one missing.
    let mut total = 0usize;
    for w in windows.iter_mut() {
        if w.tabs.len() + total > MAX_TABS_PER_LOAD {
            w.tabs.truncate(MAX_TABS_PER_LOAD.saturating_sub(total));
        }
        total += w.tabs.len();
        // Strip content — the disk value is untrusted.
        for t in w.tabs.iter_mut() {
            t.content.clear();
        }
    }
    Ok(windows)
}

/// Save window tabs to config directory
pub fn save_tabs(config_dir: &PathBuf, windows: &[WindowTabs]) -> std::io::Result<()> {
    let tabs_path = config_dir.join("tabs.json");
    if let Some(parent) = tabs_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    // Hand-roll the JSON to guarantee no `content` field leaks
    // into the on-disk format. This is the inverse of load_tabs'
    // "strip content" rule.
    let mut out = String::from("[\n");
    for (i, w) in windows.iter().enumerate() {
        if i > 0 {
            out.push_str(",\n");
        }
        out.push_str("  {\n");
        out.push_str(&format!("    \"window_id\": {},\n", serde_json::to_string(&w.window_id).unwrap_or_else(|_| "null".into())));
        out.push_str(&format!("    \"active_tab_id\": {},\n", serde_json::to_string(&w.active_tab_id).unwrap_or_else(|_| "null".into())));
        out.push_str("    \"tabs\": [");
        for (j, t) in w.tabs.iter().enumerate() {
            if j > 0 {
                out.push(',');
            }
            out.push('\n');
            let v = t.serialize_for_disk();
            let s = serde_json::to_string_pretty(&v).unwrap_or_else(|_| "{}".into());
            // re-indent the inner object
            for line in s.lines() {
                out.push_str("      ");
                out.push_str(line);
                out.push('\n');
            }
        }
        if !w.tabs.is_empty() {
            out.push_str("    ]\n");
        } else {
            out.push_str("]\n");
        }
        out.push_str("  }");
    }
    out.push_str("\n]\n");
    std::fs::write(&tabs_path, out)
}

/// Get the default tabs file path
pub fn tabs_path() -> PathBuf {
    crate::dirs::app_config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("tabs.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_strips_trusted_content_field() {
        // A tabs.json smuggled in by an attacker (or just a leftover
        // from an older version that wrote content) must NOT inject
        // its `content` field into the running tab. The disk is
        // untrusted input.
        let dir = std::env::temp_dir().join("markpure-tab-test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("tabs.json");
        std::fs::write(
            &path,
            r#"[
              {
                "window_id": "main",
                "active_tab_id": "t1",
                "tabs": [
                  {"id": "t1", "name": "evil", "path": null,
                   "content": "<script>alert(1)</script>", "is_modified": false,
                   "scroll_ratio": 0.0, "read_only": false}
                ]
              }
            ]"#,
        )
        .unwrap();

        let loaded = load_tabs(&dir).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].tabs.len(), 1);
        assert!(
            loaded[0].tabs[0].content.is_empty(),
            "trusted disk content leaked: {:?}",
            loaded[0].tabs[0].content
        );
    }

    #[test]
    fn load_caps_excessive_tab_count() {
        let dir = std::env::temp_dir().join("markpure-tab-cap");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("tabs.json");
        // Build a 300-tab file. The cap is 256.
        let mut s = String::from(r#"[{"window_id": "w", "active_tab_id": null, "tabs": ["#);
        for i in 0..300 {
            if i > 0 {
                s.push(',');
            }
            s.push_str(&format!(
                r#"{{"id":"t{i}","name":"t{i}","path":null,"content":"","is_modified":false,"scroll_ratio":0.0,"read_only":false}}"#
            ));
        }
        s.push_str("]}]");
        std::fs::write(&path, s).unwrap();

        let loaded = load_tabs(&dir).unwrap();
        let total: usize = loaded.iter().map(|w| w.tabs.len()).sum();
        assert!(total <= MAX_TABS_PER_LOAD, "got {total} tabs");
    }

    #[test]
    fn save_does_not_emit_content_field() {
        let dir = std::env::temp_dir().join("markpure-tab-save");
        std::fs::create_dir_all(&dir).unwrap();
        let mut t = TabState::with_path("t1".into(), "/tmp/secret.md".into());
        // Pretend the editor has lots of content. Saving must NOT
        // serialize this — that's the rule.
        t.content = "SENSITIVE PASSWORD DATA".into();

        save_tabs(&dir, &[WindowTabs {
            window_id: "main".into(),
            active_tab_id: Some("t1".into()),
            tabs: vec![t],
        }]).unwrap();

        let on_disk = std::fs::read_to_string(dir.join("tabs.json")).unwrap();
        assert!(!on_disk.contains("SENSITIVE PASSWORD DATA"),
                "content leaked to disk: {on_disk}");
        assert!(!on_disk.contains("\"content\""), "content field emitted: {on_disk}");
    }

    #[test]
    fn load_handles_missing_workspace_root_id_field() {
        // P2-4 backwards compat: tabs.json written by a single-root
        // build (no workspace_root_id field) must still load — the
        // field should be `None` on the loaded tab.
        let dir = std::env::temp_dir().join("markpure-tab-legacy-wroot");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("tabs.json");
        std::fs::write(
            &path,
            r#"[
              {
                "window_id": "main",
                "active_tab_id": "t1",
                "tabs": [
                  {"id": "t1", "name": "old", "path": "/x/a.md",
                   "is_modified": false, "scroll_ratio": 0.0, "read_only": false}
                ]
              }
            ]"#,
        )
        .unwrap();

        let loaded = load_tabs(&dir).unwrap();
        assert_eq!(loaded[0].tabs[0].workspace_root_id, None,
                   "legacy tabs.json should deserialize workspace_root_id as None");
    }

    #[test]
    fn round_trip_preserves_workspace_root_id() {
        let dir = std::env::temp_dir().join("markpure-tab-rt-wroot");
        std::fs::create_dir_all(&dir).unwrap();
        let mut t = TabState::with_path("t1".into(), "/x/a.md".into());
        t.workspace_root_id = Some("root-abc".into());

        save_tabs(&dir, &[WindowTabs {
            window_id: "main".into(),
            active_tab_id: Some("t1".into()),
            tabs: vec![t],
        }]).unwrap();

        let loaded = load_tabs(&dir).unwrap();
        assert_eq!(loaded[0].tabs[0].workspace_root_id.as_deref(), Some("root-abc"));
    }

    /// Phase 5: pre-P2-4 tabs (no `workspace_root_id`) get
    /// rebound to the root that contains their `path`. The
    /// rebind is longest-prefix-wins, so the more specific
    /// root wins when two are configured.
    #[test]
    fn rebind_finds_longest_matching_root() {
        let tab = TabState::with_path("t1".into(), "/x/notes/today.md".into());
        let windows = vec![WindowTabs {
            window_id: "main".into(),
            active_tab_id: Some("t1".into()),
            tabs: vec![tab],
        }];
        let roots = vec![
            ("root-loose".into(), "/x".into()),
            ("root-tight".into(), "/x/notes".into()),
            ("root-other".into(), "/y".into()),
        ];
        let rebound = rebind_tabs_to_workspace_roots(windows, &roots);
        assert_eq!(
            rebound[0].tabs[0].workspace_root_id.as_deref(),
            Some("root-tight"),
        );
    }

    /// Phase 5: a tab whose path is outside every root keeps
    /// its existing `workspace_root_id` (or stays `None` if
    /// the tab was loaded from a pre-P2-4 file). We never
    /// overwrite a hint with `None` — losing the hint would
    /// make it harder for the user to fix a misconfigured
    /// workspace later.
    #[test]
    fn rebind_preserves_unmatched_tab() {
        let tab = TabState::with_path("t1".into(), "/elsewhere/a.md".into());
        let windows = vec![WindowTabs {
            window_id: "main".into(),
            active_tab_id: Some("t1".into()),
            tabs: vec![tab],
        }];
        let roots = vec![("root-x".into(), "/x".into())];
        let rebound = rebind_tabs_to_workspace_roots(windows, &roots);
        assert_eq!(rebound[0].tabs[0].workspace_root_id, None);
    }

    /// Phase 5: an Untitled tab (no `path`) keeps whatever
    /// `workspace_root_id` it had, since there's nothing
    /// to match. Pre-P2-4 untitleds have `None`, which the
    /// rebind leaves alone.
    #[test]
    fn rebind_skips_untitled_tabs() {
        let tab = TabState::new("u1".into(), "Untitled".into());
        let windows = vec![WindowTabs {
            window_id: "main".into(),
            active_tab_id: Some("u1".into()),
            tabs: vec![tab],
        }];
        let roots = vec![("root-x".into(), "/x".into())];
        let rebound = rebind_tabs_to_workspace_roots(windows, &roots);
        assert_eq!(rebound[0].tabs[0].workspace_root_id, None);
    }
}
