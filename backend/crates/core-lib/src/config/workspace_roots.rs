//! [`AppConfig`] 上的多根工作区辅助函数。
//!
//! 从 `config.rs`（过去这是 530 行单体文件的另一半）中拆分出来，
//! 让按根添加/移除/激活的逻辑、按根的展开目录映射，以及旧版
//! 单根兼容垫片集中在同一个文件里。文件树的展开状态也属于这里，
//! 因为对 `workspace_roots` 的任何修改都必须同时清理对应的
//! `expanded_dirs` 条目——把两者放在同一模块就不会忘记这个不变量。
//!
//! 所有函数都是 `impl AppConfig` 的方法。它们纯粹因文件大小而
//! 放在单独文件里；调用方无需知道拆分的存在。

use crate::workspace_root::{current_unix_secs, next_root_seq, WorkspaceRoot};
use crate::AppConfig;

impl AppConfig {
    /// 向工作区添加文件夹，返回新的根。拒绝重复（相同规范化路径）。
    pub fn add_workspace_root(&mut self, path: &str) -> Result<WorkspaceRoot, String> {
        if path.trim().is_empty() {
            return Err("path is empty".into());
        }
        // 为去重做一次规范化。路径不存在时回退到原始字符串，
        // 让用户能为打算创建的文件夹预先登记。
        //
        // 然后把解析结果交给 `WorkspaceRoot::from_canonical_path`
        // （而非 `from_path`），避免对每个路径分量再 stat 一次。
        // 旧行为每次添加会调用两次 `canonicalize`，在缓慢/停滞的
        // 挂载上足以长时间阻塞并冻结 wry IPC 线程——见「打开
        // 文件夹冻结」bug。
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
        // 若当前还没有活动根，则激活这个。
        if self.active_workspace_root_id.is_none() {
            self.active_workspace_root_id = Some(id);
        }
        Ok(cloned)
    }

    /// 按 id 移除根。若移除的是活动根，则下一个
    /// 剩余根（如果有）成为活动根。
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
        // 同时丢弃被移除根的展开目录记忆。
        self.expanded_dirs.remove(root_id);
        true
    }

    /// 切换活动根。id 不存在时返回 false。
    pub fn set_active_workspace_root(&mut self, root_id: &str) -> bool {
        if self.workspace_roots.iter().any(|r| r.id == root_id) {
            self.active_workspace_root_id = Some(root_id.to_string());
            true
        } else {
            false
        }
    }

    /// 获取当前活动根（如有）的引用。
    pub fn get_active_workspace_root(&self) -> Option<&WorkspaceRoot> {
        let id = self.active_workspace_root_id.as_ref()?;
        self.workspace_roots.iter().find(|r| &r.id == id)
    }

    /// 所有已配置的根（只读视图）。
    pub fn workspace_roots(&self) -> &[WorkspaceRoot] {
        &self.workspace_roots
    }

    /// 所有根的可变列表（谨慎使用——优先用带类型的 add/remove
    /// 辅助函数，以保持活动 id 的不变量）。
    pub fn workspace_roots_mut(&mut self) -> &mut Vec<WorkspaceRoot> {
        &mut self.workspace_roots
    }

    /// 按根的展开目录（只读视图）。
    pub fn get_expanded_dirs_for(&self, root_id: &str) -> &[String] {
        self.expanded_dirs
            .get(root_id)
            .map(|v| v.as_slice())
            .unwrap_or(&[])
    }

    /// 按根的展开目录（可变视图）。
    pub fn expanded_dirs_for_mut(&mut self, root_id: &str) -> &mut Vec<String> {
        self.expanded_dirs.entry(root_id.to_string()).or_default()
    }

    /// 便捷方法：读取当前活动根的展开目录。
    ///
    /// 没有活动根时读**空字符串键**下的那份——扁平的 deprecated
    /// setter 在没有活动根时正是写到这个键（见 [`set_expanded_dirs`]）。
    /// 两者必须对称，否则写进去的展开目录永远读不出来。
    pub fn get_expanded_dirs(&self) -> &[String] {
        match &self.active_workspace_root_id {
            Some(id) => self.get_expanded_dirs_for(id),
            None => self.get_expanded_dirs_for(""),
        }
    }

    /// **已弃用**的扁平 setter——把目录路由到活动根，
    /// 让单根 IPC 调用仍然可用。优先使用
    /// [`set_expanded_dirs_for`](Self::set_expanded_dirs_for)。
    #[deprecated(note = "use set_expanded_dirs_for(root_id, dirs) instead")]
    pub fn set_expanded_dirs(&mut self, dirs: Vec<String>) {
        if let Some(id) = self.active_workspace_root_id.clone() {
            self.set_expanded_dirs_for(&id, dirs);
        } else {
            // 没有活动根——以空字符串键存储作为回退，
            // 避免数据被静默丢弃。
            self.expanded_dirs.insert(String::new(), dirs);
        }
    }

    /// 按根设置展开目录。
    pub fn set_expanded_dirs_for(&mut self, root_id: &str, dirs: Vec<String>) {
        self.expanded_dirs.insert(root_id.to_string(), dirs);
    }

    /// 按根添加展开目录。
    pub fn add_expanded_dir(&mut self, path: String) {
        // 先解析键，再取新的可变借用，让借用检查器满意
        // （不能在持有不可变的活动 id 引用时同时修改 expanded_dirs）。
        let key = match &self.active_workspace_root_id {
            Some(id) => id.clone(),
            None => String::new(),
        };
        let bucket = self.expanded_dirs.entry(key).or_default();
        if !bucket.contains(&path) {
            bucket.push(path);
        }
    }

    /// 按路径移除展开目录。
    pub fn remove_expanded_dir(&mut self, path: &str) {
        // 遍历键的快照，避免同时两次借用 self。
        let keys: Vec<String> = self.expanded_dirs.keys().cloned().collect();
        for k in keys {
            if let Some(bucket) = self.expanded_dirs.get_mut(&k) {
                bucket.retain(|p| p != path);
            }
        }
    }
}