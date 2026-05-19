use mt_core::error::{Error, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// File entry in the directory tree
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    #[serde(default)]
    pub children: Vec<FileEntry>,
    pub mtime: Option<f64>,
}

/// Walk a directory and return a tree structure of files
/// depth: maximum depth to recurse (0 = unlimited)
pub async fn walk_directory(path: &Path, depth: u32, show_hidden: bool) -> Result<Vec<FileEntry>> {
    let path = path.to_path_buf();
    let entries = walk_dir_sync(&path, 0, depth, show_hidden)?;
    Ok(entries)
}

fn walk_dir_sync(path: &std::path::Path, current_depth: u32, max_depth: u32, show_hidden: bool) -> Result<Vec<FileEntry>> {
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
            walk_dir_sync(&item_path, current_depth + 1, max_depth, show_hidden)?
        } else {
            Vec::new()
        };

        entries.push(FileEntry {
            name,
            path: item_path.to_string_lossy().to_string(),
            is_dir,
            children,
            mtime,
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
