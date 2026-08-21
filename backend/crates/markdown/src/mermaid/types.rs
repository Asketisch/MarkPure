//! Mermaid 渲染流水线共享的类型定义。
//!
//! `MermaidError` 与 `MermaidResult` 是跨模块约定的契约：
//! 渲染器返回 `MermaidResult`，调用方对其 `svg` / `error` / `is_valid`
//! 字段进行模式匹配。将这些类型放在独立的子模块中，
//! 意味着新增子模块（`render`、`validate`、`suggestions`）
//! 可以只依赖这份契约，而无需互相牵连。

use serde::{Deserialize, Serialize};

/// Mermaid 操作的错误类型。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MermaidError {
    ParseError(String),
    RenderError(String),
    NotFound,
    InvalidSyntax(String),
}

/// Mermaid 渲染结果。
///
/// `svg` 与 `error` 在实际使用中互斥，但结构体允许两者都为空，
/// 这样即便收到格式异常的 Rust 应答，也只会序列化为 `{}` 而不会崩溃。
/// `is_valid` 表示“即使没能渲染成功，用户的代码至少具备 Mermaid 图形的样子”——
/// 当渲染器因未安装 `mmdc` 而软失败时该字段会被置为真
/// （编辑器可以保留代码块原样，仅展示提示信息）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MermaidResult {
    pub svg: Option<String>,
    pub error: Option<String>,
    pub is_valid: bool,
}