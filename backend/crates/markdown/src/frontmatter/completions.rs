//! Per-format autocompletion suggestions for the frontmatter
//! editor. Each list is intentionally short — we list the
//! fields users actually reach for (title, date, tags, …)
//! rather than a full Hugo / Jekyll catalogue.

use super::types::{CompletionKind, FrontmatterCompletion, FrontmatterFormat};

/// Public entry point: return the completions appropriate
/// for the document's frontmatter format.
pub fn get_frontmatter_completions(format: FrontmatterFormat) -> Vec<FrontmatterCompletion> {
    match format {
        FrontmatterFormat::Yaml => get_yaml_completions(),
        FrontmatterFormat::Toml => get_toml_completions(),
        FrontmatterFormat::Json => get_json_completions(),
    }
}

fn get_yaml_completions() -> Vec<FrontmatterCompletion> {
    vec![
        FrontmatterCompletion {
            label: "title".to_string(),
            description: "Document title".to_string(),
            insert_text: "title: ".to_string(),
            kind: CompletionKind::Property,
        },
        FrontmatterCompletion {
            label: "date".to_string(),
            description: "Creation date".to_string(),
            insert_text: "date: ${CURRENT_DATE}".to_string(),
            kind: CompletionKind::Property,
        },
        FrontmatterCompletion {
            label: "tags".to_string(),
            description: "Document tags (list)".to_string(),
            insert_text: "tags:\n  - ".to_string(),
            kind: CompletionKind::Property,
        },
        FrontmatterCompletion {
            label: "categories".to_string(),
            description: "Document categories (list)".to_string(),
            insert_text: "categories:\n  - ".to_string(),
            kind: CompletionKind::Property,
        },
        FrontmatterCompletion {
            label: "draft".to_string(),
            description: "Draft flag".to_string(),
            insert_text: "draft: true".to_string(),
            kind: CompletionKind::Property,
        },
        FrontmatterCompletion {
            label: "author".to_string(),
            description: "Document author".to_string(),
            insert_text: "author: ".to_string(),
            kind: CompletionKind::Property,
        },
        FrontmatterCompletion {
            label: "description".to_string(),
            description: "Document description".to_string(),
            insert_text: "description: ".to_string(),
            kind: CompletionKind::Property,
        },
        FrontmatterCompletion {
            label: "permalink".to_string(),
            description: "URL permalink".to_string(),
            insert_text: "permalink: ".to_string(),
            kind: CompletionKind::Property,
        },
    ]
}

fn get_toml_completions() -> Vec<FrontmatterCompletion> {
    vec![
        FrontmatterCompletion {
            label: "title".to_string(),
            description: "Document title".to_string(),
            insert_text: "title = ".to_string(),
            kind: CompletionKind::Property,
        },
        FrontmatterCompletion {
            label: "date".to_string(),
            description: "Creation date".to_string(),
            insert_text: "date = ".to_string(),
            kind: CompletionKind::Property,
        },
        FrontmatterCompletion {
            label: "tags".to_string(),
            description: "Document tags (array)".to_string(),
            insert_text: "tags = [".to_string(),
            kind: CompletionKind::Property,
        },
    ]
}

fn get_json_completions() -> Vec<FrontmatterCompletion> {
    vec![
        FrontmatterCompletion {
            label: "title".to_string(),
            description: "Document title".to_string(),
            insert_text: "\"title\": ".to_string(),
            kind: CompletionKind::Property,
        },
        FrontmatterCompletion {
            label: "date".to_string(),
            description: "Creation date".to_string(),
            insert_text: "\"date\": ".to_string(),
            kind: CompletionKind::Property,
        },
    ]
}
