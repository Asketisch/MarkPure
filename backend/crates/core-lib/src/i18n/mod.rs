//! Locale + translation registry.
//!
//! At startup the renderer asks `get_locale_codes()` for the
//! list of supported locales and `get_translations(code)` for
//! the actual `key → value` map. We keep a [`OnceLock`]
//! cache so the data is built once and reused across calls.
//!
//! The actual translation tables live in per-locale modules
//! (one file per language) so the data is split by language
//! rather than by topic. To add a new key:
//!
//!  1. Add the (key, value) pair to all three of
//!     [`en`], [`zh_CN`], [`ja`].
//!  2. If the key is brand-new, also document the new key
//!     in `i18n.md` (or wherever the design lives).
//!
//! Splitting by language keeps each file small and lets a
//! translator work on a single language without seeing the
//! other two cluttering their diff.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;

mod en;
mod ja;
mod zh_cn;

// ============================== Types ==============================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocaleConfig {
    pub current: String,
}

impl Default for LocaleConfig {
    fn default() -> Self {
        Self {
            current: "en".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranslationEntry {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Locale {
    pub code: String,
    pub name: String,
    pub translations: HashMap<String, String>,
}

impl Locale {
    pub fn new(code: &str, name: &str) -> Self {
        Self {
            code: code.to_string(),
            name: name.to_string(),
            translations: HashMap::new(),
        }
    }

    pub fn with_translations(mut self, translations: &[(&str, &str)]) -> Self {
        for (k, v) in translations {
            self.translations.insert(k.to_string(), v.to_string());
        }
        self
    }
}

// ============================== Public API ==============================

/// Build the list of every supported locale + its full
/// translation table. Called from the cached initialiser in
/// `get_translations`; not typically called directly.
pub fn get_all_locales() -> Vec<Locale> {
    vec![
        Locale::new("en", "English").with_translations(en::ENTRIES),
        Locale::new("zh-CN", "简体中文").with_translations(zh_cn::ENTRIES),
        Locale::new("ja", "日本語").with_translations(ja::ENTRIES),
    ]
}

/// Return the available locale codes + human-readable names.
/// Used by the renderer's `get_locale` IPC.
pub fn get_locale_codes() -> Vec<(String, String)> {
    get_all_locales()
        .into_iter()
        .map(|l| (l.code, l.name))
        .collect()
}

// Lazy cache so the heavy `get_all_locales()` walk only runs
// on first call.
static TRANSLATIONS_CACHE: OnceLock<HashMap<String, HashMap<String, String>>> =
    OnceLock::new();

/// Return the translation map for `locale`. Falls back to
/// English if the requested locale is unknown (e.g. the user
/// typed a typo in the language picker). Returns an empty
/// map only if even English is missing.
pub fn get_translations(locale: &str) -> HashMap<String, String> {
    let cache = TRANSLATIONS_CACHE.get_or_init(|| {
        let mut m = HashMap::new();
        for loc in get_all_locales() {
            m.insert(loc.code, loc.translations);
        }
        m
    });

    cache
        .get(locale)
        .cloned()
        .unwrap_or_else(|| cache.get("en").cloned().unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    /// Guards against the P11-style bug class: someone adds a key to
    /// `en.rs` but forgets to mirror it into `zh_cn.rs` or `ja.rs`.
    /// The renderer then silently falls back to displaying the raw
    /// key as text, which is the symptom this regression test exists
    /// to prevent.
    #[test]
    fn all_locales_have_same_key_set() {
        let locales = get_all_locales();
        let en_keys: HashSet<&str> = locales
            .iter()
            .find(|l| l.code == "en")
            .expect("English locale must exist")
            .translations
            .keys()
            .map(String::as_str)
            .collect();
        for loc in &locales {
            let keys: HashSet<&str> =
                loc.translations.keys().map(String::as_str).collect();
            assert_eq!(
                keys, en_keys,
                "locale {} has a different key set than English",
                loc.code
            );
        }
    }
}
