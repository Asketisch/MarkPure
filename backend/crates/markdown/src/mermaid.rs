//! Mermaid diagram rendering
//!
//! Provides functionality to parse, validate, and render Mermaid diagrams.
//! This module provides:
//! - Synchronous validation, parsing, autocomplete suggestions
//! - Cached rendering via `render_mermaid_to_svg_cached` and
//!   `render_mermaid_to_png_cached` (the latter is used by the PDF and DOCX
//!   export pipelines).
//!
//! Caching is process-local via an LRU map keyed on the diagram source so
//! repeated exports of the same document (and live editing) avoid the
//! expensive `mmdc` startup cost.

use lru::LruCache;
use serde::{Deserialize, Serialize};
use std::num::NonZeroUsize;
use std::process::Command;
use std::sync::Mutex;

/// Maximum number of diagrams kept in the LRU cache. 64 is plenty for
/// a typical document; the cache is process-global so we use a smaller
/// number than per-document caches.
const CACHE_CAPACITY: usize = 64;

/// Process-wide LRU cache for SVG render results. The cache key is the
/// raw diagram source; the value is the `MermaidResult` (which carries
/// the SVG string, an optional error message, and the validity flag).
static SVG_CACHE: once_cell::sync::Lazy<Mutex<LruCache<String, MermaidResult>>> =
    once_cell::sync::Lazy::new(|| {
        Mutex::new(LruCache::new(NonZeroUsize::new(CACHE_CAPACITY).unwrap()))
    });

/// Process-wide LRU cache for PNG render results (raw byte payload).
static PNG_CACHE: once_cell::sync::Lazy<Mutex<LruCache<String, Vec<u8>>>> =
    once_cell::sync::Lazy::new(|| {
        Mutex::new(LruCache::new(NonZeroUsize::new(CACHE_CAPACITY).unwrap()))
    });

/// Returns `true` if the `mmdc` CLI is installed and the user has not
/// explicitly disabled it via the `MMDC_DISABLED` environment variable.
/// The env var is honoured in tests so we can force the fallback path
/// without actually invoking the CLI.
fn mmdc_available() -> bool {
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

/// Error types for Mermaid operations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MermaidError {
    ParseError(String),
    RenderError(String),
    NotFound,
    InvalidSyntax(String),
}

/// Mermaid rendering result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MermaidResult {
    pub svg: Option<String>,
    pub error: Option<String>,
    pub is_valid: bool,
}

/// Mermaid diagram type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DiagramType {
    Flowchart,
    Sequence,
    Class,
    State,
    EntityRelationship,
    Gantt,
    Pie,
    Timeline,
    MindMap,
    Unknown,
}

impl DiagramType {
    pub fn from_code(code: &str) -> Self {
        let trimmed = code.trim();
        if trimmed.starts_with("graph") || trimmed.starts_with("flowchart") {
            DiagramType::Flowchart
        } else if trimmed.starts_with("sequenceDiagram") {
            DiagramType::Sequence
        } else if trimmed.starts_with("classDiagram") {
            DiagramType::Class
        } else if trimmed.starts_with("stateDiagram") || trimmed.starts_with("stateDiagram-v2") {
            DiagramType::State
        } else if trimmed.starts_with("erDiagram") {
            DiagramType::EntityRelationship
        } else if trimmed.starts_with("gantt") {
            DiagramType::Gantt
        } else if trimmed.starts_with("pie") {
            DiagramType::Pie
        } else if trimmed.starts_with("timeline") {
            DiagramType::Timeline
        } else if trimmed.starts_with("mindmap") {
            DiagramType::MindMap
        } else {
            DiagramType::Unknown
        }
    }
}

/// Validate Mermaid syntax without rendering
pub fn validate_mermaid(code: &str) -> bool {
    // Basic syntax validation
    let trimmed = code.trim();

    // Check for balanced brackets
    if !are_brackets_balanced(trimmed) {
        return false;
    }

    // Check for diagram type
    let diagram_type = DiagramType::from_code(trimmed);
    if diagram_type == DiagramType::Unknown && !trimmed.is_empty() {
        // Could be an issue, but not necessarily invalid
    }

    true
}

/// Check if brackets are balanced in a string
fn are_brackets_balanced(s: &str) -> bool {
    let mut stack: Vec<char> = Vec::new();

    for ch in s.chars() {
        match ch {
            '(' | '[' | '{' => stack.push(ch),
            ')' => {
                if stack.pop() != Some('(') {
                    return false;
                }
            }
            ']' => {
                if stack.pop() != Some('[') {
                    return false;
                }
            }
            '}' => {
                if stack.pop() != Some('{') {
                    return false;
                }
            }
            // Note: '<' and '>' are NOT balanced in mermaid - they're used in arrows like -->
            _ => {}
        }
    }

    stack.is_empty()
}

