//! WorkspaceRoot — a single folder in a multi-root workspace (P2-4).
//!
//! Each root is a canonicalized absolute path with a stable UUID. Roots are
//! the source of truth for "which folders are open"; the older
//! `Workspace { folders: Vec<FolderInfo> }` model derives its view from this.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// A single workspace root folder (multi-root workspace member).
///
/// Distinct from `FolderInfo` (which carries per-pane derived state such as
/// `is_expanded`): `WorkspaceRoot` is the persisted, canonical record.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspaceRoot {
    /// Stable UUID; survives restarts. Used as the `workspace_id` on file
    /// watcher events and as the discriminator in `TabState.workspace_root_id`.
    pub id: String,
    /// Absolute, canonicalized path. Never empty.
    pub path: String,
    /// Display name (derived from `path` basename at creation time, but
    /// renameable later).
    pub name: String,
    /// Unix-epoch seconds at which this root was added. Used for stable
    /// sort order in UI.
    #[serde(default)]
    pub added_at: u64,
}

impl WorkspaceRoot {
    /// Build a new `WorkspaceRoot` from a raw user-supplied path.
    ///
    /// Performs canonicalization (best-effort: if the path doesn't exist yet
    /// we keep the original to avoid losing user intent), generates a
    /// stable-looking UUID from the current time + a counter, and derives
    /// the display name from the path's basename.
    pub fn from_path(path: &str) -> Self {
        Self::from_path_with_time(path, current_unix_secs(), next_root_seq())
    }

    /// Test-friendly constructor: caller supplies `added_at` and a sequence
    /// number that gets mixed into the id so two roots added in the same
    /// second still get distinct ids.
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

        let id = format!("root-{:x}-{:x}", added_at, seq);

        Self {
            id,
            path: canonical,
            name,
            added_at,
        }
    }

    /// Build a [`WorkspaceRoot`] from a path that the caller has already
    /// canonicalized. Use this from `AppConfig::add_workspace_root` where
    /// we resolve the path once for dedup and then want to skip a second
    /// `std::fs::canonicalize` round-trip (which can block for tens of
    /// seconds on a stalled network mount and freeze the wry IPC thread).
    ///
    /// The path is still treated as best-effort: it is never empty and the
    /// display name falls back to the full path if no basename exists.
    pub fn from_canonical_path(canonical: &str, added_at: u64, seq: u64) -> Self {
        debug_assert!(!canonical.is_empty(), "from_canonical_path requires non-empty path");
        let name = PathBuf::from(canonical)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(canonical)
            .to_string();
        let id = format!("root-{:x}-{:x}", added_at, seq);
        Self {
            id,
            path: canonical.to_string(),
            name,
            added_at,
        }
    }

    /// Returns true if the directory still exists on disk. Used by the
    /// startup "missing root" recovery flow (see `cmd_list_workspace_roots`).
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
        // Path that almost certainly does not exist.
        let r = WorkspaceRoot::from_path_with_time(
            "/this/path/should/not/exist/zzz_xyz",
            200,
            2,
        );
        // We don't canonicalize nonexistent paths, so the original is kept.
        assert_eq!(r.path, "/this/path/should/not/exist/zzz_xyz");
    }

    #[test]
    fn distinct_seq_yields_distinct_ids() {
        let a = WorkspaceRoot::from_path_with_time("/tmp/a", 1, 1);
        let b = WorkspaceRoot::from_path_with_time("/tmp/b", 1, 2);
        assert_ne!(a.id, b.id);
    }

    /// Phase 5: `exists()` returns true for the current
    /// process's temp dir (which always exists) and false
    /// for a path that almost certainly doesn't.
    #[test]
    fn exists_reports_actual_disk_state() {
        let real = WorkspaceRoot::from_path("/tmp");
        assert!(real.exists(), "/tmp should exist on every unix");
        let bogus = WorkspaceRoot::from_path(
            "/markpure-no-such-path-zzz-deadbeef",
        );
        assert!(!bogus.exists(), "missing path should report false");
    }

    /// `from_canonical_path` must NOT touch the filesystem. We
    /// hand it a path that definitely doesn't exist; the
    /// constructor must accept it verbatim and produce a root
    /// whose `path` field matches the input byte-for-byte.
    #[test]
    fn from_canonical_path_does_not_resolve() {
        let bogus = "/this/path/does/not/exist/abc_xyz";
        let r = WorkspaceRoot::from_canonical_path(bogus, 300, 4);
        assert_eq!(r.path, bogus);
        assert_eq!(r.name, "abc_xyz");
        assert_eq!(r.added_at, 300);
        assert!(r.id.starts_with("root-"));
    }

    /// `from_canonical_path` falls back to the full path as
    /// the display name when the basename is empty (e.g. the
    /// path is just "/"). This matches the existing fallback
    /// in `from_path_with_time`.
    #[test]
    fn from_canonical_path_falls_back_to_full_path_for_name() {
        // "/" has an empty `file_name()` on Unix; the
        // constructor should fall back to the full path.
        let r = WorkspaceRoot::from_canonical_path("/", 1, 1);
        assert_eq!(r.path, "/");
        assert_eq!(r.name, "/");
    }
}
