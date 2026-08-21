use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// 阶段 5：把每个标签页的 `workspace_root_id` 重新绑定到
/// 包含其 `path` 的根目录。最长匹配根路径优先（因此对标签页
/// `/x/notes/today.md` 来说 `/x/notes` 胜过 `/x`）。路径不在任何
/// 已配置根目录下的标签页保留其原有 `workspace_root_id`（作为
/// 渲染器「未知根目录」徽标的提示）——用户可以把文件夹移回某个
/// 根目录下，下次启动时重绑即可拾取。
///
/// 这是**非破坏性**迁移：它修改内存中的 `WindowTabs` 列表并返回；
/// 由调用方决定是否写回。我们不自动持久化，因为（a）用户可能想先
/// 修正路径配置，（b）下一次常规 `save_tabs` 调用（用户关闭应用或
/// 添加标签页时）会自然拾取重绑后的 id。
pub fn rebind_tabs_to_workspace_roots(
    mut windows: Vec<WindowTabs>,
    root_paths: &[(String, String)], // (root_id, root_path)
) -> Vec<WindowTabs> {
    for w in windows.iter_mut() {
        for t in w.tabs.iter_mut() {
            // 未命名标签页没有路径；保持其
            // `workspace_root_id` 不变（应为 None）。
            let Some(tab_path) = t.path.as_deref() else {
                continue;
            };
            // 最长前缀优先——按路径长度降序遍历根目录。
            // 并列（两个互为前缀的根目录）由排序稳定性解决：先插入的获胜。
            let mut roots: Vec<&(String, String)> = root_paths.iter().collect();
            roots.sort_by_key(|r| std::cmp::Reverse(r.1.len()));
            let matched = roots
                .into_iter()
                .find(|(_, rp)| is_under_root(tab_path, rp));
            if let Some((id, _)) = matched {
                t.workspace_root_id = Some(id.clone());
            }
            // 若无根目录匹配，则保留现有值。旧的 `tabs.json`（多根目录
            // 之前的）中 `workspace_root_id = None`；渲染器对这些标签页
            // 显示「未知根目录」徽标。即使匹配的根目录不存在，我们也不会
            // 清除非 None 的值——用户可能正准备重新添加它。
        }
    }
    windows
}

/// 若 `path` 位于 `root` 之下或等于 `root`，返回 true。两个参数都是
/// 磁盘上的绝对路径。我们在规范化后的路径字符串上做前缀匹配；
/// 这开销低，且与 `cmd_get_directory_tree` 在其他地方使用的规则一致
/// （当规范化路径字符串以规范化根目录 + 分隔符开头时，路径就在工作区内）。
///
/// Windows 上路径大小写不敏感且分隔符可为 `/` 或 `\`，因此比较必须
/// 放宽这两点，否则 `C:\Notes\today.md` 匹配不上根 `c:\notes`，
/// 启动时的标签页重绑（`rebind_tabs_to_workspace_roots`）会漏绑。
fn is_under_root(path: &str, root: &str) -> bool {
    // 规范化尾部分隔符，避免 `/x/notes/` 匹配不上路径为
    // `/x/notes/today.md` 的标签页。
    #[cfg(windows)]
    {
        let root_trim = root.trim_end_matches(|c| c == '/' || c == '\\');
        if root_trim.is_empty() {
            return false;
        }
        // ASCII 小写化是字节安全且保长的（非 ASCII 字符原样保留），
        // 避免在多字节字符中间按字节切片比较时 panic。
        let path_l = path.to_ascii_lowercase();
        let root_l = root_trim.to_ascii_lowercase();
        if !path_l.starts_with(&root_l) {
            return false;
        }
        path_l.len() == root_l.len() || matches!(path.as_bytes()[root_l.len()], b'/' | b'\\')
    }
    #[cfg(not(windows))]
    {
        let root_trim = root.trim_end_matches('/');
        if path == root_trim {
            return true;
        }
        path.starts_with(root_trim)
            && (root_trim.ends_with('/') || path[root_trim.len()..].starts_with('/'))
    }
}

