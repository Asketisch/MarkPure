//! 文件信息（只读状态、修改时间、大小）与外部修改跟踪。
//!
//! 跟踪表仅存活于进程内存（会话级）：`track_file` 记录 mtime，
//! `is_file_modified` 比对当前 mtime 判断文件是否被外部修改过。

use crate::Error;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

/// 文件信息（含只读状态与修改时间）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileInfo {
    pub path: String,
    pub is_readonly: bool,
    pub is_modified: bool,
    pub mtime: Option<u64>,
    pub size: Option<u64>,
}

/// 检查文件是否只读
pub fn is_file_readonly(path: &str) -> bool {
    let path = PathBuf::from(path);

    // 文件不存在时不视为只读
    if !path.exists() {
        return false;
    }

    // Unix 下检查权限位。`PermissionsExt` 是 unix 专属 API，
    // 不能无条件引入（否则 Windows 构建直接失败）。
    #[cfg(unix)]
    if let Ok(metadata) = fs::metadata(&path) {
        use std::os::unix::fs::PermissionsExt;
        let mode = metadata.permissions().mode();
        // 任何一类（user/group/other）都没有写权限即视为只读
        return mode & 0o222 == 0;
    }

    // 非 Unix 平台（及 Unix 上取 metadata 失败）退而求其次：
    // 尝试以写模式打开。
    if let Ok(file) = fs::OpenOptions::new().write(true).open(&path) {
        drop(file);
        false // 可写
    } else {
        true // 不可写（只读或无权限）
    }
}

/// 获取文件信息（只读状态、修改时间、大小）
pub fn get_file_info(path: &str) -> Result<FileInfo, Error> {
    let path = PathBuf::from(path);
    let metadata = fs::metadata(&path)?;

    let is_readonly = is_file_readonly(path.to_str().unwrap_or(""));

    let mtime = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok().map(|d| d.as_secs()));

    let size = Some(metadata.len());

    Ok(FileInfo {
        path: path.to_string_lossy().to_string(),
        is_readonly,
        is_modified: false,
        mtime,
        size,
    })
}

// 被跟踪文件的修改时间（进程内存，会话级）
lazy_static::lazy_static! {
    static ref TRACKED_FILES: Mutex<HashMap<String, u64>> = Mutex::new(HashMap::new());
}

/// 获取 `TRACKED_FILES` 锁；若此前有调用方 panic 导致锁中毒，
/// 打印日志后接管锁，而不是让整条 IPC 管道持续报错。
/// 与 `apps/desktop/src/state.rs` 的 `lock_or_recover` 语义保持一致。
fn tracked_lock() -> std::sync::MutexGuard<'static, HashMap<String, u64>> {
    match TRACKED_FILES.lock() {
        Ok(g) => g,
        Err(poisoned) => {
            eprintln!("[assets] TRACKED_FILES poisoned, recovering");
            poisoned.into_inner()
        }
    }
}

/// 开始跟踪一个文件，返回其当前 mtime
pub fn track_file(path: &str) -> Result<u64, Error> {
    let path_str = path.to_string();
    let metadata = fs::metadata(&path_str)?;
    let mtime = metadata
        .modified()
        .map_err(|_| std::io::Error::other("Failed to get mtime"))?
        .duration_since(UNIX_EPOCH)
        .map_err(|_| Error::ClockBeforeEpoch)?
        .as_secs();

    tracked_lock().insert(path_str, mtime);
    Ok(mtime)
}

/// 检查被跟踪的文件是否被外部修改过
pub fn is_file_modified(path: &str) -> Result<bool, Error> {
    let path_str = path.to_string();

    let tracked_mtime = {
        let files = tracked_lock();
        files.get(&path_str).copied()
    };

    if let Some(tracked) = tracked_mtime {
        let metadata = fs::metadata(&path_str)?;
        let current_mtime = metadata
            .modified()
            .map_err(|_| std::io::Error::other("Failed to get mtime"))?
            .duration_since(UNIX_EPOCH)
            .map_err(|_| Error::ClockBeforeEpoch)?
            .as_secs();

        Ok(current_mtime > tracked)
    } else {
        // 未跟踪的文件不报告为已修改
        Ok(false)
    }
}

/// 停止跟踪一个文件
pub fn untrack_file(path: &str) {
    tracked_lock().remove(path);
}
