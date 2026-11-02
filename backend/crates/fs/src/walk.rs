use mt_core::error::{Error, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;

/// Git 文件状态
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum GitStatus {
    Unmodified,
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    Untracked,
    Ignored,
    Unmerged,
}

/// 目录树中的文件条目
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    #[serde(default)]
    pub children: Vec<FileEntry>,
    pub mtime: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub git_status: Option<GitStatus>,
}

/// 遍历目录并返回文件的树形结构
/// depth：最大递归深度（0 表示不限制）
///
/// 同步函数：内部包含 git 子进程与递归文件系统遍历，全部是阻塞 I/O。
/// 之前的 async 签名只会误导调用方以为它不会阻塞；IPC 处理线程
/// 本来就应当同步等待目录树结果，所以这里直接如实暴露为同步 API。
pub fn walk_directory(path: &Path, depth: u32, show_hidden: bool) -> Result<Vec<FileEntry>> {
    let path = path.to_path_buf();
    let repo_root = find_git_root(&path);
    let git_statuses = if let Some(ref root) = repo_root {
        load_git_status_map(root)
    } else {
        None
    };
    // 防止符号链接环：一个目录可能通过多条路径出现（例如 `dir/loop/loop/...`）。
    // 若没有已访问集合，下面的递归要么栈溢出，要么在仅受 `max_depth` 限制的
    // 「软」环上静默截断目录树。在 Unix 上按 `(dev, ino)` 记录每个已访问的
    // 目录（除了每个条目已经做的 `metadata()` 调用外，零额外系统调用），
    // 其他平台则用规范化路径记录。
    let mut visited: HashSet<DirKey> = HashSet::new();
    let entries = walk_dir_sync(
        &path,
        0,
        depth,
        show_hidden,
        repo_root.as_deref(),
        git_statuses.as_ref(),
        &mut visited,
    )?;
    Ok(entries)
}

/// 遍历期间用于检测符号链接环的不透明目录标识。
#[derive(Clone, Eq, PartialEq, Hash)]
enum DirKey {
    #[cfg(unix)]
    Unix { dev: u64, ino: u64 },
    #[cfg(not(unix))]
    Canonical(String),
}

impl DirKey {
    // `path` 只在非 Unix 分支被消费——Unix 上 `MetadataExt` 直接提供了
    // dev/ino。在 Unix 上抑制该警告，这样我们不必重命名某一侧而破坏
    // 签名对称性。
    #[cfg_attr(unix, allow(unused_variables))]
    fn for_path(path: &Path, meta: &std::fs::Metadata) -> Self {
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            DirKey::Unix {
                dev: meta.dev(),
                ino: meta.ino(),
            }
        }
        #[cfg(not(unix))]
        {
            let _ = meta;
            DirKey::Canonical(
                std::fs::canonicalize(path)
                    .map(|p| p.to_string_lossy().into_owned())
                    .unwrap_or_else(|_| path.to_string_lossy().into_owned()),
            )
        }
    }
}

/// 将仓库的所有 Git 状态载入 HashMap 以便快速查询
fn load_git_status_map(repo_root: &Path) -> Option<std::collections::HashMap<String, GitStatus>> {
    let output = std::process::Command::new("git")
        .args(["-c", "core.quotepath=false", "status", "--porcelain", "-uall"])
        .current_dir(repo_root)
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut map = std::collections::HashMap::new();

    for line in stdout.lines() {
        if let Some((normalized, git_status)) = parse_git_status_line(line) {
            map.insert(normalized, git_status);
        }
    }

    Some(map)
}

/// 解析一行 `git status --porcelain` 输出，返回（规范化路径，状态）。
/// 重命名/复制行形如 `old -> new`：只有新路径对应盘上实际文件，
/// 必须以箭头后的部分为键，否则真实文件查不到自己的状态。
fn parse_git_status_line(line: &str) -> Option<(String, GitStatus)> {
    if line.len() < 3 {
        return None;
    }
    let status_chars = &line[..2];
    let file_path = line[3..].trim();
    let file_path = file_path
        .split_once(" -> ")
        .map(|(_, new)| new)
        .unwrap_or(file_path)
        .trim()
        .trim_matches('"');

    // 规范化路径为前向斜杠，以保证查询一致
    let normalized = file_path.replace('\\', "/");

    let git_status = match (status_chars.chars().next()?, status_chars.chars().nth(1)?) {
        ('?', '?') => GitStatus::Untracked,
        ('!', '!') => GitStatus::Ignored,
        ('u', _) | (_, 'u') | ('U', _) | (_, 'U') => GitStatus::Unmerged,
        ('A', _) => GitStatus::Added,
        ('M', _) => GitStatus::Modified,
        ('D', _) => GitStatus::Deleted,
        ('R', _) => GitStatus::Renamed,
        ('C', _) => GitStatus::Copied,
        (' ', 'M') => GitStatus::Modified,
        _ => GitStatus::Modified,
    };

    Some((normalized, git_status))
}

