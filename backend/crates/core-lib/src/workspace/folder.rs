use serde::{Deserialize, Serialize};
use std::path::PathBuf;
#[cfg(test)]
use super::pane::{Orientation, Pane};
#[cfg(test)]
use super::workspace_state::WorkspaceState;

/// 工作区中某个文件夹的信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderInfo {
    /// 该文件夹的唯一 ID
    pub id: String,
    /// 文件夹的绝对路径
    pub path: String,
    /// 显示名称
    pub name: String,
    /// 文件夹在树中是否已展开
    pub is_expanded: bool,
    /// 是否是主工作区文件夹
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

/// 简易 UUID 生成器（避免引入外部依赖）
fn uuid_simple() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{:x}-{:x}", duration.as_secs(), duration.subsec_nanos())
}

/// 表示包含多个文件夹的工作区
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    /// 工作区中的所有文件夹
    pub folders: Vec<FolderInfo>,
    /// 工作区名称
    pub name: String,
}

impl Workspace {
    pub fn new() -> Self {
        Self {
            folders: Vec::new(),
            name: "Untitled".to_string(),
        }
    }

    /// 向工作区添加文件夹
    pub fn add_folder(&mut self, path: String) -> Option<FolderInfo> {
        // 检查是否已存在
        if self.folders.iter().any(|f| f.path == path) {
            return None;
        }

        let is_primary = self.folders.is_empty();
        let folder = FolderInfo::new(path, is_primary);
        self.folders.push(folder.clone());
        Some(folder)
    }

    /// 从工作区移除文件夹
    pub fn remove_folder(&mut self, path: &str) -> bool {
        let len_before = self.folders.len();
        self.folders.retain(|f| f.path != path);

        if self.folders.is_empty() {
            // 所有文件夹都被移除
            true
        } else if len_before == self.folders.len() + 1 {
            // 若移除了主文件夹，则把第一个设为新的主文件夹
            if let Some(first) = self.folders.first_mut() {
                first.is_primary = true;
            }
            true
        } else {
            len_before != self.folders.len()
        }
    }

    /// 获取主文件夹
    pub fn primary_folder(&self) -> Option<&FolderInfo> {
        self.folders.iter().find(|f| f.is_primary)
    }

    /// 获取所有文件夹路径
    pub fn folder_paths(&self) -> Vec<String> {
        self.folders.iter().map(|f| f.path.clone()).collect()
    }

    /// 切换文件夹的展开状态
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
        assert_eq!(state.panes.len(), 3); // 根、child1、child2
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
