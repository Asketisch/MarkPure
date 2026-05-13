# AGENTS.md — Rust Workspace Crates

## Crate 依赖关系

```
backend/crates/core (无依赖 - 底层基础库)
  ├── backend/crates/fs
  ├── backend/crates/markdown
  ├── backend/crates/export
  ├── backend/crates/search
  ├── backend/crates/bookmark
  ├── backend/crates/assets
  └── backend/crates/spellcheck

backend/crates/export → backend/crates/core, backend/crates/markdown
```

## core

基础类型库，不含 IO 操作。

| 模块 | 核心类型 | 说明 |
|------|---------|------|
| `document` | `Document` | Rope 文本缓冲区 + regex 搜索，跟踪 path/dirty/line_ending/encoding |
| `config` | `AppConfig`, `EditorConfig` | TOML 配置，存储在 `~/Library/Application Support/markpure/config.toml` |
| `error` | `Error` enum | Io / Encoding / Parse / Config / DocumentNotFound / NoFilePath / Other(String) |
| `theme` | `ThemeId` enum | Light / Dark / OneDark / Graphite / Ulysses / MaterialDark，含 `validate_theme_id()` 安全校验 |
| `i18n` | `Locale`, translations | 71 个翻译 key，支持 en/zh-CN/ja |
| `tab` | `TabState`, `WindowTabs` | 标签页状态持久化，JSON 格式存储 |
| `keymap` | `KeyBinding` | 快捷键定义（声明式，尚未接入运行时） |
| `selection` | `Selection`, `SelectionRange` | 光标选择操作：insert_at_selections、delete_at_selections、get_word_at_position、get_word_range |
| `workspace` | `Workspace`, `WorkspaceState`, `Pane`, `FolderInfo` | 工作区布局状态（侧边栏宽度、展开状态等） |

### Document API

```rust
// 创建
Document::new()                                    // 空文档
Document::from_content(text, path, encoding)        // 从字符串创建

// 读取
doc.text()             → String    // 带原始行尾的完整文本
doc.text_normalized()  → String    // LF 行尾（用于 markdown 处理）
doc.path()             → Option<&Path>
doc.file_name()        → &str
doc.encoding()         → Encoding
doc.line_ending()      → LineEnding
doc.is_dirty()         → bool
doc.is_empty()         → bool
doc.len_chars()        → usize
doc.len_lines()        → usize

// 统计
doc.word_count()       → usize     // CJK 感知：每个 CJK 字符计为一个词
doc.character_count()  → usize     // 排除空白字符

// 编辑
doc.insert(char_idx, text)          // 在字符位置插入
doc.remove(start, end)              // 删除字符范围
doc.replace(from, to, text)         // 替换字符范围（合并 remove + insert）
doc.set_content(content)            // 全量替换 rope 内容
doc.set_path(path)                  // 设置文件路径（Save As）
doc.mark_saved()                    // 标记为已保存

// 搜索
doc.search(query, case_sensitive, whole_word, use_regex) → Vec<(usize, usize)>
// 返回 (from, to) 字符位置对，支持正则/全词/大小写选项
// 内部使用 regex crate，正确处理 UTF-8 字节偏移到字符偏移的转换
```

### AppConfig API

```rust
AppConfig::load(path)        → AppConfig
AppConfig::save(&self, path) → Result<()>
AppConfig::config_path()     → PathBuf  // 平台相关的配置文件路径
config.add_recent_file(&mut self, path)
config.get_recent_files(&self) → &[String]  // 最多 10 个
config.clear_recent_files(&mut self)
config.set_last_workspace(&mut self, path)
config.set_language(&mut self, lang)
```

### Selection API

```rust
insert_at_selections(selection, text, doc) → Vec<Transaction>
delete_at_selections(selection, direction, doc) → Vec<Transaction>
get_word_at_position(doc, pos) → Option<SelectionRange>
get_word_range(doc, from, to) → SelectionRange
```

## fs

异步文件 I/O，核心功能是**自动编码检测**。

