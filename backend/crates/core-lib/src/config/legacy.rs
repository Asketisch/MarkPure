use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::theme::ThemeId;
// `WorkspaceRoot` 在下方的结构体字段和从旧版 `last_workspace` 字符串
// 合成根目录的迁移代码中被引用。增删改/激活等更丰富的辅助方法位于
// `workspace_roots` 子模块，因此本文件专注于 AppConfig 结构体、
// 逐字段 CRUD 和迁移逻辑。
use crate::workspace_root::WorkspaceRoot;

/// 应用配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    /// 编辑器设置
    pub editor: EditorConfig,
    /// 窗口设置
    pub window: WindowConfig,
    /// 当前活动主题
    pub theme: ThemeId,
    /// 最近打开的文件（最多 10 个）
    #[serde(default)]
    pub recent_files: Vec<String>,
    /// **旧版** 单根目录提示。为了回滚旧版本的用户能保留数据，
    /// 在一个发布周期内仍以不同 TOML 键写入磁盘。新代码
    /// 读取 `workspace_roots` + `active_workspace_root_id`。
    ///
    /// TOML 中的字段名：`_legacy_last_workspace`。
    #[serde(default, rename = "_legacy_last_workspace", skip_serializing)]
    pub last_workspace: Option<String>,
    /// 当前工作区的所有文件夹（多根目录）。
    #[serde(default)]
    pub workspace_roots: Vec<WorkspaceRoot>,
    /// 当前活动的根目录（驱动文件树、路径校验、标签/反链面板）。
    /// `None` 表示「没有打开文件夹」。
    #[serde(default)]
    pub active_workspace_root_id: Option<String>,
    /// UI 语言（如 "zh"、"en"）
    #[serde(default)]
    pub language: Option<String>,
    /// 已展开的目录路径，按根目录 id 分组。
    ///
    /// 以映射存储，使每个根目录记住自己的树展开状态。
    /// 旧配置（使用扁平的 `Vec<String>`）在 `load()` 中被迁移，
    /// 方法是将条目归属到活动根目录。
    #[serde(default)]
    pub expanded_dirs: std::collections::HashMap<String, Vec<String>>,
    /// Vim 模式开关。为 true 时编辑器接受
    /// NORMAL/INSERT/VISUAL 按键序列；为 false 时使用默认的
    /// Tiptap 键位。跨会话持久化；运行时通过 `Cmd+.` 或命令面板切换。
    /// `#[serde(default)]` 让没有该字段的旧配置文件
    /// 反序列化为 `false`。
    #[serde(default)]
    pub vim_mode: bool,
    /// 「字数目标」。大于 0 时状态栏显示 `<当前字数> / <目标>
    ///（<百分比>%）`，让用户对照写作目标（如一篇 5000 字的文章）
    /// 跟踪进度。默认 `0`（禁用），使现有用户的状态栏不变。
    #[serde(default)]
    pub word_count_goal: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EditorConfig {
    /// 字体族
    pub font_family: String,
    /// 字号（像素）
    pub font_size: u16,
    /// 制表符宽度（空格数）
    pub tab_size: u8,
    /// 是否使用软制表符（空格）代替硬制表符
    pub soft_tabs: bool,
    /// 是否显示行号
    pub line_numbers: bool,
    /// 是否启用自动换行
    pub word_wrap: bool,
    /// 自动保存间隔（秒，0 表示禁用）
    pub auto_save_interval: u16,
    /// 是否对当前文档运行拼写检查。
    /// macOS 上使用 NSSpellChecker（完整的中英文字典）；
    /// 其他平台回退到内置英文词典并跳过 CJK。
    ///
    /// macOS 默认为 true（系统提供了免费、高质量的检查器），
    /// 其他平台默认为 false，避免非 macOS 用户
    /// 因只能检查英文而在唯一可检查的语言上看到红下划线。
    #[serde(default = "default_spellcheck_enabled")]
    pub spellcheck_enabled: bool,
    /// 覆盖拼写检查语言。`None` 表示「跟随 UI 语言」——
    /// 前端会传入当前 `i18n.locale`。例如设为 `"en"`
    /// 可在 UI 为中文时仍保持英文检查器。
    #[serde(default)]
    pub spellcheck_language: Option<String>,
    /// 保存时对 Markdown 做 lint。为 true 时 `save_file`
    /// 在写入磁盘前对缓冲区调用 `lint_markdown`——
    /// 去除行尾空白、确保末尾换行、合并 3 个以上的空行为 1 个。
    /// 默认 `false`，使现有用户的工作流不变。
    #[serde(default)]
    pub lint_on_save: bool,
}

