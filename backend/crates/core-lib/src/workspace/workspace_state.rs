use super::pane::{Orientation, Pane};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 表示完整的工作区状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceState {
    /// 工作区中的所有面板
    pub panes: HashMap<String, Pane>,
    /// 根面板 ID（主容器）
    pub root_pane_id: String,
    /// 活动面板 ID
    pub active_pane_id: String,
    /// 活动文档 ID（跨所有面板）
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

    /// 取现有 `pane-N` 数字后缀的最大值加一，生成不会与存活面板
    /// 碰撞的 id。`close_pane` 会收缩 `panes`，基于 `len()` 的
    /// `pane-{len}` 会复用仍存在的 id，静默覆盖面板并损坏树。
    fn next_pane_number(&self) -> usize {
        self.panes
            .keys()
            .filter_map(|k| k.strip_prefix("pane-").and_then(|n| n.parse::<usize>().ok()))
            .max()
            .unwrap_or(0)
            + 1
    }

    /// 拆分面板并返回新面板 ID
    ///
    /// 树手术：新拆分容器**替换**被拆面板在原父级 children 中的
    /// 位置（容器继承原面板的 `parent_id`）；被拆面板若是结构根，
    /// 容器成为新根。这样嵌套拆分不会产生第二个无父面板，
    /// 父级的 children 指针也不会指向已被容器取代的旧面板。
    pub fn split_pane(&mut self, pane_id: &str, orientation: Orientation) -> Option<String> {
        let leaf = self.panes.get(pane_id)?;
        if !leaf.is_leaf {
            return None; // 只能拆分叶子面板
        }

        let next = self.next_pane_number();
        let new_id = format!("pane-{}", next);
        let container_id = format!("pane-{}", next + 1);
        let old_parent_id = leaf.parent_id.clone();

        // child1：原面板内容不变，父级指向新容器。
        let mut child1 = leaf.clone();
        child1.parent_id = Some(container_id.clone());

        // child2：新叶子面板。
        let mut child2 = Pane::new_leaf(new_id.clone());
        child2.parent_id = Some(container_id.clone());

        // 拆分容器：承载 [child1, child2]。
        let mut container = Pane::new_leaf(container_id.clone());
        container.is_leaf = false;
        container.orientation = Some(orientation);
        container.parent_id = old_parent_id.clone();
        container.children = Some([pane_id.to_string(), new_id.clone()]);
        container.size_ratio = 0.5;

        self.panes.insert(pane_id.to_string(), child1);
        self.panes.insert(new_id.clone(), child2);
        self.panes.insert(container_id.clone(), container);

        // 若原面板嵌在某个容器里，把该容器的 children 中
        // 指向原面板的槽位改指新容器；否则新容器成为根。
        if let Some(gp_id) = old_parent_id {
            if let Some(gp) = self.panes.get_mut(&gp_id) {
                if let Some(children) = gp.children.as_mut() {
                    if let Some(slot) = children.iter_mut().find(|c| *c == pane_id) {
                        *slot = container_id;
                    }
                }
            }
        } else {
            self.root_pane_id = container_id;
        }

        Some(new_id)
    }

    /// 关闭面板并把它承载的文档交还父级或工作区
    pub fn close_pane(&mut self, pane_id: &str) -> Option<Vec<String>> {
        if pane_id == self.root_pane_id {
            return None; // 不能关闭根面板
        }

        let pane = self.panes.get(pane_id)?.clone();
        // 无父面板 = 结构根（split_pane 保证根只有一个）。
        let parent_id = pane.parent_id.clone()?;

        // 先获取父级数据
        let parent = self.panes.get(&parent_id)?.clone();
        let [left, right] = parent.children.as_ref()?.clone();
        let sibling = if left == pane_id { &right } else { &left };

        // 获取兄弟面板数据
        let sibling_pane = self.panes.get(sibling)?.clone();
        let sibling_id = sibling.clone();

        // 若有祖父级则获取其信息
        let grandparent = parent.parent_id.as_ref().and_then(|gp_id| {
            self.panes.get(gp_id).cloned()
        });

        // 若有祖父级则更新其子面板
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
            // 父级是根，兄弟面板成为新根
            self.root_pane_id = sibling_id.clone();
        }

        // 移除父级与兄弟面板
        self.panes.remove(&parent_id);
        self.panes.remove(&sibling_id);

        // 创建晋升后的新兄弟面板。`is_leaf` / `children` 保持原样——
        // 兄弟可能本身是个拆分容器，强制成叶子会丢掉它的子面板。
        let mut new_sibling = sibling_pane.clone();
        new_sibling.parent_id = parent.parent_id.clone();
        new_sibling.orientation = parent.orientation;
        self.panes.insert(sibling_id.clone(), new_sibling);

        // 返回原面板中的文档
        Some(pane.doc_ids)
    }

    /// 把文档从一个面板移到另一个
    pub fn move_doc_to_pane(&mut self, doc_id: &str, from_pane_id: &str, to_pane_id: &str) -> bool {
        // 从源面板移除
        if let Some(from_pane) = self.panes.get_mut(from_pane_id) {
            from_pane.doc_ids.retain(|id| id != doc_id);
            if from_pane.active_doc_id.as_deref() == Some(doc_id) {
                from_pane.active_doc_id = from_pane.doc_ids.first().cloned();
            }
        } else {
            return false;
        }

        // 添加到目标面板
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

    /// 获取活动面板
    pub fn active_pane(&self) -> Option<&Pane> {
        self.panes.get(&self.active_pane_id)
    }

    /// 设置活动面板
    pub fn set_active_pane(&mut self, pane_id: &str) -> bool {
        if self.panes.contains_key(pane_id) {
            self.active_pane_id = pane_id.to_string();
            true
        } else {
            false
        }
    }

    /// 向活动面板添加文档
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

#[cfg(test)]
mod tests {
    use super::*;

    /// 统计无父面板（结构根）的个数——合法的树有且仅有一个。
    fn rootless_count(ws: &WorkspaceState) -> usize {
        ws.panes.values().filter(|p| p.parent_id.is_none()).count()
    }

    /// close_pane 收缩 panes 之后再 split，id 不得复用存活面板的
    /// id（旧的 `pane-{len}` 会静默覆盖仍存在的节点）。
    #[test]
    fn split_ids_do_not_collide_after_close() {
        let mut ws = WorkspaceState::new();
        let a = ws.split_pane("pane-0", Orientation::Horizontal).unwrap();
        let b = ws.split_pane(&a, Orientation::Vertical).unwrap();
        assert_eq!(rootless_count(&ws), 1);

        ws.close_pane(&b).unwrap();
        let c = ws.split_pane("pane-0", Orientation::Horizontal).unwrap();

        assert!(!c.is_empty());
        assert!(ws.panes.contains_key(&a), "a 仍在树中");
        assert!(ws.panes.contains_key(&c), "c 已插入");
        assert_eq!(rootless_count(&ws), 1);
        // 所有 pane-N 键唯一由 HashMap 保证；这里显式断言 c 不是
        // 任何已存在 id 的重复。
        assert_ne!(ws.panes[&c].id, a);
    }

    /// 嵌套拆分后新容器必须挂在原父级的 children 槽位里，
    /// 不能成为一个孤立的第二个根。
    #[test]
    fn nested_split_keeps_single_root() {
        let mut ws = WorkspaceState::new();
        let a = ws.split_pane("pane-0", Orientation::Horizontal).unwrap();
        let _b = ws.split_pane(&a, Orientation::Vertical).unwrap();

        assert_eq!(rootless_count(&ws), 1, "嵌套拆分后仍应只有一个根");
        // root_pane_id 必须指向那个无父面板。
        let root = ws.panes.get(&ws.root_pane_id).unwrap();
        assert!(root.parent_id.is_none());
        // 被拆分的面板 a 现在是某个容器的子节点。
        assert!(ws.panes[&a].parent_id.is_some());
    }

    /// 关闭一个面板时，其兄弟若是拆分容器，晋升后必须仍是容器
    /// （旧的 `is_leaf = true` 会丢掉兄弟的子面板）。
    #[test]
    fn close_pane_keeps_container_sibling_structure() {
        let mut ws = WorkspaceState::new();
        let a = ws.split_pane("pane-0", Orientation::Horizontal).unwrap();
        let b = ws.split_pane(&a, Orientation::Vertical).unwrap();

        ws.close_pane("pane-0").unwrap();

        // 晋升的兄弟（承载 a/b 的容器）成为新根且仍是容器。
        let promoted = ws.panes.get(&ws.root_pane_id).unwrap();
        assert!(!promoted.is_leaf, "晋升的兄弟必须保持容器身份");
        assert!(promoted.children.is_some());
        assert!(ws.panes.contains_key(&b), "容器子面板 b 必须仍在");
        assert_eq!(rootless_count(&ws), 1);
    }

    /// 结构根不可关闭——split 之后 root_pane_id 必须指向真正的
    /// 根容器，而不是 new() 时的 pane-0。
    #[test]
    fn root_pane_id_tracks_structural_root() {
        let mut ws = WorkspaceState::new();
        let _a = ws.split_pane("pane-0", Orientation::Horizontal).unwrap();

        let root_id = ws.root_pane_id.clone();
        let root = ws.panes.get(&root_id).unwrap();
        assert!(root.parent_id.is_none(), "root_pane_id 应指向无父面板");
        assert!(ws.close_pane(&root_id).is_none());
        // pane-0 现在只是普通子面板，可以关闭。
        assert!(ws.close_pane("pane-0").is_some());
    }
}
