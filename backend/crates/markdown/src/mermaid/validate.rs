//! Mermaid 语法校验：廉价的、不依赖 `mmdc` 的启发式判断，
//! 供编辑器决定是否把图表交给渲染器。
//!
//! 从 `mermaid.rs` 中抽出，让这些谓词（`is_table_row`、
//! `are_brackets_balanced`、`DiagramType::from_code`）集中在
//! 一处，可以单元测试，而不必拖入 `Command::spawn` 渲染管线。

/// Mermaid 图表类型。`Unknown` 变体是兜底值，用于我们无法分类的
/// 代码——通常是误在 `\`\`\`mermaid` 围栏里输入的普通文本。
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

/// 保守的启发式判断——只拒绝无需完整解析即可证明错误的情况：
///   - 空输入无效（没有可渲染的内容）。
///   - 括号不配对无效。
///   - 非空内容不以任何已识别的图表类型关键字开头，可疑且被拒绝。
///     空内容已由第一条检查拒绝。
///
/// 我们刻意*不*尝试校验图表主体本身——那是 `mmdc` 的职责。
/// 误报（拒绝了一个 mmdc 本来能渲染的块）远比漏报（把 `""` 或
/// 普通文字悄悄丢给 mmdc，只得到一句笼统的语法错误）更不容易让人困惑。
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

/// 检查字符串中的括号是否配对。供 `validate_mermaid` 在把内容交给
/// `mmdc` 之前捕获最常见的语法错误。
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
            '}'
                if stack.pop() != Some('{') => {
                    return false;
                }
            // 注意：mermaid 中 '<' 和 '>' 不参与配对——它们用于 --> 之类的箭头
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

        let invalid = "graph TD\n    A[Start --> B[End]"; // 缺少 ]
        assert!(!validate_mermaid(invalid));

        // 空代码无效（没有可渲染的内容）。
        assert!(!validate_mermaid(""));

        // 仅有空白字符无效。
        assert!(!validate_mermaid("   \n\t  "));

        // 未知的图表类型无效。
        assert!(!validate_mermaid("just some prose without a diagram type"));
    }
}