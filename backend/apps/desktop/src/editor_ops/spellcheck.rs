//! Spell check: dispatch NSSpellChecker on the main thread.
//!
//! Why this lives in its own file: `cmd_check_spelling` is the
//! only editor_ops handler that crosses thread boundaries (it
//! uses `state.proxy` to bounce a request to the tao event loop's
//! main thread). Keeping it isolated makes the cross-thread
//! contract easy to find and the test surface small.

use crate::state::{lock_or_recover, AppEvent, AppState};

/// Forward the spell-check request to the tao event loop's
/// main thread (where NSSpellChecker can be safely called),
/// then synchronously wait for the result on a one-shot
/// channel.
///
/// Why the indirection: the IPC handler runs on the wry
/// callback thread, NOT the main thread. NSSpellChecker on
/// macOS only guarantees safety from the main thread. The
/// non-macOS fallback path runs in the same event-loop arm
/// for uniformity even though it has no thread requirement.
///
/// The wait is bounded by a 5-second timeout. If the event
/// loop is wedged (the WebView is repainting a huge frame,
/// say), the IPC fails cleanly rather than blocking the
/// renderer forever — the frontend's spellcheck plugin will
/// simply not produce decorations for that batch and try
/// again on the next debounce.
pub fn cmd_check_spelling(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let text = params["text"].as_str().ok_or("Missing 'text' parameter")?;
    let lang = params.get("lang").and_then(|v| v.as_str()).unwrap_or("en");

    // Build the request. SyncSender(1) is one-shot — we send
    // exactly one reply per request, and the sender drops as
    // soon as the event loop arm completes.
    let (tx, rx) = std::sync::mpsc::sync_channel::<Result<Vec<spellcheck::SpellError>, String>>(1);
    let event = AppEvent::SpellCheckRequest {
        text: text.to_string(),
        lang: lang.to_string(),
        reply: tx,
    };

    // Send to the main thread. The event loop proxy is
    // populated in `main()` immediately after the event loop
    // is built; if it's missing here we have a serious
    // initialization order bug, so return a 5xx-equivalent
    // error rather than panicking.
    {
        let proxy_guard = lock_or_recover(&state.proxy);
        let proxy = proxy_guard
            .as_ref()
            .ok_or_else(|| "event loop proxy not initialized".to_string())?;
        proxy
            .send_event(event)
            .map_err(|e| format!("failed to dispatch spell check: {}", e))?;
    }

    // Bounded wait. Even on a 1MB document NSSpellChecker
    // returns in well under a second; 5s is the cliff for
    // "something is wrong with the event loop".
    let errors = rx
        .recv_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| format!("spell check timed out: {}", e))??;

    let result = spellcheck::SpellCheckResult {
        errors,
        language: lang.to_string(),
    };
    Ok(serde_json::to_value(result).map_err(|e| e.to_string())?)
}
