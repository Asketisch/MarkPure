//! 拼写检查管线的共享类型。
//!
//! `SpellError` / `SpellCheckResult` 是前端通过 `check_spelling`
//! IPC 消费的传输结构。`Language` 是分发器用来选择后端（英文字典
//! 还是 macOS 上的 NSSpellChecker）的枚举。
//!
//! 单独放一个文件，让 `english.rs` 和 `macos.rs` 都能
//! `use crate::types::*;` 而不会产生循环引用。

use serde::{Deserialize, Serialize};

/// 带位置和建议的拼写检查错误。
///
/// `start` / `end` 是传给 `check_spelling` 的原始 `text` 参数中的
/// **字节偏移**。由前端负责把它们映射回 ProseMirror 位置
/// （它已经通过 `plugins/spellcheck.ts` 里的 textBetween +
/// posMap 模式做到了这一点）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpellError {
    pub word: String,
    pub start: usize,
    pub end: usize,
    pub suggestions: Vec<String>,
}

/// 跨 IPC 返回的拼写检查结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpellCheckResult {
    pub errors: Vec<SpellError>,
    pub language: String,
}

/// 支持的语言。
///
/// 字符串代码（`"en"`、`"zh-CN"`、`"ja"`）既与前端的 i18n
/// 语言环境标识对齐，也与 NSSpellChecker 接受的 BCP-47 标签对齐
/// （它在内部把 `"zh-CN"` 映射到简体中文检查器）。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum Language {
    En,
    ZhCn,
    Ja,
}

impl Language {
    pub fn from_code(code: &str) -> Self {
        match code {
            "zh-CN" | "zh" => Language::ZhCn,
            "ja" => Language::Ja,
            _ => Language::En,
        }
    }

    pub fn code(&self) -> &'static str {
        match self {
            Language::En => "en",
            Language::ZhCn => "zh-CN",
            Language::Ja => "ja",
        }
    }
}
