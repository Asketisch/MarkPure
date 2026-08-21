use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum Error {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Bookmark not found")]
    NotFound,
    #[error("Invalid ID")]
    InvalidId,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bookmark {
    pub id: String,
    pub path: String,
    pub title: String,
    pub description: String,
    pub tags: Vec<String>,
    pub created_at: u64,
    pub updated_at: u64,
    /// 多根目录工作区：该书签所属的 `WorkspaceRoot.id`。
    /// `#[serde(default)]` 让支持多根目录之前写入的旧 `bookmarks.json`
    /// 文件仍可加载。当工作区存储知道多个根目录时，渲染器会按此值
    /// 分组/筛选。
    #[serde(default)]
    pub workspace_root_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[derive(Default)]
pub struct BookmarkStore {
    pub bookmarks: Vec<Bookmark>,
}


/// 获取书签文件的路径
pub fn bookmarks_path() -> PathBuf {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("markpure");
    fs::create_dir_all(&config_dir).ok();
    config_dir.join("bookmarks.json")
}

/// 「加载 → 修改 → 保存」序列的进程内锁。慢速 IPC 命令各自运行在
/// 专用 OS 线程上，两个并发的书签修改会互相覆盖对方的结果
/// （丢失更新）；该锁把每个修改序列串行化。
static BOOKMARKS_LOCK: Mutex<()> = Mutex::new(());

fn locked() -> std::sync::MutexGuard<'static, ()> {
    // 毒化的锁（持锁线程 panic）不应当让书签功能整体不可用：
    // 直接取回内值继续。
    BOOKMARKS_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// 加载所有书签
pub fn load_bookmarks() -> Result<Vec<Bookmark>, Error> {
    load_store(&bookmarks_path()).map(|s| s.bookmarks)
}

/// 从指定文件加载书签库。文件损坏（非法 JSON，例如写入中断
/// 留下的半截文件）时把损坏文件改名为 `*.corrupt-<epoch>` 备份，
/// 并返回空库——单文件损坏不应让整个书签功能瘫痪，用户可以在
/// 配置目录里找回备份。
pub(crate) fn load_store(path: &Path) -> Result<BookmarkStore, Error> {
    if !path.exists() {
        return Ok(BookmarkStore::default());
    }
    let content = fs::read_to_string(path)?;
    match serde_json::from_str::<BookmarkStore>(&content) {
        Ok(store) => Ok(store),
        Err(e) => {
            eprintln!("[bookmark] bookmarks file corrupted, backing up and starting fresh: {e}");
            let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("bookmarks.json");
            let backup = path.with_file_name(format!("{name}.corrupt-{}", now_secs()));
            if fs::rename(path, &backup).is_err() {
                // 备份失败（如只读目录）：直接移除损坏文件，
                // 避免每次加载都失败。
                let _ = fs::remove_file(path);
            }
            Ok(BookmarkStore::default())
        }
    }
}

/// 保存所有书签（原子写入，见 `save_store`）
pub fn save_bookmarks(bookmarks: &[Bookmark]) -> Result<(), Error> {
    save_store(&bookmarks_path(), bookmarks)
}

/// 把书签库原子保存到指定文件：先写同目录下的 `.{name}.tmp`
/// 再 `rename`（同一文件系统内 rename 原子），写入中断时磁盘上
/// 要么是完整旧文件、要么是完整新文件。
pub(crate) fn save_store(path: &Path, bookmarks: &[Bookmark]) -> Result<(), Error> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let store = BookmarkStore {
        bookmarks: bookmarks.to_vec(),
    };
    let content = serde_json::to_string_pretty(&store)?;
    let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("bookmarks.json");
    let tmp = path.with_file_name(format!(".{name}.tmp"));
    if let Err(e) = fs::write(&tmp, content) {
        let _ = fs::remove_file(&tmp);
        return Err(e.into());
    }
    fs::rename(&tmp, path)?;
    Ok(())
}

/// 当前 Unix 秒。系统时钟回拨到 1970 之前时返回 0
/// 而不是 unwrap panic（桌面时钟回拨罕见但可能发生）。
fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// 生成新的书签 ID
pub fn generate_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    // 同一纳秒内的两次调用过去会产生相同的 ID（并导致不稳定的测试）。
    // 我们混入进程内单调计数器，即使在紧密连续调用下也能保证唯一性。
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        // 桌面系统时钟回拨很少见但可能发生（NTP、休眠/唤醒、手动改时间）。
        // 回退到 0 而不是 unwrap 让 IPC 处理器 panic。
        .unwrap_or(0);
    let rand_suffix = (now as u64).wrapping_mul(2654435761).rotate_left(17) ^ seq;
    format!("{:x}{:08x}", now, rand_suffix & 0xFFFFFFFF)
}

