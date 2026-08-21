//! 语言环境与翻译表注册中心。
//!
//! 启动时渲染器通过 `get_locale_codes()` 获取受支持的语言环境列表，
//! 通过 `get_translations(code)` 获取实际的 `key → value` 映射表。
//! 我们使用 [`OnceLock`] 缓存，让数据只构建一次，跨多次调用复用。
//!
//! 实际的翻译表放在按语言划分的模块中（每种语言一个文件），
//! 这样数据按语言拆分而不是按主题拆分。要新增一个键：
//!
//!  1. 把 (key, value) 键值对同时加到 [`en`]、[`zh_CN`]、[`ja`] 三个模块。
//!  2. 若这是全新的键，还要在 `i18n.md`（或设计文档所在处）中记录该键。
//!
//! 按语言拆分能让每个文件保持小巧，翻译者可以只处理一种语言，
//! 不必看到另外两种语言干扰自己的 diff。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;

mod en;
mod ja;
mod zh_cn;

// ============================== 类型 ==============================

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

// ============================== 公共 API ==============================

/// 构建所有受支持语言环境及其完整翻译表的列表。
/// 由 `get_translations` 中的缓存初始化器调用，通常不直接调用。
pub fn get_all_locales() -> Vec<Locale> {
    vec![
        Locale::new("en", "English").with_translations(en::ENTRIES),
        Locale::new("zh-CN", "简体中文").with_translations(zh_cn::ENTRIES),
        Locale::new("ja", "日本語").with_translations(ja::ENTRIES),
    ]
}

/// 返回可用的语言环境代码及人类可读的名称。
/// 供渲染器的 `get_locale` IPC 使用。
pub fn get_locale_codes() -> Vec<(String, String)> {
    get_all_locales()
        .into_iter()
        .map(|l| (l.code, l.name))
        .collect()
}

// 懒缓存：让开销较大的 `get_all_locales()` 遍历只在首次调用时运行。
static TRANSLATIONS_CACHE: OnceLock<HashMap<String, HashMap<String, String>>> =
    OnceLock::new();

/// 返回指定 `locale` 的翻译映射表。若请求的语言环境未知
/// （例如用户在语言选择器中打错了字），则回退到英文。
/// 仅当连英文都不存在时才返回空映射表。
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

    /// 防止此类翻译键缺失 bug：有人向 `en.rs` 添加了键，却忘记
    /// 同步到 `zh_cn.rs` 或 `ja.rs`。此时渲染器会静默回退，把原始键
    /// 当作文本显示——本回归测试就是为了防止出现这种症状。
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
