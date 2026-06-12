//! Pane model: a single split-able editor area (with orientation
//! and child pointer). Composed into `WorkspaceState`.

use serde::{Deserialize, Serialize};

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