/// 跨会话持久化的标签页状态
///
/// `content` 字段有意**排除**在（反）序列化之外。持久化位于磁盘上，
/// 只应携带元数据（打开的是哪个文件、滚动位置等）——实际文档内容由
/// 编辑器（Tiptap）在保存时持有，并在加载时从文件路径重新读取。信任来自
/// 客户端（或损坏的 tabs.json）的 `content` 字段，会让被篡改的磁盘文件
/// 在下次启动时向标签页注入任意 Markdown。编辑器自身的撤销/重做历史是
/// 内存态，按设计不持久化。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TabState {
    /// 唯一标签页标识符
    pub id: String,
    /// 显示名（文件名或「未命名」）
    pub name: String,
    /// 已保存时为文件路径，新建/未命名时为 None
    pub path: Option<String>,
    /// 当前内容
    ///
    /// `#[serde(default)]` 让没有该字段的旧 tabs.json 仍可加载。
    /// 我们从不*写入*该字段；见下方 `serialize_for_disk`。我们也不*读取*
    /// 非空值（加载器会丢弃它）——见 `load_tabs`。
    #[serde(default)]
    pub content: String,
    /// 文件是否有未保存的更改
    #[serde(default)]
    pub is_modified: bool,
    /// 滚动位置比例（0.0 - 1.0）
    #[serde(default)]
    pub scroll_ratio: f64,
    /// 文件是否只读
    #[serde(default)]
    pub read_only: bool,
    /// 多根目录工作区：该标签页所属的 `WorkspaceRoot.id`。
    /// 未保存/未命名标签页（无路径）或支持多根目录之前写入的
    /// 旧 `tabs.json` 文件为 `None`。渲染器对 `None` 显示「未知根目录」徽标，
    /// 对不匹配任何当前根目录的 `Some(id)` 显示「根目录缺失」徽标。
    #[serde(default)]
    pub workspace_root_id: Option<String>,
}

impl TabState {
    pub fn new(id: String, name: String) -> Self {
        Self {
            id,
            name,
            path: None,
            content: String::new(),
            is_modified: false,
            scroll_ratio: 0.0,
            read_only: false,
            workspace_root_id: None,
        }
    }

    pub fn with_path(id: String, path: String) -> Self {
        let name = std::path::Path::new(&path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "Untitled".to_string());
        Self {
            id,
            name,
            path: Some(path),
            content: String::new(),
            is_modified: false,
            scroll_ratio: 0.0,
            read_only: false,
            workspace_root_id: None,
        }
    }

    /// 渲染用于磁盘持久化的 `TabState`。这里丢弃 `content`，
    /// 使磁盘格式只携带元数据。
    pub fn serialize_for_disk(&self) -> serde_json::Value {
        serde_json::json!({
            "id": self.id,
            "name": self.name,
            "path": self.path,
            "is_modified": self.is_modified,
            "scroll_ratio": self.scroll_ratio,
            "read_only": self.read_only,
            "workspace_root_id": self.workspace_root_id,
        })
    }
}

/// 特定窗口的标签页状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowTabs {
    /// 窗口标识符（例如 "main"，或子窗口的 UUID）
    pub window_id: String,
    /// 当前活动标签页 ID
    pub active_tab_id: Option<String>,
    /// 该窗口中的所有标签页
    pub tabs: Vec<TabState>,
}

/// 我们从单个 tabs.json 文件接受的最大标签页数量。这限制了
/// 声称有数百万标签页的损坏文件造成的「磁盘炸弹」攻击。
const MAX_TABS_PER_LOAD: usize = 256;

/// 从配置目录加载窗口标签页。
///
/// 重要：此函数会剔除每个已加载标签页的 `content` 字段。磁盘文件允许
/// *包含* content 字段（旧版本会写入一个），但我们把该值当作
/// 不可信输入并丢弃。实际文档文本在标签页激活时从文件路径重新读取，
/// 因此用户始终看到真实文件内容。
pub fn load_tabs(config_dir: &Path) -> std::io::Result<Vec<WindowTabs>> {
    let tabs_path = config_dir.join("tabs.json");
    if !tabs_path.exists() {
        return Ok(Vec::new());
    }
    let raw = std::fs::read_to_string(&tabs_path)?;
    let mut windows: Vec<WindowTabs> = serde_json::from_str(&raw).map_err(|e| {
        std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string())
    })?;

    // 实施标签页数量上限。我们从开头截断，使打开数百个标签页的
    // 用户不会惊讶地发现 *活动的* 标签页不见了。
    let mut total = 0usize;
    for w in windows.iter_mut() {
        if w.tabs.len() + total > MAX_TABS_PER_LOAD {
            w.tabs.truncate(MAX_TABS_PER_LOAD.saturating_sub(total));
        }
        total += w.tabs.len();
        // 剔除内容——磁盘上的值不可信。
        for t in w.tabs.iter_mut() {
            t.content.clear();
        }
    }
    Ok(windows)
}

