//! frontmatter 流水线的公共数据结构。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// frontmatter 的格式类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[derive(Default)]
pub enum FrontmatterFormat {
    #[default]
    Yaml,
    Toml,
    Json,
}


/// 表示解析后的 frontmatter
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Frontmatter {
    /// frontmatter 的格式
    pub format: FrontmatterFormat,
    /// 原始内容字符串
    pub content: String,
    /// 解析后的键值对
    pub fields: HashMap<String, FrontmatterValue>,
    /// 在原始文档中的字符范围
    pub bounds: FrontmatterBounds,
}

/// frontmatter 在文档中的边界
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct FrontmatterBounds {
    pub start: usize,
    pub end: usize,
}

/// frontmatter 值的类型
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

/// frontmatter 校验错误
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrontmatterError {
    pub message: String,
    pub line: Option<usize>,
    pub column: Option<usize>,
}

/// frontmatter 的自动补全建议
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
