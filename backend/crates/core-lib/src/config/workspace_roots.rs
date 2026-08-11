//! Multi-root workspace helpers on [`AppConfig`].
//!
//! Extracted from `config.rs` (where this used to be the second
//! half of a 530-line monolith) so the per-root add/remove/
//! activate logic, the per-root expanded-dirs map, and the
//! legacy single-root compatibility shims live in one file.
//! The file tree's expanded-state belongs here because every
//! change to `workspace_roots` must also clear the matching
//! `expanded_dirs` entry — having both in one module makes
//! that invariant impossible to forget.
//!
//! All functions are `impl AppConfig` methods. They live in a
//! separate file purely for size; the caller doesn't need to
//! know the split exists.

use crate::workspace_root::{current_unix_secs, next_root_seq, WorkspaceRoot};
use crate::AppConfig;

impl AppConfig {
    /// Add a folder to the workspace, returning the new root.
    /// Refuses duplicates (same canonical path).
    pub fn add_workspace_root(&mut self, path: &str) -> Result<WorkspaceRoot, String> {
        if path.trim().is_empty() {
            return Err("path is empty".into());
        }
        // Canonicalize once for dedup. If the path doesn't exist we fall
        // back to the raw string so the user can pre-register a folder
        // they intend to create.
        //
        // We then hand the resolved string to `WorkspaceRoot::from_canonical_path`
        // (NOT `from_path`), so we don't re-stat every path component a
        // second time. The old behaviour called `canonicalize` twice per
        // add, which on a slow/stalled mount blocks long enough to
        // freeze the wry IPC thread — see the "open folder freeze" bug.
        let candidate_path = std::fs::canonicalize(path)
            .ok()
            .and_then(|p| p.to_str().map(|s| s.to_string()))
            .unwrap_or_else(|| path.to_string());
        if self
            .workspace_roots
            .iter()
            .any(|r| r.path == candidate_path)
        {
            return Err(format!("root already present: {candidate_path}"));
        }
        let mut root = WorkspaceRoot::from_canonical_path(
            &candidate_path,
            current_unix_secs(),
            next_root_seq(),
        );
        if root.name.is_empty() {
            root.name = candidate_path.clone();
        }
        let cloned = root.clone();
        let id = root.id.clone();
        self.workspace_roots.push(root);
        // If no root is active yet, activate this one.
        if self.active_workspace_root_id.is_none() {
            self.active_workspace_root_id = Some(id);
        }
        Ok(cloned)
    }

    /// Remove a root by id. If the active root is removed, the next
    /// remaining root (if any) becomes active.
    pub fn remove_workspace_root(&mut self, root_id: &str) -> bool {
        let before = self.workspace_roots.len();
        self.workspace_roots.retain(|r| r.id != root_id);
        let removed = self.workspace_roots.len() != before;
        if !removed {
            return false;
        }
        if self.active_workspace_root_id.as_deref() == Some(root_id) {
            self.active_workspace_root_id = self.workspace_roots.first().map(|r| r.id.clone());
        }
        // Also drop any expanded-dirs memory for the removed root.
        self.expanded_dirs.remove(root_id);
        true
    }

    /// Switch the active root. Returns false if the id isn't present.
    pub fn set_active_workspace_root(&mut self, root_id: &str) -> bool {
        if self.workspace_roots.iter().any(|r| r.id == root_id) {
            self.active_workspace_root_id = Some(root_id.to_string());
            true
        } else {
            false
        }
    }

    /// Get a reference to the currently active root, if any.
    pub fn get_active_workspace_root(&self) -> Option<&WorkspaceRoot> {
        let id = self.active_workspace_root_id.as_ref()?;
        self.workspace_roots.iter().find(|r| &r.id == id)
    }

    /// All configured roots (immutable view).
    pub fn workspace_roots(&self) -> &[WorkspaceRoot] {
        &self.workspace_roots
    }

    /// Mutable list of all roots (use sparingly — prefer the
    /// typed add/remove helpers so the active-id invariant is kept).
    pub fn workspace_roots_mut(&mut self) -> &mut Vec<WorkspaceRoot> {
        &mut self.workspace_roots
    }

    /// Per-root expanded directories (immutable view).
    pub fn get_expanded_dirs_for(&self, root_id: &str) -> &[String] {
        self.expanded_dirs
            .get(root_id)
            .map(|v| v.as_slice())
            .unwrap_or(&[])
    }

    /// Per-root expanded directories (mutable view).
    pub fn expanded_dirs_for_mut(&mut self, root_id: &str) -> &mut Vec<String> {
        self.expanded_dirs.entry(root_id.to_string()).or_default()
    }

    /// Convenience: read the expanded dirs for the currently active root.
    pub fn get_expanded_dirs(&self) -> &[String] {
        match &self.active_workspace_root_id {
            Some(id) => self.get_expanded_dirs_for(id),
            None => &[],
        }
    }

    /// **Deprecated** flat setter — routes the dirs to the active root
    /// so single-root IPC callers still work. Prefer
    /// [`set_expanded_dirs_for`](Self::set_expanded_dirs_for).
    #[deprecated(note = "use set_expanded_dirs_for(root_id, dirs) instead")]
    pub fn set_expanded_dirs(&mut self, dirs: Vec<String>) {
        if let Some(id) = self.active_workspace_root_id.clone() {
            self.set_expanded_dirs_for(&id, dirs);
        } else {
            // No active root — store under empty-string key as fallback
            // so data isn't silently dropped.
            self.expanded_dirs.insert(String::new(), dirs);
        }
    }

    /// Per-root expanded dirs setter.
    pub fn set_expanded_dirs_for(&mut self, root_id: &str, dirs: Vec<String>) {
        self.expanded_dirs.insert(root_id.to_string(), dirs);
    }

    /// Per-root expanded dirs add.
    pub fn add_expanded_dir(&mut self, path: String) {
        // Resolve the key first, then take a fresh mutable borrow so
        // the borrow checker is happy (we can't hold the immutable
        // active-id ref while also mutating expanded_dirs).
        let key = match &self.active_workspace_root_id {
            Some(id) => id.clone(),
            None => String::new(),
        };
        let bucket = self.expanded_dirs.entry(key).or_default();
        if !bucket.contains(&path) {
            bucket.push(path);
        }
    }

    /// Per-root expanded dirs remove.
    pub fn remove_expanded_dir(&mut self, path: &str) {
        // Iterate a snapshot of keys to avoid borrowing self twice.
        let keys: Vec<String> = self.expanded_dirs.keys().cloned().collect();
        for k in keys {
            if let Some(bucket) = self.expanded_dirs.get_mut(&k) {
                bucket.retain(|p| p != path);
            }
        }
    }
}