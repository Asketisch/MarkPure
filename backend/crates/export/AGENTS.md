# AGENTS.md — export/ 导出功能

## 目录

| 文件 | 说明 |
|------|------|
| `html.rs` | export_html（接受 `theme_css: Option<&str>`） |
| `pdf/mod.rs` | PDF 导出门面（`export_pdf`），公开 API 入口 |
| `pdf/orchestration.rs` | 行级调度器 + 字体/页面布局（最大的文件，~500 行） |
| `pdf/images.rs` | 内联图片提取 + 字节加载 |
| `pdf/table.rs` | Markdown 表格解析与渲染（`is_table_row` / `render_table_row` 等） |
| `pdf/strip.rs` | Markdown → plain text 剥离 + 脚注引用替换 |
| `png.rs` | export_png_save（P1-8，前端 html-to-image 字节流校验+写盘） |
| `word.rs` | export_word (DOCX, zip) |

PDF 拆分的动机：原 `pdf.rs` 是 775 行的单体，包含编排（页面布局、字体、
行级 dispatch）和三类特性（图片、表格、Markdown 剥离）混在一起。拆分后
每类特性的变更局限在一个 80-150 行的子模块中，编排文件保持可读。