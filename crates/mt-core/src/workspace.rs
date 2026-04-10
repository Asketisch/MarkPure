//! Workspace state management for panes and folders
//!
//! Provides functionality to manage editor panes (splits) and multiple folder workspaces.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

/// Represents the orientation of a pane split
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Orientation {
    Horizontal,
    Vertical,
}

impl Default for Orientation {
    fn default() -> Self {
        Orientation::Vertical
    }
}

/// Represents a single pane in the workspace
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pane {
    /// Unique identifier for the pane
    pub id: String,
    /// Document IDs open in this pane
    pub doc_ids: Vec<String>,
    /// Active document ID in this pane
    pub active_doc_id: Option<String>,
    /// Split orientation (if this pane is split)
    pub orientation: Option<Orientation>,
    /// Size ratio (0.0 to 1.0)
    pub size_ratio: f64,
    /// Whether this pane is a leaf (no children)
    pub is_leaf: bool,
    /// Child pane IDs (if this pane is a split group)
    pub children: Option<[String; 2]>,
    /// Parent pane ID
    pub parent_id: Option<String>,
}

impl Pane {
    pub fn new_leaf(id: String) -> Self {
        Self {
            id,
            doc_ids: Vec::new(),
            active_doc_id: None,
            orientation: None,
            size_ratio: 0.5,
            is_leaf: true,
            children: None,
            parent_id: None,
        }
    }

    pub fn new_split(id1: String, id2: String, orientation: Orientation) -> (Self, Self) {
        let pane1 = Self {
            id: id1,
            doc_ids: Vec::new(),
            active_doc_id: None,
            orientation: Some(orientation),
            size_ratio: 0.5,
            is_leaf: true,
            children: None,
            parent_id: None,
        };
        let pane2 = Self {
            id: id2,
            doc_ids: Vec::new(),
            active_doc_id: None,
            orientation: Some(orientation),
            size_ratio: 0.5,
            is_leaf: true,
            children: None,
            parent_id: None,
        };
        (pane1, pane2)
    }
}

/// Represents the complete workspace state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceState {
    /// All panes in the workspace
    pub panes: HashMap<String, Pane>,
    /// Root pane ID (the main container)
    pub root_pane_id: String,
    /// Active pane ID
    pub active_pane_id: String,
    /// Active document ID (across all panes)
    pub active_doc_id: Option<String>,
}

impl WorkspaceState {
    pub fn new() -> Self {
        let root_id = "pane-0".to_string();
        let mut panes = HashMap::new();
        panes.insert(root_id.clone(), Pane::new_leaf(root_id.clone()));

        Self {
            panes,
            root_pane_id: root_id.clone(),
            active_pane_id: root_id,
            active_doc_id: None,
        }
    }

    /// Split a pane and return the new pane ID
    pub fn split_pane(&mut self, pane_id: &str, orientation: Orientation) -> Option<String> {
        let parent = self.panes.get(pane_id)?.clone();
        if !parent.is_leaf {
            return None; // Can only split leaf panes
        }

        let current_len = self.panes.len();
        let new_id = format!("pane-{}", current_len);
        let parent_id = format!("pane-{}", current_len + 1);

        // Create two child panes
        let child1_id = pane_id.to_string();
        let child2_id = new_id.clone();

        // Create child1 (the original pane with updated parent)
        let mut child1 = parent.clone();
        child1.is_leaf = true;
        child1.parent_id = Some(parent_id.clone());

        // Create child2 (new leaf pane)
        let mut child2 = Pane::new_leaf(new_id.clone());
        child2.parent_id = Some(parent_id.clone());
        child2.orientation = Some(orientation);

        // Create parent as split container
        let mut new_parent = Pane::new_leaf(parent_id.clone());
        new_parent.is_leaf = false;
        new_parent.orientation = Some(orientation);
        new_parent.children = Some([child1_id.clone(), child2_id.clone()]);
        new_parent.size_ratio = 0.5;

        // Update existing pane to be child1
        if let Some(p) = self.panes.get_mut(pane_id) {
            *p = child1;
        }

        // Add new panes
        self.panes.insert(parent_id, new_parent);
        self.panes.insert(child2_id.clone(), child2);

        Some(child2_id)
    }