fn walk_dir_sync(
    path: &std::path::Path,
    current_depth: u32,
    max_depth: u32,
    show_hidden: bool,
    repo_root: Option<&Path>,
    git_statuses: Option<&std::collections::HashMap<String, GitStatus>>,
    visited: &mut HashSet<DirKey>,
) -> Result<Vec<FileEntry>> {
    // 先对目录本身做 stat，以便按 (dev, ino) 去重。
    // 若 `metadata()` 失败，说明路径已不存在；把错误抛给上层，
    // 让用户看到有意义的「权限被拒绝 / 未找到」提示，而不是空目录树。
    let self_meta = std::fs::metadata(path).map_err(Error::Io)?;
    let self_key = DirKey::for_path(path, &self_meta);
    if !visited.insert(self_key) {
        // 我们已通过另一条路径遍历过该目录（符号链接环）。
        // 返回空列表——父目录仍会显示该条目，只是不再递归进入。
        return Ok(Vec::new());
    }

    let mut entries = Vec::new();
    let read_dir = std::fs::read_dir(path).map_err(Error::Io)?;

    for item in read_dir {
        let item = item.map_err(Error::Io)?;
        let item_path = item.path();
        let metadata = item.metadata().map_err(Error::Io)?;
        let name = item.file_name().to_string_lossy().to_string();

        // 始终跳过常见的非 Markdown 目录
        if name == "node_modules" || name == "target" {
            continue;
        }
        // 除非启用了显示隐藏文件，否则跳过隐藏文件/目录
        if !show_hidden && name.starts_with('.') {
            continue;
        }

        let is_dir = metadata.is_dir();
        let mtime = metadata.modified().ok().and_then(|t| {
            t.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_secs_f64())
        });

        // 检查文件扩展名是否受支持
        if !is_dir && !is_markdown_file(&name) {
            continue;
        }

        let children = if is_dir && (max_depth == 0 || current_depth < max_depth) {
            walk_dir_sync(
                &item_path,
                current_depth + 1,
                max_depth,
                show_hidden,
                repo_root,
                git_statuses,
                visited,
            )?
        } else {
            Vec::new()
        };

        let file_git_status = if !is_dir {
            git_statuses.and_then(|statuses| {
                let relative = item_path.strip_prefix(repo_root.unwrap_or(&item_path)).ok()?;
                let normalized = relative.to_string_lossy().replace('\\', "/");
                statuses.get(&normalized).cloned()
            })
        } else {
            None
        };

        let git_status = if is_dir {
            compute_dir_status(&children)
        } else {
            file_git_status
        };

        entries.push(FileEntry {
            name,
            path: item_path.to_string_lossy().to_string(),
            is_dir,
            children,
            mtime,
            git_status,
        });
    }

    // 排序：目录优先，其余按名称排序
    entries.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(entries)
}

/// 检查文件是否为受支持的 Markdown 文件
fn is_markdown_file(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.ends_with(".md")
        || lower.ends_with(".markdown")
        || lower.ends_with(".txt")
        || lower.ends_with(".mdown")
        || lower.ends_with(".mdwn")
        || lower.ends_with(".mkd")
        || lower.ends_with(".mkdn")
}

/// 从给定路径向上逐级查找 .git 目录
fn find_git_root(path: &Path) -> Option<std::path::PathBuf> {
    let mut current = path.to_path_buf();
    loop {
        if current.join(".git").is_dir() {
            return Some(current);
        }
        if !current.pop() {
            break;
        }
    }
    None
}

/// 根据子条目计算目录的聚合 Git 状态
fn compute_dir_status(children: &[FileEntry]) -> Option<GitStatus> {
    for child in children {
        // 有变更的文件
        if !child.is_dir {
            if let Some(s) = &child.git_status {
                if matches!(s, GitStatus::Added | GitStatus::Modified | GitStatus::Deleted | GitStatus::Untracked) {
                    return Some(GitStatus::Modified);
                }
            }
        }
        // 有变更的子目录
        if child.is_dir && child.git_status.is_some() {
            return Some(GitStatus::Modified);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_git_status_line_plain() {
        let (path, status) = parse_git_status_line(" M src/main.rs").unwrap();
        assert_eq!(path, "src/main.rs");
        assert_eq!(status, GitStatus::Modified);
    }

    #[test]
    fn parse_git_status_line_rename_uses_new_path() {
        // 重命名/复制行的键必须是新路径，否则盘上的实际文件
        // 永远匹配不到自己的状态。
        let (path, status) = parse_git_status_line("R  old.md -> new.md").unwrap();
        assert_eq!(path, "new.md");
        assert_eq!(status, GitStatus::Renamed);

        let (path, status) = parse_git_status_line("C  a.md -> b.md").unwrap();
        assert_eq!(path, "b.md");
        assert_eq!(status, GitStatus::Copied);
    }

    #[test]
    fn parse_git_status_line_quoted_rename() {
        let (path, _) = parse_git_status_line("R  \"my old.md\" -> \"my new.md\"").unwrap();
        assert_eq!(path, "my new.md");
    }

    #[test]
    fn parse_git_status_line_rejects_short_lines() {
        assert!(parse_git_status_line("M").is_none());
        assert!(parse_git_status_line("").is_none());
    }
}