/// 保存窗口标签页到配置目录
pub fn save_tabs(config_dir: &Path, windows: &[WindowTabs]) -> std::io::Result<()> {
    let tabs_path = config_dir.join("tabs.json");
    if let Some(parent) = tabs_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    // 手工构建 JSON，保证没有 `content` 字段泄漏到磁盘格式中。
    // 这是 load_tabs 的「剔除内容」规则的反向对应。
    let mut out = String::from("[\n");
    for (i, w) in windows.iter().enumerate() {
        if i > 0 {
            out.push_str(",\n");
        }
        out.push_str("  {\n");
        out.push_str(&format!("    \"window_id\": {},\n", serde_json::to_string(&w.window_id).unwrap_or_else(|_| "null".into())));
        out.push_str(&format!("    \"active_tab_id\": {},\n", serde_json::to_string(&w.active_tab_id).unwrap_or_else(|_| "null".into())));
        out.push_str("    \"tabs\": [");
        for (j, t) in w.tabs.iter().enumerate() {
            if j > 0 {
                out.push(',');
            }
            out.push('\n');
            let v = t.serialize_for_disk();
            let s = serde_json::to_string_pretty(&v).unwrap_or_else(|_| "{}".into());
            // 重新缩进内部对象
            for line in s.lines() {
                out.push_str("      ");
                out.push_str(line);
                out.push('\n');
            }
        }
        if !w.tabs.is_empty() {
            out.push_str("    ]\n");
        } else {
            out.push_str("]\n");
        }
        out.push_str("  }");
    }
    out.push_str("\n]\n");
    // 原子写入：配置文件的半截写状态会在下次启动被 load_tabs 解析，
    // 中断必须保证磁盘上要么是旧文件、要么是完整新文件。
    crate::atomic::atomic_write(&tabs_path, &out)
}

