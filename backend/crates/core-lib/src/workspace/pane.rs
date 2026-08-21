//! 面板模型：单个可拆分（带方向与子面板指针）的编辑器区域，
//! 由 `WorkspaceState` 组合管理。

use serde::{Deserialize, Serialize};

/// 表示面板拆分的方向
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[derive(Default)]
pub enum Orientation {
    Horizontal,
    #[default]
    Vertical,
}


/// 表示工作区中的单个面板
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pane {
    /// 面板的唯一标识符
    pub id: String,
    /// 在此面板中打开的文档标识符列表
    pub doc_ids: Vec<String>,
    /// 此面板中当前活动的文档标识符
    pub active_doc_id: Option<String>,
    /// 拆分方向（若此面板被拆分）
    pub orientation: Option<Orientation>,
    /// 尺寸比例（0.0 到 1.0）
    pub size_ratio: f64,
    /// 此面板是否为叶子节点（没有子面板）
    pub is_leaf: bool,
    /// 子面板标识符（若此面板是一个拆分组）
    pub children: Option<[String; 2]>,
    /// 父面板标识符
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
