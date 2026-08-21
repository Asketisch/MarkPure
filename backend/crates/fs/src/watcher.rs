use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::mpsc::{channel, Receiver};
use std::sync::{Arc, Mutex};

/// 文件变更事件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChangeEvent {
    /// 该变更发生所在工作区根的稳定 id。
    /// 多根目录：前端用它把刷新范围限定到正确的文件树（其他根的树
    /// 不能闪烁）。对多根目录迁移之前构建的 `FileWatcher`，此值为
    /// 空字符串，前端回退到刷新活动目录树。
    pub workspace_id: String,
    pub path: String,
    pub kind: String, // "modified" | "created" | "deleted"
}

/// 用于管理多个监视器的文件监视句柄
pub struct FileWatcher {
    watchers: Arc<Mutex<HashMap<String, WatcherHandle>>>,
}

struct WatcherHandle {
    #[allow(dead_code)]
    watcher: RecommendedWatcher,
}

impl FileWatcher {
    pub fn new() -> Self {
        Self {
            watchers: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// 监视目录变更
    /// 返回接收文件变更事件的 channel 接收端
    pub fn watch(&mut self, path: &Path, id: String) -> Result<Receiver<FileChangeEvent>, String> {
        let (tx, rx) = channel();
        // 用 move 捕获 id，让每个发出的事件都带上所属工作区，而不是
        // 创建监视器时的路径。这是按根目录刷新的关键。
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
                        if tx.send(change).is_err() {
                            eprintln!(
                                "[FileWatcher] receiver dropped, event dropped: {}",
                                path.to_string_lossy()
                            );
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

    /// 停止监视目录
    pub fn unwatch(&mut self, id: &str) {
        self.watchers.lock().unwrap().remove(id);
    }

    /// 若给定工作区 id 有活动的监视器则返回 true。
    pub fn has_watcher(&self, id: &str) -> bool {
        self.watchers.lock().unwrap().contains_key(id)
    }

    /// 返回所有当前活动监视器的 id。
    pub fn active_workspace_ids(&self) -> Vec<String> {
        self.watchers
            .lock()
            .unwrap()
            .keys()
            .cloned()
            .collect()
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
        // 新字段必须能通过 serde 往返序列化。
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
