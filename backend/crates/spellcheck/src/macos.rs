//! macOS `NSSpellChecker` bridge.
//!
//! This module is compiled only on macOS. It wraps the system
//! `NSSpellChecker` to provide CJK + native English spell
//! checking with **zero** bundled dictionary cost (the
//! dictionaries are part of macOS itself, hundreds of MB
//! lazy-loaded by the OS).
//!
//! ## Threading
//!
//! `NSSpellChecker::sharedSpellChecker()` is documented as
//! safe to call off the main thread, but downstream calls
//! like `setLanguage:` and `checkString:` are NOT documented
//! as thread-safe. The desktop app's `editor_ops.rs` IPC
//! handler dispatches each spell-check request to the main
//! thread via `EventLoopProxy::send_event(SpellCheckRequest)`
//! and `Event::UserEvent` in `main.rs` invokes
//! `check_with_nsspellchecker` from the tao event loop,
//! which IS the main thread. Calling this function from a
//! worker thread is unsupported and may crash.
//!
//! ## UTF-16 ↔ UTF-8
//!
//! `NSString` and the `NSRange` it returns are in UTF-16 code
//! units. Our [`SpellError`] reports UTF-8 byte offsets — the
//! shape the existing English path and frontend already use.
//! We walk the input string once to build a UTF-16 → UTF-8
//! offset map so each NSRange can be O(1) translated. BMP
//! characters (every CJK char + ASCII) are one UTF-16 unit;
//! emoji and surrogate pairs are two units but are not
//! returned as spelling results in practice.

use crate::types::SpellError;
use objc2::rc::Retained;
use objc2_app_kit::NSSpellChecker;
use objc2_foundation::{NSRange, NSString, NSTextCheckingType};

/// Run `text` through the system `NSSpellChecker` and return
/// per-misspelling errors with up to 5 suggestions each.
///
/// `lang` is a BCP-47 tag (e.g. `"en"`, `"zh-CN"`, `"ja"`);
/// `NSSpellChecker::setLanguage:` returns `false` if it
/// doesn't recognize the tag — we log to stderr and fall back
/// to the user's default language in that case rather than
/// hard-erroring (the user still gets *some* checker, just
/// not the one they asked for).
///
/// MUST run on the main thread; see module docs.
pub fn check_with_nsspellchecker(text: &str, lang: &str) -> Vec<SpellError> {
    if text.is_empty() {
        return Vec::new();
    }

    // SAFETY: NSSpellChecker::sharedSpellChecker is the
    // canonical accessor for the per-process singleton; objc2
    // returns a +1 retained handle.
    let checker: Retained<NSSpellChecker> = unsafe { NSSpellChecker::sharedSpellChecker() };

    // SAFETY: setLanguage: is documented to accept any
    // BCP-47 string and return false if it isn't recognized.
    // We don't surface the failure as an error — the system
    // will fall back to the user's default language, which
    // is the friendly outcome for an unsupported tag.
    let lang_ns = NSString::from_str(lang);
    let _ok = unsafe { checker.setLanguage(&lang_ns) };

    let text_ns = NSString::from_str(text);
    let total_units = text_ns.length();
    let full_range = NSRange { location: 0, length: total_units };

    // Batch check the whole string. We pass only the Spelling
    // type so we don't get spurious grammar / smart-quote /
    // date-detection hits in the output stream.
    //
    // `inSpellDocumentWithTag: 0` means "don't track this
    // call as part of a long-running document session" — we
    // use 0 because each IPC request is stateless.
    let results: Retained<objc2_foundation::NSArray<objc2_foundation::NSTextCheckingResult>> = unsafe {
        checker.checkString_range_types_options_inSpellDocumentWithTag_orthography_wordCount(
            &text_ns,
            full_range,
            NSTextCheckingType::Spelling.bits(),
            None,
            0,
            None,
            std::ptr::null_mut(),
        )
    };

    let count = results.count();
    if count == 0 {
        return Vec::new();
    }

    // Build the UTF-16 → UTF-8 byte offset map. text.encode_utf16()
    // yields exactly the same code units NSString uses, so the
    // index lines up perfectly with NSRange.location / length.
    let utf16_to_utf8 = build_utf16_to_utf8_map(text);

    let mut errors = Vec::with_capacity(count);
    for i in 0..count {
        let result = unsafe { results.objectAtIndex(i) };
        let range = unsafe { result.range() };

        // Translate UTF-16 (location, length) to UTF-8 (start, end).
        let start_u16 = range.location as usize;
        let end_u16 = start_u16 + range.length as usize;
        let Some(&start_byte) = utf16_to_utf8.get(start_u16) else {
            continue;
        };
        let Some(&end_byte) = utf16_to_utf8.get(end_u16) else {
            continue;
        };
        if start_byte >= text.len() || end_byte > text.len() || start_byte >= end_byte {
            continue;
        }
        let word = match text.get(start_byte..end_byte) {
            Some(w) => w.to_string(),
            None => continue,
        };

        // Suggestions are a second NSSpellChecker call per
        // misspelling — the batch checkString: doesn't return
        // them inline. The OS caches per-word lookups so the
        // amortized cost is small for typical document sizes.
        let suggestions = unsafe {
            checker
                .guessesForWordRange_inString_language_inSpellDocumentWithTag(
                    range, &text_ns, Some(&lang_ns), 0,
                )
                .map(|arr| {
                    let n = arr.count();
                    let mut out = Vec::with_capacity(n.min(5));
                    for j in 0..n.min(5) {
                        out.push(arr.objectAtIndex(j).to_string());
                    }
                    out
                })
                .unwrap_or_default()
        };

        errors.push(SpellError {
            word,
            start: start_byte,
            end: end_byte,
            suggestions,
        });
    }

    errors
}

