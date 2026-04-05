# AGENTS.md — Rust Workspace Crates

## Crate 依赖关系

```
marktext-rs (src-rust)
  ├── mt-core          (无外部依赖，仅 ropey/serde/toml/thiserror)
  ├── mt-fs            → mt-core
  ├── mt-markdown      → mt-core (间接通过 mt-fs 使用)
  └── mt-export        → mt-core, mt-markdown
```

## mt-core

基础类型库，不含 IO 操作。

| 模块 | 核心类型 | 说明 |
|------|---------|------|
| `document` | `Document` | Rope 文本缓冲区，跟踪 path/dirty/line_ending/encoding。内部存储 LF，读写时自动转换 |
| `config` | `AppConfig`, `EditorConfig`, `WindowConfig` | TOML 配置，存储在 `~/Library/Application Support/marktext-rs/config.toml` |
| `error` | `Error` enum | Io / Encoding / Parse / Config / DocumentNotFound / NoFilePath |
| `theme` | `ThemeId` enum | Light / Dark / OneDark / Graphite / Ulysses / MaterialDark，含 cycle() |
| `keymap` | `KeyBinding` | 快捷键定义（声明式，尚未接入运行时） |

### Document API 要点

```rust
Document::new()                                          // 空文档
Document::from_content(text, path, encoding)             // 从字符串创建
doc.text()           → String    // 带原始行尾的完整文本
doc.text_normalized() → String   // LF 行尾（用于 markdown 处理）
doc.word_count()     → usize     // CJK 感知词数统计
doc.insert(char_idx, text)
doc.remove(start..end)
doc.mark_saved()
```

## mt-fs

异步文件 I/O，核心功能是**自动编码检测**。

| 函数 | 说明 |
|------|------|
| `read_file(path) → Result<Document>` | 读文件 → chardetng 检测编码 → 解码 → 返回 Document |
| `write_file(doc, path) → Result<()>` | 用 Document 记录的编码回写 |

支持的编码：UTF-8、UTF-8 BOM、GBK、Shift_JIS、Big5 及其他 chardetng 可检测的编码。

## mt-markdown

Markdown 解析，封装 pulldown-cmark。

| 函数 | 说明 |
|------|------|
| `parse_markdown(text) → Vec<Event<'static>>` | 解析为 pulldown-cmark 事件流（启用 tables/footnotes/strikethrough/tasklists） |
| `extract_headings(text) → Vec<(u8, String)>` | 提取标题层级和文本（用于 TOC） |
| `to_html(text) → String` | 转换为 HTML |

## mt-export

导出功能。

| 函数 | 说明 |
|------|------|
| `export_html(markdown, title, theme_css?) → String` | 生成独立 HTML 文档（内联 GitHub 风格 CSS） |
| `export_pdf(markdown, path) → Result<()>` | 生成 PDF（使用 printpdf，**硬编码 macOS 字体路径，需跨平台修复**） |

## 开发约定

- 所有 crate 使用 `edition = "2021"`
- 错误类型统一使用 `thiserror` 派生
- `mt-core` 是零 IO 的纯数据层，其他 crate 依赖它但不互相依赖（除了 mt-export → mt-markdown）
- 新增 crate 时更新根 `Cargo.toml` 的 `[workspace].members`
- Cargo.lock 已提交到版本控制
