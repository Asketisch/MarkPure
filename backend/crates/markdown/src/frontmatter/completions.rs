//! 面向 frontmatter 编辑器、按格式区分的自动补全建议。
//! 每个列表都刻意保持精简——只列出用户真正会用的字段
//! （title、date、tags 等），而不是 Hugo / Jekyll 的完整清单。

use super::types::{CompletionKind, FrontmatterCompletion, FrontmatterFormat};

/// 公共入口：根据文档 frontmatter 的格式返回合适的补全建议。
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
