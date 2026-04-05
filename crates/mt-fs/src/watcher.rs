use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};

/// File change event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChangeEvent {
    pub path: String,
    pub kind: String, // "modified" | "created" | "deleted"
}

/// File watcher handle for managing multiple watchers
pub struct FileWatcher {
    watchers: Arc<Mutex<HashMap<String, WatcherHandle>>>,
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
        let path_str = path.to_string_lossy().to_string();

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
                            path: path.to_string_lossy().to_string(),
                            kind: kind.to_string(),
                        };
                        let _ = tx.send(change.clone());
                        let _ = event_tx.send((path_str.clone(), change));
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
    #[allow(dead_code)]
    pub fn unwatch(&mut self, id: &str) {
        self.watchers.lock().unwrap().remove(id);
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
