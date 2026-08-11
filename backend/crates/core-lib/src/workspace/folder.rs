use serde::{Deserialize, Serialize};
use std::path::PathBuf;
#[cfg(test)]
use super::pane::{Orientation, Pane};
#[cfg(test)]
use super::workspace_state::WorkspaceState;

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
