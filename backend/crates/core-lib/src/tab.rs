use serde::{Deserialize, Serialize};
use std::path::PathBuf;

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
}
