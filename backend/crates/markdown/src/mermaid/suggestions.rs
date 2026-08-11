//! Mermaid autocomplete suggestions.
//!
//! Extracted from `mermaid.rs` (where this used to be the
//! second half of a 620-line monolith) so the suggestion
//! catalogue can be iterated on without scrolling through
//! the SVG-rendering / cache logic. The completions are
//! intentionally hard-coded rather than generated from a
//! schema — the catalogue is small, the labels are part of
//! the user-facing UX, and we'd rather review them by hand
//! than chase a code-gen dep.

use serde::{Deserialize, Serialize};

/// Autocomplete suggestion for mermaid.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MermaidCompletion {
    pub label: String,
    pub description: String,
    pub insert_text: String,
}

/// Return the catalogue of completions whose `label` or
/// `description` matches `partial`. An empty `partial` returns
/// the full catalogue so a freshly-opened popup has something
/// to show.
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
            insert_text:
                "classDiagram\n    class Animal {\n        +String name\n        +makeSound()\n    }"
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_partial_returns_full_catalogue() {
        let all = get_mermaid_suggestions("");
        // 4 flowchart variants + sequence + class + state + er + gantt
        // + pie + timeline + mindmap = 10 entries.
        assert!(all.len() >= 10, "got {} completions", all.len());
    }

    #[test]
    fn partial_filters_to_matching_entries() {
        let graph_only = get_mermaid_suggestions("graph");
        // All four `graph X*` labels should remain.
        assert_eq!(graph_only.len(), 4);
        assert!(graph_only.iter().all(|c| c.label.starts_with("graph")));
    }
}