| 函数 | 说明 |
|------|------|
| `read_file(path) → Result<Document>` | 读文件 → chardetng 检测编码 → 解码 → 返回 Document |
| `write_file(doc, path) → Result<()>` | 用 Document 记录的编码回写 |
| `create_file(path) → Result<()>` | 创建空文件（含父目录） |
| `create_directory(path) → Result<()>` | 创建目录 |
| `delete_file(path) → Result<()>` | 删除文件或目录 |
| `rename_file(path, new_name) → Result<PathBuf>` | 重命名，校验 new_name 无 `..`，验证新路径不超出父目录 |
| `validate_file_name(name) → Result<()>` | 校验文件名不含 `..`、`/`、`\`、`\0` |

### walk_directory

```rust
walk_directory(path, depth) → Result<Vec<FileEntry>>
```

- 递归扫描目录，返回 `FileEntry` 树
- **过滤规则**：仅保留 `.md`、`.markdown`、`.txt` 扩展名的文件
- **跳过目录**：以 `.` 开头的隐藏目录、`node_modules`、`target`

### FileWatcher

```rust
FileWatcher::new() → FileWatcher
watcher.watch(path, id) → Result<Receiver<FileChangeEvent>>
```

- 基于 `notify` crate，递归目录监视
- 事件类型：`modified`、`created`、`deleted`

支持的编码：UTF-8、UTF-8 BOM、GBK、Shift_JIS、Big5 及其他 chardetng 可检测的编码。

## markdown

Markdown 解析，封装 pulldown-cmark（SIMD 加速）。

| 模块 | 函数 | 说明 |
|------|------|------|
| `parser` | `parse_markdown(text) → Vec<Event<'static>>` | 解析为 pulldown-cmark 事件流 |
| `parser` | `extract_headings(text) → Vec<(u8, String)>` | 提取标题层级和文本 |
| `parser` | `to_html(text) → String` | 转换为 HTML |
| `parser` | `extract_wikilinks(text) → Vec<WikiLink>` | 提取 [[Page]] 和 [[Page\|Alias]] |
| `parser` | `extract_tags(text) → Vec<MarkdownTag>` | 提取 #tag |
| `folding` | `compute_folding_ranges(text) → Vec<FoldRange>` | 计算代码块/引用可折叠范围 |
| `folding` | `toggle_fold(text, range, collapsed) → String` | 切换折叠状态 |
| `folding` | `get_collapsed_display_range(range) → (usize, usize)` | 获取折叠后显示范围 |
| `table` | `parse_table(events) → Option<TableStructure>` | 解析表格结构 |
| `table` | `render_table(table, align) → String` | 渲染表格为 HTML |
| `table` | `transform_table(table, op, row?, col?) → TableStructure` | 表格操作（插入行/列等） |
| `table` | `validate_table(table) → bool` | 验证表格合法性 |
| `table` | `find_tables(text) → Vec<TableStructure>` | 在文本中查找所有表格 |
| `mermaid` | `validate_mermaid(diagram_type, code) → MermaidResult` | 验证 Mermaid 图表语法 |
| `mermaid` | `extract_mermaid_blocks(text) → Vec<(DiagramType, String)>` | 提取所有 Mermaid 块 |
| `mermaid` | `parse_mermaid(diagram_type, code) → MermaidResult` | 解析 Mermaid 代码 |
| `mermaid` | `get_mermaid_suggestions(partial) → Vec<MermaidCompletion>` | 获取 Mermaid 自动补全建议 |
| `frontmatter` | `parse_frontmatter(text) → Option<Frontmatter>` | 解析 YAML/TOML frontmatter |
| `frontmatter` | `validate_frontmatter(fm) → bool` | 验证 frontmatter 格式 |
| `frontmatter` | `update_frontmatter_field(text, key, value) → String` | 更新 frontmatter 字段 |
| `frontmatter` | `get_frontmatter_completions(partial) → Vec<FrontmatterCompletion>` | frontmatter 补全建议 |
| `frontmatter` | `find_frontmatter(text) → Option<FrontmatterBounds>` | 查找 frontmatter 位置 |
| `pandoc` | `parse_footnotes(events) → Vec<Footnote>` | 解析脚注 |
| `pandoc` | `render_footnote_ref(footnote) → String` | 渲染脚注引用 |
| `pandoc` | `parse_definition_list(events) → Vec<DefinitionItem>` | 解析定义列表 |
| `pandoc` | `parse_task_items(events) → Vec<TaskItem>` | 解析任务列表 |
| `pandoc` | `parse_example_numbers(events) → Vec<ExampleItem>` | 解析编号示例 |
| `pandoc` | `render_definition_list_html(items) → String` | 渲染定义列表为 HTML |
| `pandoc` | `render_footnotes_html(footnotes) → String` | 渲染脚注为 HTML |