fn default_spellcheck_enabled() -> bool {
    cfg!(target_os = "macos")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowConfig {
    /// 窗口宽度
    pub width: f32,
    /// 窗口高度
    pub height: f32,
    /// 窗口 X 坐标
    pub x: Option<f32>,
    /// 窗口 Y 坐标
    pub y: Option<f32>,
    /// 窗口是否最大化
    pub maximized: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            editor: EditorConfig {
                font_family: "monospace".to_string(),
                font_size: 14,
                tab_size: 4,
                soft_tabs: true,
                line_numbers: true,
                word_wrap: true,
                auto_save_interval: 0,
                spellcheck_enabled: default_spellcheck_enabled(),
                spellcheck_language: None,
                // 保存时 lint 默认关闭，使该功能为可选。
                // 想要自动清理的用户在「设置 → 编辑器 → 保存时 lint」
                // 中打开开关。
                lint_on_save: false,
            },
            window: WindowConfig {
                width: 1200.0,
                height: 800.0,
                x: None,
                y: None,
                maximized: false,
            },
            theme: ThemeId::Light,
            recent_files: Vec::new(),
            last_workspace: None,
            workspace_roots: Vec::new(),
            active_workspace_root_id: None,
            language: None,
            expanded_dirs: std::collections::HashMap::new(),
            vim_mode: false,
            word_count_goal: 0,
        }
    }
}

impl AppConfig {
    /// 从文件加载配置；文件不存在时返回默认值。
    ///
    /// 将遇到的任何错误（输出到 stderr），使损坏的配置文件
    /// 不会静默丢弃用户设置。我们仍回退到默认值让应用启动——
    /// 输出错误给用户（或 CI 运行）恢复或报告损坏的机会。
    ///
    /// 对旧版单根目录字段执行一次性迁移到多根目录形态。
    /// 见 [`Self::migrate_workspace_roots`]。
    pub fn load(path: &PathBuf) -> Self {
        let raw = match std::fs::read_to_string(path) {
            Ok(s) => s,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Self::default(),
            Err(e) => {
                eprintln!(
                    "[AppConfig] could not read config at {}: {} — using defaults",
                    path.display(),
                    e
                );
                return Self::default();
            }
        };
        let mut cfg: AppConfig = match toml::from_str(&raw) {
            Ok(cfg) => cfg,
            Err(e) => {
                eprintln!(
                    "[AppConfig] config at {} is corrupted: {} — using defaults. \
                     The original file has been preserved as config.toml.broken for inspection.",
                    path.display(),
                    e
                );
                // 保留损坏的文件，让用户能手动恢复
                // 他们的设置。
                let backup = path.with_extension("toml.broken");
                let _ = std::fs::write(&backup, raw);
                Self::default()
            }
        };
        cfg.migrate_workspace_roots();
        cfg
    }

    /// 把旧版单根目录字段迁移为多根目录形态。
    ///
    /// 若 `workspace_roots` 为空且旧 `last_workspace` 字段有值，
    /// 从它合成一个 `WorkspaceRoot`，并把 `active_workspace_root_id`
    /// 设为新 id。
    ///
    /// 始终可安全调用；幂等。
    pub fn migrate_workspace_roots(&mut self) {
        if self.workspace_roots.is_empty() {
            if let Some(path) = self.last_workspace.take() {
                if !path.is_empty() {
                    let root = WorkspaceRoot::from_path(&path);
                    let id = root.id.clone();
                    self.workspace_roots.push(root);
                    self.active_workspace_root_id = Some(id);
                }
            }
        }
    }

