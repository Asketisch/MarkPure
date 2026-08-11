//! Mermaid diagram parsing, validation, rendering, and
//! autocomplete suggestions.
//!
//! The pipeline used to live in a single 620-line file. It is
//! now split into focused submodules:
//!
//! - [`types`] — `MermaidError`, `MermaidResult` and any other
//!   cross-module data types.
//! - [`validate`] — `validate_mermaid`, `are_brackets_balanced`,
//!   `DiagramType`. Pure predicates, no I/O.
//! - [`render`] — `mmdc` spawn + SVG/PNG cache. The biggest
//!   file by far.
//! - [`suggestions`] — the autocomplete catalogue used by the
//!   editor's quick-insert popup.
//!
//! `extract_mermaid_blocks` and `parse_mermaid` (the markdown-
//! aware entry points) live in this `mod.rs` because they are
//! short glue functions that span `validate` and the markdown
//! parser events.
//!
//! Public re-exports preserve the existing API surface
//! (`markdown::MermaidResult`, `markdown::validate_mermaid`, …).
//! IPC callers should not need to change.

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

/// Extract mermaid code blocks from markdown content.
/// Returns `(line_number, code)` pairs in document order.
///
/// Walks the markdown line-by-line, treating any fence whose
/// info string is `mermaid` as the start of a mermaid block.
/// The block ends at the next unadorned ` ``` ` fence.
pub fn extract_mermaid_blocks(content: &str) -> Vec<(usize, String)> {
    let mut blocks: Vec<(usize, String)> = Vec::new();
    let mut in_block = false;
    let mut block_start = 0usize;
    let mut current_language = String::new();
    let mut code_content = String::new();

    // 1-indexed line numbers — the first line of the document
    // is `1`, matching how editors and grep report findings.
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

/// Parse mermaid code and return structured information.
/// Combines the cheap validation predicates with a final
/// `DiagramType` classification; the renderer is responsible
/// for the actual SVG/PNG output.
pub fn parse_mermaid(code: &str) -> Result<DiagramType, MermaidError> {
    if code.trim().is_empty() {
        return Err(MermaidError::InvalidSyntax("Empty mermaid code".to_string()));
    }

    if !validate_mermaid(code) {
        return Err(MermaidError::InvalidSyntax("Unbalanced brackets".to_string()));
    }

    Ok(DiagramType::from_code(code))
}