注：`MarkdownNode` 枚举已定义但未使用（计划中的 AST）。

## export

导出功能。

| 函数 | 说明 |
|------|------|
| `export_html(markdown, title, theme_css?) → String` | 生成独立 HTML 文档（内联 GitHub 风格 CSS） |
| `export_pdf(markdown, title, path) → Result<()>` | 生成 PDF（printpdf，**硬编码 macOS 字体路径**） |
| `export_word(markdown, title) → Result<Vec<u8>>` | 生成 DOCX（zip 2.x，手写 Office Open XML） |

DOCX 导出注意：`create_document_xml` 中 title 经 `escape_xml()` 处理，body 内容经 `html_to_docx_body` + `escape_xml()` 处理。

## search

工作区全文搜索。

| 模块 | 类型/函数 | 说明 |
|------|----------|------|
| - | `search_workspace(path, query, options) → SearchResult` | walkdir 遍历 + regex 匹配，跳过二进制文件 |
| - | `search_file(file_path, query, options) → Vec<SearchMatch>` | 单文件搜索 |
| `preview` | `SearchPreview`, `get_search_preview(result, max_len) → String` | 搜索结果预览（带上下文） |
| `preview` | `get_file_preview(path, max_len) → String` | 文件内容预览 |
| `replace` | `replace_in_files(paths, query, replacement, options) → ReplaceResult` | 批量替换 |
| `replace` | `replace_single(path, range, replacement) → String` | 单文件单处替换 |
| `replace` | `preview_replace(content, ranges, replacement) → ReplacePreview` | 替换预览 |

`build_pattern` 支持 regex + whole_word 组合（用 `\b(?:...)` 包裹）。

## bookmark

书签 CRUD，JSON 持久化。

| 函数 | 说明 |
|------|------|
| `load_bookmarks() → Vec<Bookmark>` | 从 `~/.config/markpure/bookmarks.json` 读取 |
| `add_bookmark(path, title, tags) → Bookmark` | 添加书签 |
| `update_bookmark(id, title?, description?, tags?) → Bookmark` | 更新书签 |
| `remove_bookmark(id)` | 删除书签 |
| `search_bookmarks(query) → Vec<Bookmark>` | 搜索书签 |
| `get_bookmarks_by_tag(tag) → Vec<Bookmark>` | 按标签筛选 |
| `get_all_tags() → Vec<String>` | 获取所有标签 |

`generate_id()` 使用纳秒时间戳 + 伪随机后缀避免碰撞。

## assets

图片资源管理，支持三种粘贴模式。

| 函数 | 说明 |
|------|------|
| `save_pasted_image(workspace, data, name?) → SavedImage` | 保存到 `.assets/images/` |
| `upload_image_remote(data, url, api_key?) → RemoteUploadResult` | 远程上传（ureq 3.x multipart POST） |
| `is_file_readonly(path) → bool` | Unix 权限检查 |
| `get_file_info(path) → FileInfo` | 获取文件元信息（大小、修改时间等） |
| `detect_image_format(data) → Option<&'static str>` | 检测图片格式 |

**安全**：`validate_upload_url()` 阻止 SSRF（私有/内网地址、非 http/https 协议）。使用 `url` crate 解析和校验。

## spellcheck

英文拼写检查（Levenshtein 距离建议）。内置词典 `dict_en.txt`，CJK 文本自动跳过。

| 类型/函数 | 说明 |
|----------|------|
| `SpellError` | 拼写错误（word, start, end, suggestions） |
| `SpellCheckResult` | 检查结果（errors, language） |
| `check_spelling(text, lang) → SpellCheckResult` | 执行拼写检查 |

## 开发约定

- 所有 crate 使用 `edition = "2021"`
- 错误类型统一使用 `thiserror` 派生
- `core` 是零 IO 的纯数据层，其他 crate 依赖它但不互相依赖（除 `export → markdown`）
- 新增 crate 时更新根 `Cargo.toml` 的 `[workspace].members`
- Cargo.lock 已提交到版本控制