    /// Close a pane and return its document to parent or workspace
    pub fn close_pane(&mut self, pane_id: &str) -> Option<Vec<String>> {
        if pane_id == self.root_pane_id {
            return None; // Cannot close root pane
        }

        let pane = self.panes.get(pane_id)?.clone();
        let parent_id = pane.parent_id.clone()?;
        let _grandparent_id = pane.parent_id.clone();

        // Get parent data first
        let parent = self.panes.get(&parent_id)?.clone();
        let [left, right] = parent.children.as_ref()?.clone();
        let sibling = if left == pane_id { &right } else { &left };

        // Get sibling data
        let sibling_pane = self.panes.get(sibling)?.clone();
        let sibling_id = sibling.clone();

        // Get grandparent info if exists
        let grandparent = parent.parent_id.as_ref().and_then(|gp_id| {
            self.panes.get(gp_id).cloned()
        });
        let _is_parent_root = parent.parent_id.is_none();

        // Update grandparent's children if exists
        if let Some(gp) = grandparent.as_ref() {
            if let Some([a, b]) = &gp.children {
                let new_children = if a == &parent_id {
                    [sibling_id.clone(), b.clone()]
                } else {
                    [a.clone(), sibling_id.clone()]
                };
                if let Some(gp_mut) = self.panes.get_mut(&gp.id) {
                    gp_mut.children = Some(new_children);
                }
            }
        } else {
            // Parent was root, sibling becomes new root
            self.root_pane_id = sibling_id.clone();
        }

        // Remove parent and sibling
        self.panes.remove(&parent_id);
        self.panes.remove(&sibling_id);

        // Create new sibling (promoted)
        let mut new_sibling = sibling_pane.clone();
        new_sibling.parent_id = parent.parent_id.clone();
        new_sibling.orientation = parent.orientation;
        new_sibling.is_leaf = true;
        self.panes.insert(sibling_id.clone(), new_sibling);

        // Return documents that were in this pane
        Some(pane.doc_ids)
    }

    /// Move a document from one pane to another
    pub fn move_doc_to_pane(&mut self, doc_id: &str, from_pane_id: &str, to_pane_id: &str) -> bool {
        // Remove from source pane
        if let Some(from_pane) = self.panes.get_mut(from_pane_id) {
            from_pane.doc_ids.retain(|id| id != doc_id);
            if from_pane.active_doc_id.as_deref() == Some(doc_id) {
                from_pane.active_doc_id = from_pane.doc_ids.first().cloned();
            }
        } else {
            return false;
        }

        // Add to target pane
        if let Some(to_pane) = self.panes.get_mut(to_pane_id) {
            if !to_pane.doc_ids.contains(&doc_id.to_string()) {
                to_pane.doc_ids.push(doc_id.to_string());
            }
            to_pane.active_doc_id = Some(doc_id.to_string());
            true
        } else {
            false
        }
    }

    /// Get the active pane
    pub fn active_pane(&self) -> Option<&Pane> {
        self.panes.get(&self.active_pane_id)
    }

    /// Set active pane
    pub fn set_active_pane(&mut self, pane_id: &str) -> bool {
        if self.panes.contains_key(pane_id) {
            self.active_pane_id = pane_id.to_string();
            true
        } else {
            false
        }
    }

    /// Add document to active pane
    pub fn add_doc_to_active(&mut self, doc_id: String) {
        if let Some(pane) = self.panes.get_mut(&self.active_pane_id) {
            if !pane.doc_ids.contains(&doc_id) {
                pane.doc_ids.push(doc_id.clone());
            }
            pane.active_doc_id = Some(doc_id);
        }
    }
}

impl Default for WorkspaceState {
    fn default() -> Self {
        Self::new()
    }
}

