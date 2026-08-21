use crate::state::{lock_or_recover, AppState};
// ============================== i18n ==============================

pub fn cmd_get_locale(state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let locales = mt_core::i18n::get_locale_codes();
    let config = lock_or_recover(&state.config);
    let current = config.language.clone().unwrap_or_else(|| "en".to_string());
    let translations = mt_core::i18n::get_translations(&current);
    Ok(serde_json::json!({
        "current": current,
        "available": locales,
        "translations": translations,
    }))
}

pub fn cmd_set_locale(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let lang = params["lang"].as_str().ok_or("Missing 'lang' parameter")?;
    {
        let mut config = lock_or_recover(&state.config);
        config.set_language(Some(lang.to_string()));
    }
    state.save_config();
    Ok(serde_json::Value::Null)
}

pub fn cmd_get_translations(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let lang = params["lang"].as_str().unwrap_or("en");
    let translations = mt_core::i18n::get_translations(lang);
    serde_json::to_value(translations).map_err(|e| e.to_string())
}
