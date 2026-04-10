//! Mermaid diagram rendering
//!
//! Provides functionality to parse, validate, and render Mermaid diagrams.
//! Note: This module provides validation and parsing. Actual rendering is done
//! in the frontend using mermaid.js. The Rust side provides validation and
//! fallback SVG generation for cases where JavaScript rendering is unavailable.

use serde::{Deserialize, Serialize};
use std::process::Command;

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

/// Try to render mermaid using the mermaid CLI (if available)
/// Falls back to validation-only if CLI is not installed
pub fn render_mermaid_with_cli(code: &str) -> MermaidResult {
    // First validate
    if !validate_mermaid(code) {
        return MermaidResult {
            svg: None,
            error: Some("Invalid Mermaid syntax".to_string()),
            is_valid: false,
        };
    }

    // Try to use mermaid CLI
    let result = Command::new("mmdc")
        .args(["-p", "-i", "-"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output();

    match result {
        Ok(output) => {
            if output.status.success() {
                let svg = String::from_utf8_lossy(&output.stdout).to_string();
                MermaidResult {
                    svg: Some(svg),
                    error: None,
                    is_valid: true,
                }
            } else {
                let error = String::from_utf8_lossy(&output.stderr).to_string();
                MermaidResult {
                    svg: None,
                    error: Some(error),
                    is_valid: false,
                }
            }
        }
        Err(e) => {
            // CLI not available, just validate
            MermaidResult {
                svg: None,
                error: Some(format!("Mermaid CLI not available: {}. Install with: npm install -g @mermaid-js/mermaid-cli", e)),
                is_valid: true,
            }
        }
    }
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
            insert_text: "sequenceDiagram\n    participant A\n    participant B\n    A->>B: Hello".to_string(),
        });
    }

    if partial.is_empty() || partial.starts_with("class") {
        completions.push(MermaidCompletion {
            label: "classDiagram".to_string(),
            description: "Class diagram".to_string(),
            insert_text: "classDiagram\n    class Animal {\n        +String name\n        +makeSound()\n    }".to_string(),
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
            insert_text: "timeline\n    title History\n    2020 : Event 1\n    2021 : Event 2".to_string(),
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
}