/// Information about a folder in the workspace
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderInfo {
    /// Unique ID for this folder
    pub id: String,
    /// Absolute path to the folder
    pub path: String,
    /// Display name
    pub name: String,
    /// Whether the folder is expanded in the tree
    pub is_expanded: bool,
    /// Whether this is the primary workspace folder
    pub is_primary: bool,
}

impl FolderInfo {
    pub fn new(path: String, is_primary: bool) -> Self {
        let path_buf = PathBuf::from(&path);
        let name = path_buf
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(&path)
            .to_string();

        Self {
            id: format!("folder-{}", uuid_simple()),
            path,
            name,
            is_expanded: true,
            is_primary,
        }
    }
}

/// Simple UUID generator (for use without external dependencies)
fn uuid_simple() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{:x}-{:x}", duration.as_secs(), duration.subsec_nanos())
}

/// Represents the workspace with multiple folders
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    /// All folders in the workspace
    pub folders: Vec<FolderInfo>,
    /// Workspace name
    pub name: String,
}

impl Workspace {
    pub fn new() -> Self {
        Self {
            folders: Vec::new(),
            name: "Untitled".to_string(),
        }
    }

    /// Add a folder to the workspace
    pub fn add_folder(&mut self, path: String) -> Option<FolderInfo> {
        // Check if already exists
        if self.folders.iter().any(|f| f.path == path) {
            return None;
        }

        let is_primary = self.folders.is_empty();
        let folder = FolderInfo::new(path, is_primary);
        self.folders.push(folder.clone());
        Some(folder)
    }

    /// Remove a folder from the workspace
    pub fn remove_folder(&mut self, path: &str) -> bool {
        let len_before = self.folders.len();
        self.folders.retain(|f| f.path != path);

        if self.folders.is_empty() {
            // All folders removed
            true
        } else if len_before == self.folders.len() + 1 {
            // If we removed the primary, make first one primary
            if let Some(first) = self.folders.first_mut() {
                first.is_primary = true;
            }
            true
        } else {
            len_before != self.folders.len()
        }
    }

    /// Get the primary folder
    pub fn primary_folder(&self) -> Option<&FolderInfo> {
        self.folders.iter().find(|f| f.is_primary)
    }

    /// Get all folder paths
    pub fn folder_paths(&self) -> Vec<String> {
        self.folders.iter().map(|f| f.path.clone()).collect()
    }

    /// Toggle folder expanded state
    pub fn toggle_folder(&mut self, path: &str) -> bool {
        if let Some(folder) = self.folders.iter_mut().find(|f| f.path == path) {
            folder.is_expanded = !folder.is_expanded;
            true
        } else {
            false
        }
    }
}

impl Default for Workspace {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pane_creation() {
        let pane = Pane::new_leaf("pane-1".to_string());
        assert_eq!(pane.id, "pane-1");
        assert!(pane.is_leaf);
        assert!(pane.children.is_none());
    }

    #[test]
    fn test_workspace_state_split() {
        let mut state = WorkspaceState::new();
        let root_id = state.root_pane_id.clone();
        let new_pane_id = state.split_pane(&root_id, Orientation::Horizontal);
        assert!(new_pane_id.is_some());
        assert_eq!(state.panes.len(), 3); // root, child1, child2
    }

    #[test]
    fn test_workspace_add_folder() {
        let mut workspace = Workspace::new();
        let folder = workspace.add_folder("/test/path".to_string());
        assert!(folder.is_some());
        assert_eq!(workspace.folders.len(), 1);
        assert!(workspace.primary_folder().is_some());
    }

    #[test]
    fn test_workspace_remove_folder() {
        let mut workspace = Workspace::new();
        workspace.add_folder("/test/path1".to_string());
        workspace.add_folder("/test/path2".to_string());
        assert_eq!(workspace.folders.len(), 2);

        workspace.remove_folder("/test/path1");
        assert_eq!(workspace.folders.len(), 1);
    }
}
