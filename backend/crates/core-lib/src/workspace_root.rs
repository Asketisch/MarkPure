//! WorkspaceRoot —— 多根工作区中的一个文件夹。
//!
//! 每个根都是带稳定唯一 ID 的规范化绝对路径。根是「打开哪些文件夹」
//! 的事实来源；更早的 `Workspace { folders: Vec<FolderInfo> }` 模型
//! 的视图由此派生。

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// 单个工作区根文件夹（多根工作区成员）。
///
/// 与 `FolderInfo`（携带每个面板的派生状态，如 `is_expanded`）不同：
/// `WorkspaceRoot` 是持久化的规范记录。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspaceRoot {
    /// 稳定唯一 ID；重启后仍保留。用作文件监听事件的 `workspace_id`，
    /// 以及 `TabState.workspace_root_id` 的判别依据。
    pub id: String,
    /// 绝对的规范化路径。永不为空。
    pub path: String,
    /// 显示名（创建时取自 `path` 的 basename，之后可重命名）。
    pub name: String,
    /// 添加该根时的 Unix 纪元秒。用于 UI 中的稳定排序。
    #[serde(default)]
    pub added_at: u64,
}

impl WorkspaceRoot {
    /// 从用户提供的原始路径构建新的 `WorkspaceRoot`。
    ///
    /// 执行规范化（尽力而为：路径尚不存在时保留原始值，避免丢失
    /// 用户意图），用「秒 + 亚秒纳秒 + 进程内序号」生成
    /// 跨进程碰撞概率可忽略的唯一 ID，并从路径的 basename
    /// 派生显示名。
    pub fn from_path(path: &str) -> Self {
        Self::from_path_with_time(path, current_unix_secs(), next_root_seq())
    }

    /// 便于测试的构造函数：调用方提供 `added_at` 和一个序列号，
    /// 两者与当前亚秒纳秒一起混入 id，使同一秒内（甚至跨进程
    /// 重启落在同一秒时）添加的两个根也能获得不同的 id。
    pub fn from_path_with_time(path: &str, added_at: u64, seq: u64) -> Self {
        let canonical = std::fs::canonicalize(path)
            .ok()
            .and_then(|p| p.to_str().map(|s| s.to_string()))
            .unwrap_or_else(|| path.to_string());

        let name = PathBuf::from(&canonical)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(&canonical)
            .to_string();

        let id = format!("root-{:x}-{:x}-{:x}", added_at, current_subsec_nanos(), seq);

        Self {
            id,
            path: canonical,
            name,
            added_at,
        }
    }

    /// 从调用方已规范化的路径构建 [`WorkspaceRoot`]。供
    /// `AppConfig::add_workspace_root` 使用——那里我们为去重解析一次路径，
    /// 之后想跳过第二次 `std::fs::canonicalize` 往返（在停滞的网络挂载上
    /// 可能阻塞数十秒并冻结 wry IPC 线程）。
    ///
    /// 路径仍然按尽力而为处理：永不为空，且当没有 basename 时
    /// 显示名回退为完整路径。
    pub fn from_canonical_path(canonical: &str, added_at: u64, seq: u64) -> Self {
        debug_assert!(!canonical.is_empty(), "from_canonical_path requires non-empty path");
        let name = PathBuf::from(canonical)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(canonical)
            .to_string();
        let id = format!("root-{:x}-{:x}-{:x}", added_at, current_subsec_nanos(), seq);
        Self {
            id,
            path: canonical.to_string(),
            name,
            added_at,
        }
    }

    /// 若目录在磁盘上仍然存在则返回 true。
    /// 供启动时的「根目录缺失」恢复流程使用（见 `cmd_list_workspace_roots`）。
    pub fn exists(&self) -> bool {
        PathBuf::from(&self.path).is_dir()
    }
}

pub(crate) fn current_unix_secs() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// 当前时间的亚秒纳秒部分，混入根 ID 以区分
/// 「同一秒、不同进程」的 id（`next_root_seq` 每进程从 0 计数，
/// 单独使用无法防跨进程碰撞）。
pub(crate) fn current_subsec_nanos() -> u32 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0)
}

pub(crate) fn next_root_seq() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    SEQ.fetch_add(1, Ordering::Relaxed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_path_uses_basename_as_name() {
        let r = WorkspaceRoot::from_path_with_time("/tmp/example", 100, 1);
        assert_eq!(r.name, "example");
        assert!(r.id.starts_with("root-"));
        assert_eq!(r.added_at, 100);
    }

    #[test]
    fn from_path_keeps_original_when_missing() {
        // 几乎肯定不存在的路径。
        let r = WorkspaceRoot::from_path_with_time(
            "/this/path/should/not/exist/zzz_xyz",
            200,
            2,
        );
        // 不存在的路径不做规范化，因此保留原始值。
        assert_eq!(r.path, "/this/path/should/not/exist/zzz_xyz");
    }

    #[test]
    fn distinct_seq_yields_distinct_ids() {
        let a = WorkspaceRoot::from_path_with_time("/tmp/a", 1, 1);
        let b = WorkspaceRoot::from_path_with_time("/tmp/b", 1, 2);
        assert_ne!(a.id, b.id);
    }

    /// `exists()` 对当前进程的临时目录返回 true（它总是存在），
    /// 对一个几乎肯定不存在的路径返回 false。
    #[test]
    fn exists_reports_actual_disk_state() {
        let real = WorkspaceRoot::from_path("/tmp");
        assert!(real.exists(), "/tmp should exist on every unix");
        let bogus = WorkspaceRoot::from_path(
            "/markpure-no-such-path-zzz-deadbeef",
        );
        assert!(!bogus.exists(), "missing path should report false");
    }

    /// `from_canonical_path` 绝不能触碰文件系统。我们
    /// 传给它一个肯定不存在的路径；构造函数必须原样接受它，
    /// 并产生 `path` 字段与输入逐字节一致的根。
    #[test]
    fn from_canonical_path_does_not_resolve() {
        let bogus = "/this/path/does/not/exist/abc_xyz";
        let r = WorkspaceRoot::from_canonical_path(bogus, 300, 4);
        assert_eq!(r.path, bogus);
        assert_eq!(r.name, "abc_xyz");
        assert_eq!(r.added_at, 300);
        assert!(r.id.starts_with("root-"));
    }

    /// basename 为空时（例如路径就是 "/"），`from_canonical_path`
    /// 用完整路径作为显示名。这与 `from_path_with_time`
    /// 中已有的回退逻辑一致。
    #[test]
    fn from_canonical_path_falls_back_to_full_path_for_name() {
        // 在 Unix 上 "/" 的 `file_name()` 为空；
        // 构造函数应回退为完整路径。
        let r = WorkspaceRoot::from_canonical_path("/", 1, 1);
        assert_eq!(r.path, "/");
        assert_eq!(r.name, "/");
    }
}
