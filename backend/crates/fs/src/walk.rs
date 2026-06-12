use mt_core::error::{Error, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;

/// Git file status
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

/// File entry in the directory tree
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

/// Walk a directory and return a tree structure of files
/// depth: maximum depth to recurse (0 = unlimited)
pub async fn walk_directory(path: &Path, depth: u32, show_hidden: bool) -> Result<Vec<FileEntry>> {
    let path = path.to_path_buf();
    let repo_root = find_git_root(&path);
    let git_statuses = if let Some(ref root) = repo_root {
        load_git_status_map(root)
    } else {
        None
    };
    // Guard against symlink cycles: a directory can appear via multiple
    // paths (e.g. `dir/loop/loop/...`). Without a visited-set the
    // recursion below would either blow the stack or — on a "soft" cycle
    // bounded only by `max_depth` — silently truncate the tree. We track
    // each visited directory by its `(dev, ino)` on Unix (zero syscall
    // beyond the `metadata()` we already do per entry) and by its
    // canonical path elsewhere.
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

/// Opaque directory identity used to detect symlink cycles during a walk.
#[derive(Clone, Eq, PartialEq, Hash)]
enum DirKey {
    #[cfg(unix)]
    Unix { dev: u64, ino: u64 },
    #[cfg(not(unix))]
    Canonical(String),
}

impl DirKey {
    fn for_path(path: &Path, meta: &std::fs::Metadata) -> Self {
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            return DirKey::Unix {
                dev: meta.dev(),
                ino: meta.ino(),
            };
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

/// Load all git statuses for a repo into a HashMap for fast lookup
fn load_git_status_map(repo_root: &Path) -> Option<std::collections::HashMap<String, GitStatus>> {
    let output = std::process::Command::new("git")
        .args(["status", "--porcelain", "-uall"])
        .current_dir(repo_root)
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut map = std::collections::HashMap::new();

    for line in stdout.lines() {
        if line.len() < 3 {
            continue;
        }
        let status_chars = &line[..2];
        let file_path = line[3..].trim().trim_start_matches('"').trim_end_matches('"');

        // Normalize path to use forward slashes for consistent lookup
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

        map.insert(normalized, git_status);
    }

    Some(map)
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
    // Stat the directory itself first so we can dedupe by (dev, ino).
    // If `metadata()` fails the path is already gone; surface the error
    // so the user sees a meaningful "permission denied / not found"
    // rather than an empty tree.
    let self_meta = std::fs::metadata(path).map_err(Error::Io)?;
    let self_key = DirKey::for_path(path, &self_meta);
    if !visited.insert(self_key) {
        // We've already walked this directory via another path
        // (symlink cycle). Return an empty list — the parent still
        // shows the entry, we just don't recurse into it again.
        return Ok(Vec::new());
    }

    let mut entries = Vec::new();
    let read_dir = std::fs::read_dir(path).map_err(Error::Io)?;

    for item in read_dir {
        let item = item.map_err(Error::Io)?;
        let item_path = item.path();
        let metadata = item.metadata().map_err(Error::Io)?;
        let name = item.file_name().to_string_lossy().to_string();

        // Skip common non-markdown directories always
        if name == "node_modules" || name == "target" {
            continue;
        }
        // Skip hidden files/directories unless show_hidden is enabled
        if !show_hidden && name.starts_with('.') {
            continue;
        }

        let is_dir = metadata.is_dir();
        let mtime = metadata.modified().ok().and_then(|t| {
            t.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_secs_f64())
        });

        // Check if file extension is supported
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

    // Sort: directories first, then by name
    entries.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(entries)
}

/// Check if a file is a supported markdown file
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

/// Find the .git directory by walking up from the given path
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

/// Compute aggregated git status for a directory based on its children
fn compute_dir_status(children: &[FileEntry]) -> Option<GitStatus> {
    for child in children {
        // File with change
        if !child.is_dir && child.git_status.is_some() {
            let s = child.git_status.as_ref().unwrap();
            if matches!(s, GitStatus::Added | GitStatus::Modified | GitStatus::Deleted | GitStatus::Untracked) {
                return Some(GitStatus::Modified);
            }
        }
        // Subdirectory with change
        if child.is_dir && child.git_status.is_some() {
            return Some(GitStatus::Modified);
        }
    }
    None
}
