# AGENTS.md — markdown/ Markdown 解析

## 目录

| 文件 | 说明 |
|------|------|
| `parser.rs` | parse_markdown, extract_headings, to_html |
| `render.rs` | Markdown → HTML 渲染管线（Mermaid 预渲染 + 脚注 + 图片属性） |
| `footnote.rs` | 脚注收集与 HTML 渲染（`collect_footnotes` / `render_footnote_section`） |
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

## HTML 渲染管线的两条硬约束

`render.rs` 的两个入口（`to_html_with_diagrams` /
`to_html_with_diagrams_and_footnotes`）有两条容易踩的规则：

- **必须成段调用 `push_html`，不能逐事件渲染。** `push_html` 内部维护
  状态：图片的 `Start(Tag::Image)` 事件输出 `<img src="…" alt="`，随后的
  `Text` 事件才补上 alt 内容。逐事件调用会让 writer 状态在每个事件后被
  重置，于是 alt 永远是空的，而 alt 文本被单独渲染到图片**外面**。
  渲染器用 `flush_html` 辅助函数分段提交事件。
- **脚注定义只出现在文末的 `<section class="footnotes">` 里。** 定义
  位置不再内联输出 `<li>`——否则同一段内容在文档里出现两遍，且内联那份
  是脱离 `<ol>` 的裸 `<li>`（非法 HTML）。

图片的 `{width=300 align=center}` 是项目自研的扩展语法，pulldown-cmark
不认识它。`apply_image_attrs` 在渲染后做一次正则后处理，把属性段还原成
HTML 属性（`width` / `style="text-align:…"`），属性插在自闭合斜杠**之前**。