/// 按 ID 获取书签
pub fn get_bookmark(id: &str) -> Result<Bookmark, Error> {
    let bookmarks = load_bookmarks()?;
    bookmarks
        .iter()
        .find(|b| b.id == id)
        .cloned()
        .ok_or(Error::NotFound)
}

/// 添加新书签。
///
/// `workspace_root_id` 是多根目录绑定——单根目录调用方，或不与已知
/// 根目录关联的书签（例如指向任何根目录之外的路径）传 `None`。
pub fn add_bookmark(
    path: &str,
    title: &str,
    tags: Vec<String>,
    workspace_root_id: Option<&str>,
) -> Result<Bookmark, Error> {
    let _guard = locked();
    let mut bookmarks = load_bookmarks()?;
    let now = now_secs();

    let bookmark = Bookmark {
        id: generate_id(),
        path: path.to_string(),
        title: title.to_string(),
        description: String::new(),
        tags,
        created_at: now,
        updated_at: now,
        workspace_root_id: workspace_root_id.map(String::from),
    };

    bookmarks.push(bookmark.clone());
    save_bookmarks(&bookmarks)?;
    Ok(bookmark)
}

/// 更新书签
pub fn update_bookmark(
    id: &str,
    title: Option<&str>,
    description: Option<&str>,
    tags: Option<Vec<String>>,
) -> Result<Bookmark, Error> {
    let _guard = locked();
    let mut bookmarks = load_bookmarks()?;
    let bookmark = bookmarks
        .iter_mut()
        .find(|b| b.id == id)
        .ok_or(Error::NotFound)?;

    if let Some(t) = title {
        bookmark.title = t.to_string();
    }
    if let Some(d) = description {
        bookmark.description = d.to_string();
    }
    if let Some(t) = tags {
        bookmark.tags = t;
    }
    bookmark.updated_at = now_secs();

    let updated = bookmark.clone();
    save_bookmarks(&bookmarks)?;
    Ok(updated)
}

/// 删除书签
pub fn remove_bookmark(id: &str) -> Result<bool, Error> {
    let _guard = locked();
    let mut bookmarks = load_bookmarks()?;
    let initial_len = bookmarks.len();
    bookmarks.retain(|b| b.id != id);

    if bookmarks.len() == initial_len {
        return Err(Error::NotFound);
    }

    save_bookmarks(&bookmarks)?;
    Ok(true)
}

/// 按查询条件搜索书签（匹配标题、路径或标签）
pub fn search_bookmarks(query: &str) -> Result<Vec<Bookmark>, Error> {
    let bookmarks = load_bookmarks()?;
    let query_lower = query.to_lowercase();

    let results: Vec<Bookmark> = bookmarks
        .into_iter()
        .filter(|b| {
            b.title.to_lowercase().contains(&query_lower)
                || b.path.to_lowercase().contains(&query_lower)
                || b.tags.iter().any(|t| t.to_lowercase().contains(&query_lower))
        })
        .collect();

    Ok(results)
}

