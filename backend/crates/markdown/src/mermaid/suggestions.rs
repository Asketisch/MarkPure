//! Mermaid 自动补全建议。
//!
//! 从 `mermaid.rs`（曾是 620 行单体文件的另一半）抽出，这样迭代
//! 建议目录时不必翻找 SVG 渲染 / 缓存逻辑。补全刻意写死而不是从
//! schema 生成——目录很小，标签属于面向用户的体验内容，我们宁愿
//! 手工审阅，也不想去追代码生成依赖。

use serde::{Deserialize, Serialize};

/// Mermaid 的自动补全建议。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MermaidCompletion {
    pub label: String,
    pub description: String,
    pub insert_text: String,
}

/// 返回 `label` 或 `description` 与 `partial` 匹配的补全目录。
/// 空 `partial` 返回完整目录，让刚打开的弹窗有内容可展示。
pub fn get_mermaid_suggestions(partial: &str) -> Vec<MermaidCompletion> {
    let mut completions = Vec::new();

    // 流程图建议
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

    // 其他图表类型
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
        // 4 个流程图变体 + 时序图 + 类图 + 状态图 + ER 图 + 甘特图
        // + 饼图 + 时间线 + 思维导图 = 10 条。
        assert!(all.len() >= 10, "got {} completions", all.len());
    }

    #[test]
    fn partial_filters_to_matching_entries() {
        let graph_only = get_mermaid_suggestions("graph");
        // 四个 `graph X*` 标签都应保留。
        assert_eq!(graph_only.len(), 4);
        assert!(graph_only.iter().all(|c| c.label.starts_with("graph")));
    }
}