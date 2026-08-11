//! Mermaid syntax validation: cheap, no-`mmdc` heuristics
//! for the editor to decide whether to ship a diagram to the
//! renderer.
//!
//! Extracted from `mermaid.rs` so the predicates (`is_table_row`,
//! `are_brackets_balanced`, `DiagramType::from_code`) live in one
//! place and can be unit-tested without dragging in the
//! `Command::spawn` rendering pipeline.

/// Mermaid diagram type. The `Unknown` variant is the catch-all
/// for code we can't classify — typically prose accidentally
/// typed inside a `\`\`\`mermaid` fence.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
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

/// Conservative heuristic — we only reject what we can prove wrong
/// without a full parser pass:
///   - Empty input is invalid (nothing to render).
///   - Unbalanced brackets are invalid.
///   - A non-empty body that doesn't start with any recognised
///     diagram-type keyword is suspicious and rejected. Empty
///     body is already rejected by the first check.
///
/// We deliberately do *not* try to validate the diagram body
/// itself — that's `mmdc`'s job. False positives (rejecting a
/// block that mmdc would have rendered) are far less surprising
/// than false negatives (silently passing `""` or `some prose`
/// to mmdc and getting back a generic syntax error).
pub fn validate_mermaid(code: &str) -> bool {
    let trimmed = code.trim();

    if trimmed.is_empty() {
        return false;
    }

    if !are_brackets_balanced(trimmed) {
        return false;
    }

    if DiagramType::from_code(trimmed) == DiagramType::Unknown {
        return false;
    }

    true
}

/// Check if brackets are balanced in a string. Used by
/// `validate_mermaid` to catch the most common syntax error
/// before shelling out to `mmdc`.
pub fn are_brackets_balanced(s: &str) -> bool {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_balanced_brackets() {
        assert!(are_brackets_balanced("graph TD\n    A[Start] --> B[End]"));
        assert!(!are_brackets_balanced("graph TD\n    A[Start --> B[End]"));
    }

    #[test]
    fn test_diagram_type_detection() {
        assert_eq!(DiagramType::from_code("graph TD"), DiagramType::Flowchart);
        assert_eq!(DiagramType::from_code("flowchart LR"), DiagramType::Flowchart);
        assert_eq!(DiagramType::from_code("sequenceDiagram"), DiagramType::Sequence);
        assert_eq!(DiagramType::from_code("classDiagram"), DiagramType::Class);
        assert_eq!(
            DiagramType::from_code("stateDiagram-v2"),
            DiagramType::State
        );
        assert_eq!(DiagramType::from_code("erDiagram"), DiagramType::EntityRelationship);
        assert_eq!(DiagramType::from_code("gantt"), DiagramType::Gantt);
        assert_eq!(DiagramType::from_code("pie"), DiagramType::Pie);
        assert_eq!(DiagramType::from_code("timeline"), DiagramType::Timeline);
        assert_eq!(DiagramType::from_code("mindmap"), DiagramType::MindMap);
    }

    #[test]
    fn test_validate_mermaid() {
        let valid = "graph TD\n    A[Start] --> B[End]";
        assert!(validate_mermaid(valid));

        let invalid = "graph TD\n    A[Start --> B[End]"; // Missing ]
        assert!(!validate_mermaid(invalid));

        // Empty code is invalid (nothing to render).
        assert!(!validate_mermaid(""));

        // Whitespace-only is invalid.
        assert!(!validate_mermaid("   \n\t  "));

        // Unknown diagram type is invalid.
        assert!(!validate_mermaid("just some prose without a diagram type"));
    }
}