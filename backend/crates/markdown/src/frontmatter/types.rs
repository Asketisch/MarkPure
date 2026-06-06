//! Public data structures for the frontmatter pipeline.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Frontmatter format types
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FrontmatterFormat {
    Yaml,
    Toml,
    Json,
}

impl Default for FrontmatterFormat {
    fn default() -> Self {
        FrontmatterFormat::Yaml
    }
}

/// Represents parsed frontmatter
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Frontmatter {
    /// The format of the frontmatter
    pub format: FrontmatterFormat,
    /// Raw content string
    pub content: String,
    /// Parsed key-value pairs
    pub fields: HashMap<String, FrontmatterValue>,
    /// Character range in the original document
    pub bounds: FrontmatterBounds,
}

/// Bounds of frontmatter in the document
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct FrontmatterBounds {
    pub start: usize,
    pub end: usize,
}

/// Frontmatter value types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum FrontmatterValue {
    String(String),
    Number(f64),
    Boolean(bool),
    Array(Vec<FrontmatterValue>),
    Object(HashMap<String, FrontmatterValue>),
}

impl FrontmatterValue {
    pub fn as_str(&self) -> Option<&str> {
        match self {
            FrontmatterValue::String(s) => Some(s),
            _ => None,
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self {
            FrontmatterValue::Boolean(b) => Some(*b),
            _ => None,
        }
    }

    pub fn as_number(&self) -> Option<f64> {
        match self {
            FrontmatterValue::Number(n) => Some(*n),
            _ => None,
        }
    }

    pub fn as_array(&self) -> Option<&Vec<FrontmatterValue>> {
        match self {
            FrontmatterValue::Array(a) => Some(a),
            _ => None,
        }
    }
}

/// Frontmatter validation error
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrontmatterError {
    pub message: String,
    pub line: Option<usize>,
    pub column: Option<usize>,
}

/// Autocomplete suggestion for frontmatter
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrontmatterCompletion {
    pub label: String,
    pub description: String,
    pub insert_text: String,
    pub kind: CompletionKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CompletionKind {
    Property,
    Value,
    Snippet,
}
