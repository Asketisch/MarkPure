//! Mermaid rendering pipeline — spawns `mmdc`, caches SVG/PNG
//! results in a process-wide LRU, and exposes both cached and
//! uncached entry points to the rest of the crate.
//!
//! Extracted from `mermaid.rs` so the `Command::new("mmdc")` +
//! temp-file dance and the per-format cache lives in one file
//! instead of being interleaved with validation, suggestions
//! and parsing logic.
//!
//! Two caches live here:
//! - `SVG_CACHE` keyed on the diagram source → `MermaidResult`
//!   (used by the editor's live preview and the HTML export).
//! - `PNG_CACHE` keyed on the diagram source → raw PNG bytes
//!   (used by the PDF and DOCX export pipelines).
//!
//! We deliberately *don't* cache the "mmdc not installed"
//! fallback result in `SVG_CACHE` — see `render_mermaid_to_svg_cached`
//! for the rationale.

use lru::LruCache;
use std::num::NonZeroUsize;
use std::process::Command;
use std::sync::Mutex;

use super::validate::validate_mermaid;

/// Maximum number of diagrams kept in the LRU cache. 64 is plenty for
/// a typical document; the cache is process-global so we use a smaller
/// number than per-document caches.
pub(super) const CACHE_CAPACITY: usize = 64;

/// Process-wide LRU cache for SVG render results. The cache key is the
/// raw diagram source; the value is the `MermaidResult` (which carries
/// the SVG string, an optional error message, and the validity flag).
pub(super) static SVG_CACHE: once_cell::sync::Lazy<Mutex<LruCache<String, MermaidResult>>> =
    once_cell::sync::Lazy::new(|| {
        Mutex::new(LruCache::new(NonZeroUsize::new(CACHE_CAPACITY).unwrap()))
    });

/// Process-wide LRU cache for PNG render results (raw byte payload).
pub(super) static PNG_CACHE: once_cell::sync::Lazy<Mutex<LruCache<String, Vec<u8>>>> =
    once_cell::sync::Lazy::new(|| {
        Mutex::new(LruCache::new(NonZeroUsize::new(CACHE_CAPACITY).unwrap()))
    });

/// Re-export the result type so callers can `use mermaid::render::*`
/// without reaching into the parent module.
pub(super) use super::types::MermaidResult;

/// Returns `true` if the `mmdc` CLI is installed and the user has not
/// explicitly disabled it via the `MMDC_DISABLED` environment variable.
/// The env var is honoured in tests so we can force the fallback path
/// without actually invoking the CLI.
pub(super) fn mmdc_available() -> bool {
    if std::env::var_os("MMDC_DISABLED").is_some() {
        return false;
    }
    // `which` is not a crate dependency; do a PATH lookup ourselves for
    // the few common install locations. We don't need exhaustive coverage
    // — if mmdc is on PATH elsewhere, the actual Command spawn will succeed.
    let candidates: &[&str] = if cfg!(target_os = "windows") {
        &["mmdc.cmd", "mmdc.exe", "mmdc"]
    } else {
        &["mmdc"]
    };
    if let Ok(paths) = std::env::var("PATH") {
        let sep = if cfg!(target_os = "windows") { ';' } else { ':' };
        for dir in paths.split(sep) {
            for cand in candidates {
                let p = std::path::Path::new(dir).join(cand);
                if p.exists() {
                    return true;
                }
            }
        }
    }
    // Fall back: try spawn with no path; if it succeeds, mmdc is on PATH
    Command::new("mmdc").arg("--version").output().is_ok()
}

