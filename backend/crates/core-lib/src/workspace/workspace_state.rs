use super::pane::{Orientation, Pane};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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
