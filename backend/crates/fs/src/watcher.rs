use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};

/// File change event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChangeEvent {
    /// Stable id of the workspace root this change happened under.
    /// P2-4 multi-root: the frontend uses this to scope the refresh
    /// to the correct file tree (other roots' trees must not flicker).
    /// For a `FileWatcher` built before the multi-root migration, this
    /// is the empty string and the frontend falls back to refreshing
    /// the active tree.
    pub workspace_id: String,
    pub path: String,
    pub kind: String, // "modified" | "created" | "deleted"
}

/// File watcher handle for managing multiple watchers
pub struct FileWatcher {
    watchers: Arc<Mutex<HashMap<String, WatcherHandle>>>,
    /// Each event is paired with the workspace id (matching a key in
    /// `watchers`) so the consumer can scope its refresh.
    event_tx: Sender<(String, FileChangeEvent)>,
}

struct WatcherHandle {
    #[allow(dead_code)]
    watcher: RecommendedWatcher,
}

impl FileWatcher {
    pub fn new() -> Self {
        let (event_tx, _event_rx) = channel();
        Self {
            watchers: Arc::new(Mutex::new(HashMap::new())),
            event_tx,
        }
    }

    /// Watch a directory for changes
    /// Returns a receiver for file change events
    pub fn watch(&mut self, path: &Path, id: String) -> Result<Receiver<FileChangeEvent>, String> {
        let (tx, rx) = channel();
        let event_tx = self.event_tx.clone();
        // Capture the id by move so each emitted event is tagged with
        // its workspace, not the path the watcher was created with.
        // This is the key piece that makes per-root refresh work.
        let id_for_closure = id.clone();

        let mut watcher = RecommendedWatcher::new(
            move |res: Result<notify::Event, notify::Error>| {
                if let Ok(event) = res {
                    let kind = match event.kind {
                        notify::EventKind::Modify(_) => "modified",
                        notify::EventKind::Create(_) => "created",
                        notify::EventKind::Remove(_) => "deleted",
                        _ => return,
                    };

                    for path in event.paths {
                        let change = FileChangeEvent {
                            workspace_id: id_for_closure.clone(),
                            path: path.to_string_lossy().to_string(),
                            kind: kind.to_string(),
                        };
                        if tx.send(change.clone()).is_err() {
                            eprintln!("[FileWatcher] receiver dropped, event dropped: {}", change.path);
                        }
                        if event_tx.send((id_for_closure.clone(), change)).is_err() {
                            eprintln!("[FileWatcher] event_tx dropped, events will not be forwarded");
                        }
                    }
                }
            },
            Config::default(),
        )
        .map_err(|e| e.to_string())?;

        watcher
            .watch(path, RecursiveMode::Recursive)
            .map_err(|e| e.to_string())?;

        let handle = WatcherHandle { watcher };
        self.watchers.lock().unwrap().insert(id.clone(), handle);

        Ok(rx)
    }

    /// Stop watching a directory
    pub fn unwatch(&mut self, id: &str) {
        self.watchers.lock().unwrap().remove(id);
    }

    /// Returns true if the given workspace id has an active watcher.
    pub fn has_watcher(&self, id: &str) -> bool {
        self.watchers.lock().unwrap().contains_key(id)
    }

    /// Returns the ids of all currently active watchers.
    pub fn active_workspace_ids(&self) -> Vec<String> {
        self.watchers
            .lock()
            .unwrap()
            .keys()
            .cloned()
            .collect()
    }

    /// Get the event channel sender (for internal use)
    #[allow(dead_code)]
    pub fn event_channel(&self) -> &Sender<(String, FileChangeEvent)> {
        &self.event_tx
    }
}

impl Default for FileWatcher {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_change_event_carries_workspace_id() {
        let ev = FileChangeEvent {
            workspace_id: "root-abc".to_string(),
            path: "/tmp/x.md".to_string(),
            kind: "modified".to_string(),
        };
        let json = serde_json::to_string(&ev).unwrap();
        // The new field must round-trip through serde.
        let back: FileChangeEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(back.workspace_id, "root-abc");
        assert_eq!(back.path, "/tmp/x.md");
        assert_eq!(back.kind, "modified");
    }

    #[test]
    fn unwatch_drops_workspace_id() {
        let mut w = FileWatcher::new();
        let dir = tempdir_unique("watcher-test");
        let rx = w.watch(&dir, "root-a".into()).unwrap();
        assert!(w.has_watcher("root-a"));
        w.unwatch("root-a");
        assert!(!w.has_watcher("root-a"));
        drop(rx);
        std::fs::remove_dir_all(&dir).ok();
    }

    fn tempdir_unique(label: &str) -> std::path::PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("markpure-fs-{}-{}", label, std::process::id()));
        std::fs::create_dir_all(&p).unwrap();
        p
    }
}