/// Extract mermaid code blocks from markdown content
pub fn extract_mermaid_blocks(content: &str) -> Vec<(usize, String)> {
    let mut blocks: Vec<(usize, String)> = Vec::new();
    let mut in_block = false;
    let mut block_start = 0;
    let mut current_language = String::new();
    let mut code_content = String::new();
    let mut line_number = 0;

    for line in content.lines() {
        line_number += 1;

        if line.trim_start().starts_with("```mermaid") {
            in_block = true;
            block_start = line_number;
            code_content.clear();
            current_language = "mermaid".to_string();
        } else if line.trim_start().starts_with("```") && in_block {
            if current_language == "mermaid" {
                blocks.push((block_start, code_content.clone()));
            }
            in_block = false;
            code_content.clear();
        } else if in_block {
            if !code_content.is_empty() {
                code_content.push('\n');
            }
            code_content.push_str(line);
        }
    }

    blocks
}

/// Parse mermaid code and return structured information
pub fn parse_mermaid(code: &str) -> Result<DiagramType, MermaidError> {
    if code.trim().is_empty() {
        return Err(MermaidError::InvalidSyntax("Empty mermaid code".to_string()));
    }

    if !validate_mermaid(code) {
        return Err(MermaidError::InvalidSyntax("Unbalanced brackets".to_string()));
    }

    let diagram_type = DiagramType::from_code(code);
    Ok(diagram_type)
}