    /// 保存配置到文件（原子写：崩溃不会把 config.toml 留在截断状态）
    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        let s = toml::to_string_pretty(self).map_err(|e| {
            std::io::Error::other(e.to_string())
        })?;
        crate::atomic::atomic_write(path, &s)
    }

    /// 获取默认配置文件路径
    pub fn config_path() -> PathBuf {
        crate::dirs::app_config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("config.toml")
    }

    /// 把文件加入最近文件列表（最近的在最前）
    pub fn add_recent_file(&mut self, path: &str) {
        // 若已存在则先移除
        self.recent_files.retain(|p| p != path);
        // 插到最前
        self.recent_files.insert(0, path.to_string());
        // 只保留最近 10 个
        self.recent_files.truncate(10);
    }

    /// 获取最近文件列表
    pub fn get_recent_files(&self) -> &[String] {
        &self.recent_files
    }

    /// 清空最近文件列表
    pub fn clear_recent_files(&mut self) {
        self.recent_files.clear();
    }

    /// **已弃用** — 旧版单根目录 API，为向后兼容保留。
    ///
    /// 新代码应使用 [`add_workspace_root`](Self::add_workspace_root)
    /// + [`set_active_workspace_root`](Self::set_active_workspace_root)。
    #[deprecated(note = "use add_workspace_root / set_active_workspace_root instead")]
    pub fn set_last_workspace(&mut self, path: Option<String>) {
        self.last_workspace = path;
    }

    /// **已弃用** — 旧版单根目录 API。迁移后 `workspace_roots` 为空时
    /// 仍返回原始字段用于诊断；新代码应读取 [`get_active_workspace_root`]。
    #[deprecated(note = "use get_active_workspace_root instead")]
    pub fn get_last_workspace(&self) -> Option<&String> {
        self.last_workspace.as_ref()
    }

    // -------- 多根目录工作区 API --------

    /// 设置 UI 语言
    pub fn set_language(&mut self, lang: Option<String>) {
        self.language = lang;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 构建一个 `workspace_roots` 为空但携带旧 `last_workspace` 值的配置，
    /// 模拟 P2-4 之前的配置文件。我们以编程方式构造（而不是通过 TOML
    /// 往返），因为改名为 `_legacy_last_workspace` 需要在磁盘上使用不同的键；
    /// 内存中的 `migrate_workspace_roots` 只关心字段值。
    fn legacy_config_with_workspace(path: &str) -> AppConfig {
        let mut cfg = AppConfig {
            last_workspace: Some(path.to_string()),
            ..AppConfig::default()
        };
        cfg.migrate_workspace_roots();
        cfg
    }

    #[test]
    fn migrate_legacy_last_workspace_into_workspace_roots() {
        let cfg = legacy_config_with_workspace("/tmp");
        // 迁移后存在单个根目录。
        assert_eq!(cfg.workspace_roots.len(), 1);
        let root = &cfg.workspace_roots[0];
        // 规范化的 /tmp 基名为 "tmp"。
        assert_eq!(root.name, "tmp");
        // 活动 id 指向新根目录。
        assert_eq!(cfg.active_workspace_root_id.as_deref(), Some(root.id.as_str()));
        // 旧字段已被消费。
        assert!(cfg.last_workspace.is_none());
    }

    #[test]
    fn migrate_is_idempotent() {
        let mut cfg = legacy_config_with_workspace("/tmp");
        // 再次运行迁移不得添加第二个根目录。
        cfg.migrate_workspace_roots();
        cfg.migrate_workspace_roots();
        assert_eq!(cfg.workspace_roots.len(), 1);
    }

    #[test]
    fn migrate_empty_legacy_is_noop() {
        let mut cfg = AppConfig::default();
        cfg.migrate_workspace_roots();
        assert!(cfg.workspace_roots.is_empty());
        assert!(cfg.active_workspace_root_id.is_none());
    }

    #[test]
    fn add_workspace_root_rejects_duplicates() {
        let mut cfg = AppConfig::default();
        let r1 = cfg.add_workspace_root("/tmp").expect("first add");
        let dup = cfg.add_workspace_root("/tmp");
        assert!(dup.is_err());
        // 活动 id 仍指向 r1。
        assert_eq!(cfg.active_workspace_root_id.as_deref(), Some(r1.id.as_str()));
    }

    #[test]
    fn remove_workspace_root_falls_back_to_first_remaining() {
        let mut cfg = AppConfig::default();
        let a = cfg.add_workspace_root("/tmp").expect("a");
        let _b = cfg.add_workspace_root("/var").expect("b");
        // 活动的是 a（首次添加优先）。移除 a → b 应为活动。
        assert!(cfg.remove_workspace_root(&a.id));
        assert_eq!(cfg.active_workspace_root_id.as_deref(), Some(_b.id.as_str()));
    }

    #[test]
    fn expanded_dirs_are_per_root() {
        let mut cfg = AppConfig::default();
        let a = cfg.add_workspace_root("/tmp").expect("a");
        let b = cfg.add_workspace_root("/var").expect("b");
        cfg.set_expanded_dirs_for(&a.id, vec!["/tmp/notes".to_string()]);
        cfg.set_expanded_dirs_for(&b.id, vec!["/var/docs".to_string()]);
        assert_eq!(cfg.get_expanded_dirs_for(&a.id), &["/tmp/notes".to_string()]);
        assert_eq!(cfg.get_expanded_dirs_for(&b.id), &["/var/docs".to_string()]);
        // 移除 a 会丢弃它的展开目录记忆。
        assert!(cfg.remove_workspace_root(&a.id));
        assert!(cfg.get_expanded_dirs_for(&a.id).is_empty());
        // b 不受影响。
        assert_eq!(cfg.get_expanded_dirs_for(&b.id), &["/var/docs".to_string()]);
        // 第二次添加仍为活动。
        assert_eq!(cfg.active_workspace_root_id.as_deref(), Some(b.id.as_str()));
    }
}
