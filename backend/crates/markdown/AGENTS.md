# AGENTS.md — markdown/ Markdown 解析

## 目录

| 文件 | 说明 |
|------|------|
| `parser.rs` | parse_markdown, extract_headings, to_html |
| `folding.rs` | 代码块/引用折叠 |
| `table.rs` | parse_table, render_table, transform_table |
| `mermaid/mod.rs` | Mermaid 门面板（`validate_mermaid`, `parse_mermaid`, `render_mermaid_*_cached`, `get_mermaid_suggestions`） |
| `mermaid/validate.rs` | 纯谓词：`validate_mermaid`, `are_brackets_balanced`, `DiagramType` |
| `mermaid/render.rs` | `mmdc` 派生 + SVG/PNG LRU 缓存 |
| `mermaid/suggestions.rs` | 编辑器自动补全目录 |
| `mermaid/types.rs` | 共享类型（`MermaidError`, `MermaidResult`） |
| `frontmatter/` | YAML/TOML frontmatter 解析与字段更新 |
| `pandoc.rs` | parse_footnotes, parse_definition_list, parse_task_items |

Mermaid 拆分动机：原 `mermaid.rs` 是 620 行的单体，验证、渲染、提示三种关注点
混在一个文件里。拆分后每种关注点的修改局限在 90-310 行的子模块。