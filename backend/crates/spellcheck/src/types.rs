//! Shared types for the spell-check pipeline.
//!
//! `SpellError` / `SpellCheckResult` are the wire shapes the
//! frontend consumes via the `check_spelling` IPC. `Language`
//! is the enum the dispatcher uses to pick a backend
//! (English dict vs NSSpellChecker on macOS).
//!
//! Kept in its own file so both `english.rs` and `macos.rs`
//! can `use crate::types::*;` without circular references.

use serde::{Deserialize, Serialize};

/// A spell check error with position and suggestions.
///
/// `start` / `end` are **byte offsets** into the original
/// `text` argument passed to `check_spelling`. The frontend
/// is responsible for mapping these back into ProseMirror
/// positions (it already does this via the textBetween +
/// posMap pattern in `plugins/spellcheck.ts`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpellError {
    pub word: String,
    pub start: usize,
    pub end: usize,
    pub suggestions: Vec<String>,
}

/// Spell check result returned across IPC.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpellCheckResult {
    pub errors: Vec<SpellError>,
    pub language: String,
}

/// Supported languages.
///
/// The string codes (`"en"`, `"zh-CN"`, `"ja"`) line up with
/// the frontend's i18n locale identifiers AND with the BCP-47
/// tags NSSpellChecker accepts (it maps `"zh-CN"` to its
/// Simplified Chinese checker internally).
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
