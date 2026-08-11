//! Markdown stripping and footnote substitution helpers used by
//! the PDF export pipeline.
//!
//! `strip_markdown` produces a "plain-ish" rendering for fallback
//! text (e.g. when font shaping fails or the user asks for plain
//! output). It's intentionally conservative: it preserves the
//! text content but doesn't try to preserve every typographic
//! detail. `substitute_footnote_refs` rewrites the inline
//! `[^N]` markers into numbered references and returns the
//! matching footnote definitions, ready to be appended at the
//! end of the document.

// `markdown` is an external crate dep. We reference it via
// `markdown::FootnoteDef` directly — no explicit `use` needed
// since the Rust 2018+ extern prelude auto-imports crates
// declared in `Cargo.toml`.

/// Best-effort markdown → plain text. Strips emphasis markers
/// (bold, italic, strikethrough), code, link URLs (keeping the
/// visible text), image-bang prefixes, and rewrites footnote
/// references to `[label]`. The actual numbering of footnote
/// references is applied later by `substitute_footnote_refs`.
pub fn strip_markdown(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        // Bold: **text** or __text__
        if i + 1 < chars.len()
            && (chars[i] == '*' && chars[i + 1] == '*'
                || chars[i] == '_' && chars[i + 1] == '_')
        {
            i += 2;
            continue;
        }
        // Italic: *text* or _text_
        if chars[i] == '*' || chars[i] == '_' {
            i += 1;
            continue;
        }
        // Strikethrough: ~~text~~
        if i + 1 < chars.len() && chars[i] == '~' && chars[i + 1] == '~' {
            i += 2;
            continue;
        }
        // Code: `text`
        if chars[i] == '`' {
            i += 1;
            continue;
        }
        // Footnote reference: [^id] — emit as `[id]` later in a
        // second pass, but at this stage strip the `^` so the
        // body text becomes "[id]". The actual numbering happens
        // in `substitute_footnote_refs` after the document scan.
        if chars[i] == '['
            && i + 1 < chars.len()
            && chars[i + 1] == '^'
            && i + 2 < chars.len()
            && chars[i + 2] != ']'
        {
            // Skip the `^`, then the label until the closing `]`.
            // We emit `[label]` (the surrounding brackets are kept
            // so the marker is visually distinct).
            result.push('[');
            i += 2; // skip [ and ^
            while i < chars.len() && chars[i] != ']' {
                result.push(chars[i]);
                i += 1;
            }
            if i < chars.len() {
                result.push(']');
                i += 1; // skip ]
            }
            continue;
        }
        // Links: [text](url)
        if chars[i] == '[' {
            // Skip until ]
            while i < chars.len() && chars[i] != ']' {
                result.push(chars[i]);
                i += 1;
            }
            // Skip ](url)
            if i < chars.len() {
                i += 1; // skip ]
            }
            if i < chars.len() && chars[i] == '(' {
                while i < chars.len() && chars[i] != ')' {
                    i += 1;
                }
                if i < chars.len() {
                    i += 1; // skip )
                }
            }
            continue;
        }
        // Images: ![alt](url) — skip the ! but keep alt text
        if chars[i] == '!' && i + 1 < chars.len() && chars[i + 1] == '[' {
            i += 1; // skip !
            continue;
        }
        result.push(chars[i]);
        i += 1;
    }

    result
}

/// Post-process the stripped text to substitute `[label]` footnote
/// references with the document-order number `[N]`. Defined
/// references are remapped; any `[^label]` that doesn't have a
/// matching definition is left as-is so the user can spot broken
/// references in the exported PDF.
pub fn substitute_footnote_refs(text: &str, footnotes: &[markdown::FootnoteDef]) -> String {
    if footnotes.is_empty() {
        return text.to_string();
    }
    // Build a label→number map from the pre-collected footnotes.
    let mut out = String::with_capacity(text.len());
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '['
            && i + 1 < chars.len()
            && chars[i + 1] == '^'
            && i + 2 < chars.len()
            && chars[i + 2] != ']'
        {
            // Already converted by `strip_markdown` to `[label]`,
            // which is now what we see. We rewrite to `[N]`.
            let label_start = i + 2;
            let mut label_end = label_start;
            while label_end < chars.len() && chars[label_end] != ']' {
                label_end += 1;
            }
            let label: String = chars[label_start..label_end].iter().collect();
            let num = footnotes.iter().find(|n| n.label == label).map(|n| n.number);
            out.push('[');
            match num {
                Some(n) => out.push_str(&n.to_string()),
                None => {
                    out.push('^');
                    out.push_str(&label);
                }
            }
            out.push(']');
            i = if label_end < chars.len() { label_end + 1 } else { label_end };
            continue;
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_markdown_inline() {
        let out = strip_markdown("`x = 1` and **bold** text");
        assert_eq!(out, "x = 1 and bold text");
    }
}