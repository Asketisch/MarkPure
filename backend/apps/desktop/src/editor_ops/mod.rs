//! 编辑器相关的 IPC 处理器。
//!
//! 主题：文档级分析（大纲、双链、标签）、Rust 侧的文档注册表
//! （LRU），以及各种 Markdown 扩展辅助（mermaid、frontmatter、
//! 表格、折叠、pandoc 风格任务列表）。拼写检查也放在这里，
//! 因为它属于文本内容分析，而不是工作区/配置管道。
//!
//! # 子模块
//!
//! - [`doc_registry`] — LRU 文档注册表、5 个 `doc_*` IPC
//!   命令，以及根目录切换时的 GC。
//! - [`spellcheck`]   — NSSpellChecker 分发（仅 macOS 路径）。
//! - [`markdown_ops`] — frontmatter / 表格 / 折叠 / pandoc 任务项。

pub mod doc_registry;
pub mod spellcheck;
pub mod markdown_ops;

// ============================== 大纲 / 双链 / 标签 ==============================
//
// 这些处理器不需要 `AppState`；它们只处理渲染器传入的内容字符串，
// 因此放在模块根级别。

/// 从 Markdown 内容中提取标题大纲。
pub fn cmd_get_outline(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"].as_str().unwrap_or("");
    let headings = markdown::extract_headings(content);
    serde_json::to_value(headings).map_err(|e| e.to_string())
}

/// 从内容中提取 `[[Wiki]]` / `[[Wiki|别名]]` 链接。
pub fn cmd_get_wikilinks(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"].as_str().unwrap_or("");
    let wikilinks = markdown::extract_wikilinks(content);
    let result: Vec<serde_json::Value> = wikilinks
        .into_iter()
        .map(|wl| serde_json::json!({ "page": wl.page, "alias": wl.alias }))
        .collect();
    serde_json::to_value(result).map_err(|e| e.to_string())
}

/// 从内容中提取 `#tag` 提及。
pub fn cmd_get_tags(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"].as_str().unwrap_or("");
    let tags = markdown::extract_tags(content);
    let result: Vec<serde_json::Value> = tags
        .into_iter()
        .map(|t| serde_json::json!({ "name": t.name, "start": t.start, "end": t.end }))
        .collect();
    serde_json::to_value(result).map_err(|e| e.to_string())
}

// 再导出所有 `cmd_*`，让现有调用点（`editor_ops::cmd_foo`、调度表）
// 在拆分后无需改动即可继续工作。
pub use doc_registry::*;
pub use spellcheck::*;
pub use markdown_ops::*;