/// Build a map from UTF-16 code-unit offset → UTF-8 byte
/// offset for the given string. The last entry maps the
/// end-of-string position so `[..end]` slicing works without
/// special-casing.
///
/// Both encodings count code units, so the map has
/// `text.encode_utf16().count() + 1` entries. For ASCII +
/// BMP CJK text — the dominant case — each char contributes
/// one UTF-16 unit and 1-3 UTF-8 bytes; for an emoji (two
/// UTF-16 surrogates) we record both surrogate positions
/// pointing at the start of the emoji's UTF-8 bytes, which
/// preserves the invariant `map[location + length]` ==
/// "byte just past the last char of the range".
fn build_utf16_to_utf8_map(text: &str) -> Vec<usize> {
    let mut map = Vec::with_capacity(text.len() + 1);
    for (byte_idx, ch) in text.char_indices() {
        // A char is either 1 or 2 UTF-16 units. Push one
        // entry per surrogate so NSRange offsets can land
        // mid-emoji without panicking.
        for _ in 0..ch.len_utf16() {
            map.push(byte_idx);
        }
    }
    map.push(text.len());
    map
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_utf16_to_utf8_map_ascii() {
        let map = build_utf16_to_utf8_map("hello");
        assert_eq!(map, vec![0, 1, 2, 3, 4, 5]);
    }

    #[test]
    fn test_utf16_to_utf8_map_cjk() {
        // Each CJK char is 3 UTF-8 bytes and 1 UTF-16 unit.
        let map = build_utf16_to_utf8_map("你好");
        // After "你" (byte 0-2): UTF-16 idx 0 → byte 0
        // After "好" (byte 3-5): UTF-16 idx 1 → byte 3
        // End marker: UTF-16 idx 2 → byte 6
        assert_eq!(map, vec![0, 3, 6]);
    }

    #[test]
    fn test_utf16_to_utf8_map_mixed() {
        // ASCII + CJK + ASCII
        let map = build_utf16_to_utf8_map("a你b");
        // 'a' is 1 byte 1 unit; '你' is 3 bytes 1 unit; 'b' is 1 byte 1 unit
        assert_eq!(map, vec![0, 1, 4, 5]);
    }

    // Note: live NSSpellChecker calls are NOT covered by unit
    // tests because they require a main-thread Cocoa runtime
    // and are wildly slow to spin up under `cargo test`.
    // The integration is verified by the manual macOS test
    // matrix in the plan (Phase 4).
}
