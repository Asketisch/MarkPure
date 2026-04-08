# AGENTS.md — Rust Workspace Crates

## Crate 依赖关系

```
marktext-rs (src-rust)
  ├── mt-core          (ropey/regex/serde/toml/thiserror)
  ├── mt-fs            → mt-core
  ├── mt-markdown      (pulldown-cmark, 独立)
  └── mt-export        → mt-core, mt-markdown
```

## mt-core

基础类型库，不含 IO 操作。

| 模块 | 核心类型 | 说明 |
|------|---------|------|
| `document` | `Document` | Rope 文本缓冲区 + regex 搜索，跟踪 path/dirty/line_ending/encoding |
| `config` | `AppConfig`, `EditorConfig` | TOML 配置，存储在 `~/Library/Application Support/marktext-rs/config.toml` |
| `error` | `Error` enum | Io / Encoding / Parse / Config / DocumentNotFound / NoFilePath |
| `theme` | `ThemeId` enum | Light / Dark / OneDark / Graphite / Ulysses / MaterialDark |
| `tab` | `TabState`, `WindowTabs` | 标签页状态持久化，JSON 格式存储 |
| `keymap` | `KeyBinding` | 快捷键定义（声明式，尚未接入运行时） |

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

## mt-fs

异步文件 I/O，核心功能是**自动编码检测**。

| 函数 | 说明 |
|------|------|
| `read_file(path) → Result<Document>` | 读文件 → chardetng 检测编码 → 解码 → 返回 Document |
| `write_file(doc, path) → Result<()>` | 用 Document 记录的编码回写 |
| `create_file(path) → Result<()>` | 创建空文件（含父目录） |
| `create_directory(path) → Result<()>` | 创建目录 |
| `delete_file(path) → Result<()>` | 删除文件或目录 |
| `rename_file(path, new_name) → Result<PathBuf>` | 重命名，返回新路径 |

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

## mt-markdown

Markdown 解析，封装 pulldown-cmark（SIMD 加速）。

| 函数 | 说明 |
|------|------|
| `parse_markdown(text) → Vec<Event<'static>>` | 解析为 pulldown-cmark 事件流（tables/footnotes/strikethrough/tasklists） |
| `extract_headings(text) → Vec<(u8, String)>` | 提取标题层级和文本 |
| `to_html(text) → String` | 转换为 HTML |

注：`MarkdownNode` 枚举已定义但未使用（计划中的 AST）。

## mt-export

导出功能。

| 函数 | 说明 |
|------|------|
| `export_html(markdown, title, theme_css?) → String` | 生成独立 HTML 文档（内联 GitHub 风格 CSS） |
| `export_pdf(markdown, title, path) → Result<()>` | 生成 PDF（printpdf，**硬编码 macOS 字体路径**） |

## 开发约定

- 所有 crate 使用 `edition = "2021"`
- 错误类型统一使用 `thiserror` 派生
- `mt-core` 是零 IO 的纯数据层，其他 crate 依赖它但不互相依赖（除 mt-export → mt-markdown）
- 新增 crate 时更新根 `Cargo.toml` 的 `[workspace].members`
- Cargo.lock 已提交到版本控制
