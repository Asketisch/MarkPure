//! Mermaid 图表解析、校验、渲染与自动补全建议。
//!
//! 该流水线过去放在单个 620 行的文件里，现已拆分为职责明确的子模块：
//!
//! - [`types`] —— `MermaidError`、`MermaidResult` 以及其他跨模块数据类型。
//! - [`validate`] —— `validate_mermaid`、`are_brackets_balanced`、
//!   `DiagramType`。纯谓词，无 I/O。
//! - [`render`] —— `mmdc` 进程调度 + SVG/PNG 缓存。目前最大的一块。
//! - [`suggestions`] —— 编辑器快速插入弹窗使用的自动补全目录。
//!
//! `extract_mermaid_blocks` 和 `parse_mermaid`（感知 Markdown 的入口）
//! 放在本 `mod.rs` 中，因为它们是串联 `validate` 与 markdown
//! 解析事件的简短胶水函数。
//!
//! 公共再导出保持了现有 API 表面（`markdown::MermaidResult`、
//! `markdown::validate_mermaid` 等）。IPC 调用方无需改动。

pub mod render;
pub mod suggestions;
pub mod types;
pub mod validate;

pub use render::{
    render_mermaid_to_png_cached, render_mermaid_to_svg_cached, render_mermaid_with_cli,
};
pub use suggestions::{get_mermaid_suggestions, MermaidCompletion};
pub use types::{MermaidError, MermaidResult};
pub use validate::{are_brackets_balanced, validate_mermaid, DiagramType};

/// 从 Markdown 内容中提取 mermaid 代码块。
/// 按文档顺序返回 `(行号, 代码)` 对。
///
/// 逐行遍历 Markdown，把信息字符串为 `mermaid` 的围栏当作
/// mermaid 块的开始，块在下一个不带语言标识的 ` ``` ` 围栏处结束。
pub fn extract_mermaid_blocks(content: &str) -> Vec<(usize, String)> {
    let mut blocks: Vec<(usize, String)> = Vec::new();
    let mut in_block = false;
    let mut block_start = 0usize;
    let mut current_language = String::new();
    let mut code_content = String::new();

    // 行号从 1 开始——文档第一行是 `1`，与编辑器和 grep 的报告方式一致。
    let mut line_number: usize = 0;

    for line in content.lines() {
        line_number += 1;

        if line.trim_start().starts_with("```mermaid") {
            in_block = true;
            block_start = line_number;
            code_content.clear();
            current_language = "mermaid".to_string();
        } else if line.trim_start().starts_with("```") && in_block {
            if current_language == "mermaid" {
                blocks.push((block_start, code_content.clone()));
            }
            in_block = false;
            current_language.clear();
        } else if in_block {
            if !code_content.is_empty() {
                code_content.push('\n');
            }
            code_content.push_str(line);
        }
    }

    blocks
}

/// 解析 mermaid 代码并返回结构化信息。
/// 把开销低的校验谓词与最终的 `DiagramType` 分类结合；
/// 实际的 SVG/PNG 输出由渲染器负责。
pub fn parse_mermaid(code: &str) -> Result<DiagramType, MermaidError> {
    if code.trim().is_empty() {
        return Err(MermaidError::InvalidSyntax("Empty mermaid code".to_string()));
    }

    if !validate_mermaid(code) {
        return Err(MermaidError::InvalidSyntax("Unbalanced brackets".to_string()));
    }

    Ok(DiagramType::from_code(code))
}