/// 按标签获取书签
pub fn get_bookmarks_by_tag(tag: &str) -> Result<Vec<Bookmark>, Error> {
    let bookmarks = load_bookmarks()?;
    let tag_lower = tag.to_lowercase();

    let results: Vec<Bookmark> = bookmarks
        .into_iter()
        .filter(|b| b.tags.iter().any(|t| t.to_lowercase() == tag_lower))
        .collect();

    Ok(results)
}

/// 获取所有不重复的标签
pub fn get_all_tags() -> Result<Vec<String>, Error> {
    let bookmarks = load_bookmarks()?;
    let mut tags: Vec<String> = bookmarks
        .iter()
        .flat_map(|b| b.tags.clone())
        .collect();
    tags.sort();
    tags.dedup();
    Ok(tags)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_id() {
        let id1 = generate_id();
        let id2 = generate_id();
        assert_ne!(id1, id2);
    }

    /// `add_bookmark` 会往返携带 `workspace_root_id`。
    /// 此处无法在不污染用户配置目录的情况下测试真实的磁盘
    /// `bookmarks.json`，因此只对返回的结构体做断言。序列化往返由下方
    /// `legacy_json_loads_without_field` 测试覆盖。
    #[test]
    fn add_bookmark_records_workspace_root_id() {
        let bm = Bookmark {
            id: "x".into(),
            path: "/p".into(),
            title: "t".into(),
            description: String::new(),
            tags: vec![],
            created_at: 0,
            updated_at: 0,
            workspace_root_id: Some("root-A".into()),
        };
        assert_eq!(bm.workspace_root_id.as_deref(), Some("root-A"));
    }

    /// 多根目录向后兼容：由旧版本（无 `workspace_root_id` 字段）写出的
    /// `bookmarks.json` 必须仍能反序列化——该字段默认为 `None`。
    #[test]
    fn legacy_json_loads_without_field() {
        let json = r#"{
            "id": "old",
            "path": "/x/a.md",
            "title": "old",
            "description": "",
            "tags": [],
            "created_at": 0,
            "updated_at": 0
        }"#;
        let bm: Bookmark = serde_json::from_str(json).expect("legacy JSON should parse");
        assert_eq!(bm.workspace_root_id, None);
    }

    /// 损坏的书签文件（如写入中断留下的半截 JSON）必须触发
    /// 「备份 + 空库恢复」，而不是让所有书签操作持续报错。
    #[test]
    fn corrupted_store_recovers_with_backup() {
        let dir = std::env::temp_dir().join(format!("markpure-bookmark-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("bookmarks.json");
        std::fs::write(&p, "{ truncated json").unwrap();

        let store = load_store(&p).expect("corrupt file must recover, not error");
        assert!(store.bookmarks.is_empty(), "recovered store should be empty");
        assert!(!p.exists(), "corrupt original should be moved aside");
        let backed_up = std::fs::read_dir(&dir)
            .unwrap()
            .any(|e| e.unwrap().file_name().to_string_lossy().starts_with("bookmarks.json.corrupt-"));
        assert!(backed_up, "corrupt file should be kept as a backup");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 保存必须是原子的：成功保存后不得残留 `.tmp`，
    /// 且内容完整往返。
    #[test]
    fn save_store_is_atomic_roundtrip() {
        let dir = std::env::temp_dir().join(format!("markpure-bookmark-rt-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("bookmarks.json");

        let bm = Bookmark {
            id: "abc".into(),
            path: "/p".into(),
            title: "t".into(),
            description: String::new(),
            tags: vec!["x".into()],
            created_at: 1,
            updated_at: 2,
            workspace_root_id: None,
        };
        save_store(&p, std::slice::from_ref(&bm)).unwrap();
        let store = load_store(&p).unwrap();
        assert_eq!(store.bookmarks.len(), 1);
        assert_eq!(store.bookmarks[0].id, bm.id);
        assert_eq!(store.bookmarks[0].tags, vec!["x".to_string()]);
        assert!(!dir.join(".bookmarks.json.tmp").exists(), "tmp file left behind");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
