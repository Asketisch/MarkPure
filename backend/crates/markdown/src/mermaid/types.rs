//! Shared types for the Mermaid pipeline.
//!
//! `MermaidError` and `MermaidResult` are the cross-module
//! contracts: the renderer returns a `MermaidResult`, callers
//! pattern-match on its `svg` / `error` / `is_valid` fields.
//! Keeping these types in their own submodule means new
//! submodules (`render`, `validate`, `suggestions`) can pull in
//! just the contract without dragging each other in.

use serde::{Deserialize, Serialize};

/// Error types for Mermaid operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MermaidError {
    ParseError(String),
    RenderError(String),
    NotFound,
    InvalidSyntax(String),
}

/// Mermaid rendering result.
///
/// `svg` and `error` are mutually exclusive in practice but the
/// schema allows both unset so a malformed Rust reply still
/// serialises to `{}` rather than panicking. `is_valid` is the
/// "even though we couldn't render, the user's code is at least
/// shaped like a mermaid diagram" signal — currently set when
/// the renderer soft-fails because `mmdc` isn't installed (the
/// editor can keep the code block intact and just show a hint).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MermaidResult {
    pub svg: Option<String>,
    pub error: Option<String>,
    pub is_valid: bool,
}