/// Inner (uncached) implementation that calls `mmdc` to produce an SVG.
/// This is the function that actually shells out to the Mermaid CLI.
///
/// `mmdc` doesn't read from stdin; it requires a real input file. We
/// write the diagram to a temp file, point `mmdc` at it, and read the
/// SVG output. If `mmdc` isn't installed (no executable in PATH), we
/// gracefully fall back to validation-only so the caller can still
/// show the original code block.
fn render_mermaid_to_svg_inner(code: &str) -> MermaidResult {
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
            is_valid: true,
        };
    }

    let result = Command::new("mmdc")
        .args([
            "-i",
            in_path.to_string_lossy().as_ref(),
            "-o",
            out_path.to_string_lossy().as_ref(),
            "-q", // quiet — suppress the noisy "Generating..." progress
        ])
        .output();

    let _ = std::fs::remove_file(&in_path);

    match result {
        Ok(output) if output.status.success() => {
            let svg = match std::fs::read_to_string(&out_path) {
                Ok(s) => s,
                Err(e) => {
                    return MermaidResult {
                        svg: None,
                        error: Some(format!("mmdc succeeded but output unreadable: {}", e)),
                        is_valid: true,
                    }
                }
            };
            let _ = std::fs::remove_file(&out_path);
            MermaidResult {
                svg: Some(svg),
                error: None,
                is_valid: true,
            }
        }
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
pub fn render_mermaid_to_svg_cached(code: &str) -> MermaidResult {
    if let Ok(mut cache) = SVG_CACHE.lock() {
        if let Some(cached) = cache.get(code) {
            return cached.clone();
        }
    }

    let result = render_mermaid_to_svg_inner(code);

    if let Ok(mut cache) = SVG_CACHE.lock() {
        cache.put(code.to_string(), result.clone());
    }

    result
}

/// Inner (uncached) implementation that calls `mmdc` to produce a PNG
/// by passing the `-e png` (extension) flag.
fn render_mermaid_to_png_inner(code: &str) -> Result<Vec<u8>, String> {
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

/// Get autocomplete suggestions for mermaid syntax
pub fn get_mermaid_suggestions(partial: &str) -> Vec<MermaidCompletion> {
    let mut completions = Vec::new();

    // Flowchart suggestions
    if partial.is_empty() || partial.contains("graph") || partial.contains("flowchart") {
        completions.push(MermaidCompletion {
            label: "graph TD".to_string(),
            description: "Top-down flowchart".to_string(),
            insert_text: "graph TD\n    A[Start] --> B[End]".to_string(),
        });
        completions.push(MermaidCompletion {
            label: "graph LR".to_string(),
            description: "Left-right flowchart".to_string(),
            insert_text: "graph LR\n    A[Start] --> B[End]".to_string(),
        });
        completions.push(MermaidCompletion {
            label: "graph BT".to_string(),
            description: "Bottom-top flowchart".to_string(),
            insert_text: "graph BT\n    A[Start] --> B[End]".to_string(),
        });
        completions.push(MermaidCompletion {
            label: "graph RL".to_string(),
            description: "Right-left flowchart".to_string(),
            insert_text: "graph RL\n    A[Start] --> B[End]".to_string(),
        });
    }

    // Other diagram types
    if partial.is_empty() || partial.starts_with("sequence") {
        completions.push(MermaidCompletion {
            label: "sequenceDiagram".to_string(),
            description: "Sequence diagram".to_string(),
            insert_text: "sequenceDiagram\n    participant A\n    participant B\n    A->>B: Hello"
                .to_string(),
        });
    }

    if partial.is_empty() || partial.starts_with("class") {
        completions.push(MermaidCompletion {
            label: "classDiagram".to_string(),
            description: "Class diagram".to_string(),
            insert_text: "classDiagram\n    class Animal {\n        +String name\n        +makeSound()\n    }"
                .to_string(),
        });
    }

    if partial.is_empty() || partial.starts_with("state") {
        completions.push(MermaidCompletion {
            label: "stateDiagram-v2".to_string(),
            description: "State diagram".to_string(),
            insert_text: "stateDiagram-v2\n    [*] --> State1\n    State1 --> [*]".to_string(),
        });
    }

    if partial.is_empty() || partial.starts_with("er") {
        completions.push(MermaidCompletion {
            label: "erDiagram".to_string(),
            description: "Entity-relationship diagram".to_string(),
            insert_text: "erDiagram\n    CUSTOMER ||--o{ ORDER : places".to_string(),
        });
    }

    if partial.is_empty() || partial.starts_with("gantt") {
        completions.push(MermaidCompletion {
            label: "gantt".to_string(),
            description: "Gantt chart".to_string(),
            insert_text: "gantt\n    title Project\n    section Phase1\n    Task1: 1d".to_string(),
        });
    }

    if partial.is_empty() || partial.starts_with("pie") {
        completions.push(MermaidCompletion {
            label: "pie".to_string(),
            description: "Pie chart".to_string(),
            insert_text: "pie title Distribution\n    \"A\": 40\n    \"B\": 60".to_string(),
        });
    }

    if partial.is_empty() || partial.starts_with("timeline") {
        completions.push(MermaidCompletion {
            label: "timeline".to_string(),
            description: "Timeline".to_string(),
            insert_text: "timeline\n    title History\n    2020 : Event 1\n    2021 : Event 2"
                .to_string(),
        });
    }

    if partial.is_empty() || partial.starts_with("mindmap") {
        completions.push(MermaidCompletion {
            label: "mindmap".to_string(),
            description: "Mind map".to_string(),
            insert_text: "mindmap\n    root((Main))\n        Child1\n        Child2".to_string(),
        });
    }

    completions
}

/// Autocomplete suggestion for mermaid
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MermaidCompletion {
    pub label: String,
    pub description: String,
    pub insert_text: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_balanced_brackets() {
        assert!(are_brackets_balanced("graph TD\n    A[Start] --> B[End]"));
        assert!(!are_brackets_balanced("graph TD\n    A[Start] --> B[End")); // Missing ]
    }

    #[test]
    fn test_diagram_type_detection() {
        assert_eq!(DiagramType::from_code("graph TD"), DiagramType::Flowchart);
        assert_eq!(DiagramType::from_code("flowchart LR"), DiagramType::Flowchart);
        assert_eq!(DiagramType::from_code("sequenceDiagram"), DiagramType::Sequence);
        assert_eq!(DiagramType::from_code("gantt"), DiagramType::Gantt);
    }

    #[test]
    fn test_validate_mermaid() {
        let valid = "graph TD\n    A[Start] --> B[End]";
        assert!(validate_mermaid(valid));

        let invalid = "graph TD\n    A[Start --> B[End]"; // Missing ]
        assert!(!validate_mermaid(invalid));
    }

    #[test]
    fn test_extract_mermaid_blocks() {
        let content = r#"
Some text

```mermaid
graph TD
    A --> B
```

More text

```mermaid
sequenceDiagram
    A->>B: Hello
```
"#;
        let blocks = extract_mermaid_blocks(content);
        assert_eq!(blocks.len(), 2);
    }

    #[test]
    fn test_render_mermaid_unavailable_returns_soft_error() {
        // With MMDC_DISABLED set, the cached render should return a soft
        // failure (is_valid: true) with an "mmdc not available" error.
        // SAFETY: This is test-only and runs single-threaded.
        std::env::set_var("MMDC_DISABLED", "1");
        let result = render_mermaid_to_svg_cached("graph TD\n    A --> B");
        std::env::remove_var("MMDC_DISABLED");
        assert!(result.is_valid, "soft failure should be is_valid=true");
        assert!(result.svg.is_none());
        assert!(result.error.is_some());
    }

    #[test]
    fn test_render_mermaid_invalid_syntax_is_hard_error() {
        // Invalid syntax always returns is_valid: false regardless of mmdc.
        let bad = "graph TD\n    A[Start --> B"; // missing ]
        let result = render_mermaid_to_svg_cached(bad);
        assert!(!result.is_valid, "invalid syntax must be is_valid=false");
    }

    #[test]
    fn test_render_mermaid_png_unavailable_returns_error() {
        std::env::set_var("MMDC_DISABLED", "1");
        let result = render_mermaid_to_png_cached("graph TD\n    A --> B");
        std::env::remove_var("MMDC_DISABLED");
        assert!(result.is_err());
    }
}