/// 获取默认标签页文件路径
pub fn tabs_path() -> PathBuf {
    crate::dirs::app_config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("tabs.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_strips_trusted_content_field() {
        // 攻击者（或旧版本写入 content 字段后遗留）塞入的
        // tabs.json 不得把 `content` 字段注入正在运行的标签页进程。
        // 磁盘属于不可信输入。
        let dir = std::env::temp_dir().join("markpure-tab-test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("tabs.json");
        std::fs::write(
            &path,
            r#"[
              {
                "window_id": "main",
                "active_tab_id": "t1",
                "tabs": [
                  {"id": "t1", "name": "evil", "path": null,
                   "content": "<script>alert(1)</script>", "is_modified": false,
                   "scroll_ratio": 0.0, "read_only": false}
                ]
              }
            ]"#,
        )
        .unwrap();

        let loaded = load_tabs(&dir).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].tabs.len(), 1);
        assert!(
            loaded[0].tabs[0].content.is_empty(),
            "trusted disk content leaked: {:?}",
            loaded[0].tabs[0].content
        );
    }

    #[test]
    fn load_caps_excessive_tab_count() {
        let dir = std::env::temp_dir().join("markpure-tab-cap");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("tabs.json");
        // 构造一个 300 个标签页的文件；上限是 256。
        let mut s = String::from(r#"[{"window_id": "w", "active_tab_id": null, "tabs": ["#);
        for i in 0..300 {
            if i > 0 {
                s.push(',');
            }
            s.push_str(&format!(
                r#"{{"id":"t{i}","name":"t{i}","path":null,"content":"","is_modified":false,"scroll_ratio":0.0,"read_only":false}}"#
            ));
        }
        s.push_str("]}]");
        std::fs::write(&path, s).unwrap();

        let loaded = load_tabs(&dir).unwrap();
        let total: usize = loaded.iter().map(|w| w.tabs.len()).sum();
        assert!(total <= MAX_TABS_PER_LOAD, "got {total} tabs");
    }

    #[test]
    fn save_does_not_emit_content_field() {
        let dir = std::env::temp_dir().join("markpure-tab-save");
        std::fs::create_dir_all(&dir).unwrap();
        let mut t = TabState::with_path("t1".into(), "/tmp/secret.md".into());
        // 模拟编辑器里有大量内容。保存时绝不能序列化它——这是规则。
        t.content = "SENSITIVE PASSWORD DATA".into();

        save_tabs(&dir, &[WindowTabs {
            window_id: "main".into(),
            active_tab_id: Some("t1".into()),
            tabs: vec![t],
        }]).unwrap();

        let on_disk = std::fs::read_to_string(dir.join("tabs.json")).unwrap();
        assert!(!on_disk.contains("SENSITIVE PASSWORD DATA"),
                "content leaked to disk: {on_disk}");
        assert!(!on_disk.contains("\"content\""), "content field emitted: {on_disk}");
    }

    #[test]
    fn load_handles_missing_workspace_root_id_field() {
        // 向后兼容：单根目录版本（无 workspace_root_id 字段）写出的
        // tabs.json 仍须可加载——加载后的标签页中该字段应为 None。
        let dir = std::env::temp_dir().join("markpure-tab-legacy-wroot");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("tabs.json");
        std::fs::write(
            &path,
            r#"[
              {
                "window_id": "main",
                "active_tab_id": "t1",
                "tabs": [
                  {"id": "t1", "name": "old", "path": "/x/a.md",
                   "is_modified": false, "scroll_ratio": 0.0, "read_only": false}
                ]
              }
            ]"#,
        )
        .unwrap();

        let loaded = load_tabs(&dir).unwrap();
        assert_eq!(loaded[0].tabs[0].workspace_root_id, None,
                   "legacy tabs.json should deserialize workspace_root_id as None");
    }

    #[test]
    fn round_trip_preserves_workspace_root_id() {
        let dir = std::env::temp_dir().join("markpure-tab-rt-wroot");
        std::fs::create_dir_all(&dir).unwrap();
        let mut t = TabState::with_path("t1".into(), "/x/a.md".into());
        t.workspace_root_id = Some("root-abc".into());

        save_tabs(&dir, &[WindowTabs {
            window_id: "main".into(),
            active_tab_id: Some("t1".into()),
            tabs: vec![t],
        }]).unwrap();

        let loaded = load_tabs(&dir).unwrap();
        assert_eq!(loaded[0].tabs[0].workspace_root_id.as_deref(), Some("root-abc"));
    }

    /// 旧版（无 `workspace_root_id` 字段）标签页在重绑时被
    /// 分配到包含其 `path` 的根目录。重绑按最长前缀优先，
    /// 因此配置了两个根目录时更具体的那个获胜。
    #[test]
    fn rebind_finds_longest_matching_root() {
        let tab = TabState::with_path("t1".into(), "/x/notes/today.md".into());
        let windows = vec![WindowTabs {
            window_id: "main".into(),
            active_tab_id: Some("t1".into()),
            tabs: vec![tab],
        }];
        let roots = vec![
            ("root-loose".into(), "/x".into()),
            ("root-tight".into(), "/x/notes".into()),
            ("root-other".into(), "/y".into()),
        ];
        let rebound = rebind_tabs_to_workspace_roots(windows, &roots);
        assert_eq!(
            rebound[0].tabs[0].workspace_root_id.as_deref(),
            Some("root-tight"),
        );
    }

    /// 路径在所有根目录之外的标签页保留其现有 `workspace_root_id`
    /// （若标签页来自旧版文件则保持 `None`）。我们从不把提示
    /// 覆盖为 `None`——丢失提示会让用户日后更难修复配置错误的工作区。
    #[test]
    fn rebind_preserves_unmatched_tab() {
        let tab = TabState::with_path("t1".into(), "/elsewhere/a.md".into());
        let windows = vec![WindowTabs {
            window_id: "main".into(),
            active_tab_id: Some("t1".into()),
            tabs: vec![tab],
        }];
        let roots = vec![("root-x".into(), "/x".into())];
        let rebound = rebind_tabs_to_workspace_roots(windows, &roots);
        assert_eq!(rebound[0].tabs[0].workspace_root_id, None);
    }

    /// `is_under_root` 必须要求前缀边界处是分隔符——`/x/notes2/a.md`
    /// 与根 `/x/notes` 字节前缀相同，但不在其下。同时 unix 上大小写
    /// 敏感（路径区分大小写），尾部分隔符必须被规范化。
    #[test]
    fn is_under_root_requires_separator_boundary() {
        assert!(is_under_root("/x/notes/today.md", "/x/notes"));
        assert!(is_under_root("/x/notes", "/x/notes"));
        assert!(is_under_root("/x/notes/today.md", "/x/notes/"));
        assert!(!is_under_root("/x/notes2/a.md", "/x/notes"));
        assert!(!is_under_root("/x", "/x/notes"));
        assert!(!is_under_root("/X/notes/a.md", "/x/notes"));
    }

    /// 未命名标签页（无 `path`）保留其原有的 `workspace_root_id`，
    /// 因为没有可匹配的内容。旧版未命名标签页为 `None`，重绑
    /// 对其不做改动。
    #[test]
    fn rebind_skips_untitled_tabs() {
        let tab = TabState::new("u1".into(), "Untitled".into());
        let windows = vec![WindowTabs {
            window_id: "main".into(),
            active_tab_id: Some("u1".into()),
            tabs: vec![tab],
        }];
        let roots = vec![("root-x".into(), "/x".into())];
        let rebound = rebind_tabs_to_workspace_roots(windows, &roots);
        assert_eq!(rebound[0].tabs[0].workspace_root_id, None);
    }
}