/// Inner (uncached) implementation that calls `mmdc` to produce an SVG.
/// This is the function that actually shells out to the Mermaid CLI.
///
/// `mmdc` doesn't read from stdin; it requires a real input file. We
/// write the diagram to a temp file, point `mmdc` at it, and read the
/// SVG output. If `mmdc` isn't installed (no executable in PATH), we
/// gracefully fall back to validation-only so the caller can still
/// show the original code block.
pub(super) fn render_mermaid_to_svg_inner(code: &str) -> MermaidResult {
    // First validate
    if !validate_mermaid(code) {
        return MermaidResult {
            svg: None,
            error: Some("Invalid Mermaid syntax".to_string()),
            is_valid: false,
        };
    }

    if !mmdc_available() {
        return MermaidResult {
            svg: None,
            error: Some(
                "Mermaid CLI (mmdc) not available. Install with: npm install -g @mermaid-js/mermaid-cli"
                    .to_string(),
            ),
            is_valid: true,
        };
    }

    let tmp_dir = std::env::temp_dir().join(format!("markpure-mmd-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&tmp_dir);
    let in_path = tmp_dir.join("diagram.mmd");
    let out_path = tmp_dir.join("diagram.svg");

    if let Err(e) = std::fs::write(&in_path, code) {
        return MermaidResult {
            svg: None,
            error: Some(format!("failed to write temp input: {}", e)),
            is_valid: false,
        };
    }

    let result = Command::new("mmdc")
        .args([
            "-i",
            in_path.to_string_lossy().as_ref(),
            "-o",
            out_path.to_string_lossy().as_ref(),
            "-q",
        ])
        .output();

    let _ = std::fs::remove_file(&in_path);

    match result {
        Ok(output) if output.status.success() => match std::fs::read_to_string(&out_path) {
            Ok(svg) => {
                let _ = std::fs::remove_file(&out_path);
                MermaidResult {
                    svg: Some(svg),
                    error: None,
                    is_valid: true,
                }
            }
            Err(e) => {
                let _ = std::fs::remove_file(&out_path);
                MermaidResult {
                    svg: None,
                    error: Some(format!("mmdc succeeded but output unreadable: {}", e)),
                    is_valid: false,
                }
            }
        },
        Ok(output) => {
            let _ = std::fs::remove_file(&out_path);
            let error = String::from_utf8_lossy(&output.stderr).to_string();
            MermaidResult {
                svg: None,
                error: Some(if error.is_empty() {
                    "mmdc failed (no stderr)".into()
                } else {
                    error
                }),
                is_valid: false,
            }
        }
        Err(_) => {
            // CLI not installed. We deliberately treat this as a
            // soft failure (is_valid: true) so the editor can
            // show the original mermaid source instead of an
            // error — installing mmdc is a *user choice*, not a
            // code bug.
            MermaidResult {
                svg: None,
                error: Some(
                    "Mermaid CLI (mmdc) not available. Install with: npm install -g @mermaid-js/mermaid-cli"
                        .to_string(),
                ),
                is_valid: true,
            }
        }
    }
}

/// Cached SVG render. Identical source returns the same `MermaidResult`
/// without re-invoking `mmdc`. Used by the HTML export pipeline and the
/// editor's live rendering IPC.
///
/// We only cache successful renders (`svg.is_some()`) and validation
/// failures (`is_valid == false`). The "mmdc not installed" fallback
/// is intentionally NOT cached: if the user installs `mmdc` after the
/// app is already running, every cached "not available" entry would
/// otherwise pin the failure for the rest of the process lifetime.
/// Skipping the cache for that specific `MermaidResult` shape means
/// the next call re-checks `mmdc_available()` and can recover
/// without a restart.
pub fn render_mermaid_to_svg_cached(code: &str) -> MermaidResult {
    if let Ok(mut cache) = SVG_CACHE.lock() {
        if let Some(cached) = cache.get(code) {
            // Skip the cache for the "soft fallback" result shape.
            // The renderer marks this with `is_valid: true` and no SVG,
            // which is uniquely the mmdc-not-available path.
            if cached.svg.is_some() || !cached.is_valid {
                return cached.clone();
            }
        }
    }

    let result = render_mermaid_to_svg_inner(code);

    if result.svg.is_some() || !result.is_valid {
        if let Ok(mut cache) = SVG_CACHE.lock() {
            cache.put(code.to_string(), result.clone());
        }
    }

    result
}

/// Inner (uncached) implementation that calls `mmdc` to produce a PNG
/// by passing the `-e png` (extension) flag.
pub(super) fn render_mermaid_to_png_inner(code: &str) -> Result<Vec<u8>, String> {
    if !validate_mermaid(code) {
        return Err("Invalid Mermaid syntax".to_string());
    }

    if !mmdc_available() {
        return Err(
            "Mermaid CLI (mmdc) not available. Install with: npm install -g @mermaid-js/mermaid-cli"
                .to_string(),
        );
    }

    let tmp_dir = std::env::temp_dir().join(format!("markpure-mmd-png-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&tmp_dir);
    let in_path = tmp_dir.join("diagram.mmd");
    let out_path = tmp_dir.join("diagram.png");

    if let Err(e) = std::fs::write(&in_path, code) {
        return Err(format!("failed to write temp input: {}", e));
    }

    let result = Command::new("mmdc")
        .args([
            "-i",
            in_path.to_string_lossy().as_ref(),
            "-o",
            out_path.to_string_lossy().as_ref(),
            "-e",
            "png",
            "-q",
        ])
        .output();

    let _ = std::fs::remove_file(&in_path);

    match result {
        Ok(output) if output.status.success() => match std::fs::read(&out_path) {
            Ok(bytes) => {
                let _ = std::fs::remove_file(&out_path);
                Ok(bytes)
            }
            Err(e) => {
                let _ = std::fs::remove_file(&out_path);
                Err(format!("mmdc succeeded but output unreadable: {}", e))
            }
        },
        Ok(output) => {
            let _ = std::fs::remove_file(&out_path);
            let error = String::from_utf8_lossy(&output.stderr).to_string();
            Err(if error.is_empty() {
                "mmdc failed (no stderr)".into()
            } else {
                error
            })
        }
        Err(_) => Err(
            "Mermaid CLI (mmdc) not available. Install with: npm install -g @mermaid-js/mermaid-cli"
                .to_string(),
        ),
    }
}

/// Cached PNG render. Returns PNG bytes suitable for embedding in
/// PDF and DOCX. Used by the PDF and DOCX export pipelines.
pub fn render_mermaid_to_png_cached(code: &str) -> Result<Vec<u8>, String> {
    if let Ok(mut cache) = PNG_CACHE.lock() {
        if let Some(cached) = cache.get(code) {
            return Ok(cached.clone());
        }
    }

    let bytes = render_mermaid_to_png_inner(code)?;

    if let Ok(mut cache) = PNG_CACHE.lock() {
        cache.put(code.to_string(), bytes.clone());
    }

    Ok(bytes)
}

/// Backward-compatible entry point used by the editor's IPC
/// (`cmd_render_mermaid`). Delegates to the cached SVG variant so the
/// editor and exports share the same LRU.
pub fn render_mermaid_with_cli(code: &str) -> MermaidResult {
    render_mermaid_to_svg_cached(code)
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_render_mermaid_unavailable_returns_soft_error() {
        // Force the fallback path without touching the host's
        // actual `mmdc` install.
        std::env::set_var("MMDC_DISABLED", "1");
        let result = render_mermaid_to_svg_cached("graph TD\n    A --> B");
        // Soft failure: code was valid but mmdc is missing.
        assert!(result.svg.is_none());
        assert!(result.is_valid);
        assert!(result.error.is_some());
        std::env::remove_var("MMDC_DISABLED");
    }

    #[test]
    fn test_render_mermaid_invalid_syntax_is_hard_error() {
        std::env::set_var("MMDC_DISABLED", "1");
        // Unbalanced bracket → validate_mermaid returns false →
        // the renderer must surface a hard error, not the
        // soft "mmdc missing" path.
        let result = render_mermaid_to_svg_cached("graph TD\n    A[ --> B");
        assert!(result.svg.is_none());
        assert!(!result.is_valid);
        assert!(result.error.is_some());
        std::env::remove_var("MMDC_DISABLED");
    }

    #[test]
    fn test_render_mermaid_png_unavailable_returns_error() {
        std::env::set_var("MMDC_DISABLED", "1");
        let result = render_mermaid_to_png_cached("graph TD\n    A --> B");
        assert!(result.is_err());
        std::env::remove_var("MMDC_DISABLED");
    }
}
