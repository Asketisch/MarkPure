use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookmarkStore {
    pub bookmarks: Vec<Bookmark>,
}

impl Default for BookmarkStore {
    fn default() -> Self {
        Self {
            bookmarks: Vec::new(),
        }
    }
}

/// Get the bookmarks file path
pub fn bookmarks_path() -> PathBuf {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("markpure");
    fs::create_dir_all(&config_dir).ok();
    config_dir.join("bookmarks.json")
}

/// Load all bookmarks
pub fn load_bookmarks() -> Result<Vec<Bookmark>, Error> {
    let path = bookmarks_path();
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&path)?;
    let store: BookmarkStore = serde_json::from_str(&content)?;
    Ok(store.bookmarks)
}

/// Save all bookmarks
pub fn save_bookmarks(bookmarks: &[Bookmark]) -> Result<(), Error> {
    let path = bookmarks_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let store = BookmarkStore {
        bookmarks: bookmarks.to_vec(),
    };
    let content = serde_json::to_string_pretty(&store)?;
    fs::write(&path, content)?;
    Ok(())
}

/// Generate a new bookmark ID
pub fn generate_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let rand_suffix = (now as u64).wrapping_mul(2654435761).rotate_left(17);
    format!("{:x}{:08x}", now, rand_suffix & 0xFFFFFFFF)
}

/// Get a bookmark by ID
pub fn get_bookmark(id: &str) -> Result<Bookmark, Error> {
    let bookmarks = load_bookmarks()?;
    bookmarks
        .iter()
        .find(|b| b.id == id)
        .cloned()
        .ok_or(Error::NotFound)
}

/// Add a new bookmark
pub fn add_bookmark(path: &str, title: &str, tags: Vec<String>) -> Result<Bookmark, Error> {
    let mut bookmarks = load_bookmarks()?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();

    let bookmark = Bookmark {
        id: generate_id(),
        path: path.to_string(),
        title: title.to_string(),
        description: String::new(),
        tags,
        created_at: now,
        updated_at: now,
    };

    bookmarks.push(bookmark.clone());
    save_bookmarks(&bookmarks)?;
    Ok(bookmark)
}

/// Update a bookmark
pub fn update_bookmark(
    id: &str,
    title: Option<&str>,
    description: Option<&str>,
    tags: Option<Vec<String>>,
) -> Result<Bookmark, Error> {
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
    bookmark.updated_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();

    let updated = bookmark.clone();
    save_bookmarks(&bookmarks)?;
    Ok(updated)
}

/// Remove a bookmark
pub fn remove_bookmark(id: &str) -> Result<bool, Error> {
    let mut bookmarks = load_bookmarks()?;
    let initial_len = bookmarks.len();
    bookmarks.retain(|b| b.id != id);

    if bookmarks.len() == initial_len {
        return Err(Error::NotFound);
    }

    save_bookmarks(&bookmarks)?;
    Ok(true)
}

/// Search bookmarks by query (matches title, path, or tags)
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

/// Get bookmarks by tag
pub fn get_bookmarks_by_tag(tag: &str) -> Result<Vec<Bookmark>, Error> {
    let bookmarks = load_bookmarks()?;
    let tag_lower = tag.to_lowercase();

    let results: Vec<Bookmark> = bookmarks
        .into_iter()
        .filter(|b| b.tags.iter().any(|t| t.to_lowercase() == tag_lower))
        .collect();

    Ok(results)
}

/// Get all unique tags
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
}
