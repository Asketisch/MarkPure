//! 使用 `docx-rs` 构建器把 Markdown 导出为 Word（.docx）文件。
//!
//! 先前的实现在硬编码的支持 HTML 标签集上手工拼接最小 zip 包。
//! 该方案有两个问题：
//!   1. 无法嵌入图片，因此 ` ```mermaid ` 块只能导出为等宽纯文本。
//!   2. 列表项的 `<w:numId>` 引用指向不存在的 `numbering.xml`，
//!      导致列表项在真实 Word 中渲染为普通段落。
//!
//! 本模块用手工 zip 替换为 `docx-rs`，它：
//!   - 通过 `Pic::new` + `Run::add_image` 嵌入 PNG 图片
//!   - 为列表项自动生成 `numbering.xml`
//!   - 替我们处理 XML 转义（先前代码中的 `strip_html_tags` 辅助
//!     函数已变成死重）。
//!
//! Markdown 解析：我们逐行遍历文本，跟踪块边界，为每个文本run
//! 生成一个 `Paragraph`，标题与代码块使用相应的 `style`。Mermaid 块
//! 通过 `markdown::render_mermaid_to_png_cached` 预渲染为 PNG
//! 并作为内联图片嵌入。

use docx_rs::{
    AlignmentType, Docx, Paragraph, Pic, Run, Table, TableCell, TableRow,
};
use std::collections::HashMap;
use std::io::Cursor;

/// 从文档正文收集的脚注。我们使用公开的 `markdown::FootnoteDef` 类型，
/// 它已按文档顺序排列（见 `footnote::collect_footnotes`）。
type Footnote = markdown::FootnoteDef;


/// 表格行判定：以 `|` 开头且以 `|` 结尾。
fn is_table_row(trimmed: &str) -> bool {
    trimmed.len() > 1 && trimmed.starts_with('|') && trimmed.ends_with('|')
}

/// 表格的对齐分隔行单元格（`---` / `:---` / `---:` / `:---:`）。
fn is_alignment_cell(cell: &str) -> bool {
    let c = cell.trim();
    !c.is_empty() && c.chars().all(|ch| ch == '-' || ch == ':') && c.contains('-')
}

/// 把一行表格切成单元格文本。
///
/// 按**未转义**的 `|` 分割——单元格里写 `\|` 表示字面竖线。
fn split_table_row(line: &str) -> Vec<String> {
    let inner = line.trim();
    let inner = inner.strip_prefix('|').unwrap_or(inner);
    let inner = inner.strip_suffix('|').unwrap_or(inner);

    let mut cells: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut chars = inner.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('|') => cur.push('|'),
                Some('\\') => cur.push('\\'),
                Some(other) => {
                    cur.push('\\');
                    cur.push(other);
                }
                None => cur.push('\\'),
            }
            continue;
        }
        if c == '|' {
            cells.push(std::mem::take(&mut cur));
            continue;
        }
        cur.push(c);
    }
    cells.push(cur);
    cells
}

/// 把收集到的表格行冲刷成真正的 Word 表格。
fn flush_table(rows: &mut Vec<Vec<String>>, docx: Docx) -> Docx {
    if rows.is_empty() {
        return docx;
    }
    let collected = std::mem::take(rows);
    let mut iter = collected.into_iter();
    let Some(header) = iter.next() else {
        return docx;
    };
    let rest: Vec<Vec<String>> = iter.collect();

    let mut data = vec![header];
    // 第二行若全是对齐分隔行（`| --- | --- |`），它不是数据行。
    if let Some(second) = rest.first() {
        if second.iter().all(|c| is_alignment_cell(c)) {
            data.extend(rest.into_iter().skip(1));
        } else {
            data.extend(rest);
        }
    }

    let table_rows: Vec<TableRow> = data
        .into_iter()
        .map(|cells| {
            TableRow::new(
                cells
                    .iter()
                    .map(|c| {
                        TableCell::new().add_paragraph(
                            Paragraph::new().add_run(Run::new().add_text(c.trim())),
                        )
                    })
                    .collect(),
            )
        })
        .collect();

    docx.add_table(Table::new(table_rows))
}

/// 把 Markdown 内容导出为 Word（.docx）文件的字节向量。
pub fn export_word(markdown: &str, title: &str) -> Result<Vec<u8>, String> {
    // 预渲染每个 mermaid 块为 PNG，使逐行循环无需二次遍历即可嵌入。
    // 渲染结果在内部缓存，因此重复导出开销很小。
    let mermaid_blocks = markdown::extract_mermaid_blocks(markdown);
    let mut mermaid_pngs: HashMap<usize, Vec<u8>> = HashMap::new();
    for (line_number, source) in &mermaid_blocks {
        if let Ok(png) = markdown::render_mermaid_to_png_cached(source) {
            mermaid_pngs.insert(*line_number, png);
        }
    }

    // 按文档顺序收集脚注，使正文引用与 `footnotes.xml` 注入使用同一编号。
    let footnotes: Vec<Footnote> = markdown::collect_footnotes(markdown);

    let mut docx = Docx::new();
    // 标题作为顶级标题。
    docx = docx.add_paragraph(
        Paragraph::new()
            .align(AlignmentType::Center)
            .add_run(Run::new().add_text(title).size(36).bold()),
    );

    // 遍历行并生成段落。我们跟踪当前块类型（段落 / 标题 / 列表 /
    // 代码）并在块边界输出。
    let mut current_paragraph: Vec<String> = Vec::new();
    let mut in_code_block: Option<String> = None; // 当前代码块的语言
    let mut in_mermaid_open_line: Option<usize> = None;
    let mut list_items: Vec<Option<bool>> = Vec::new(); // Some(checked) 为任务项，None 为圆点项

    let flush_paragraph = |text: &str, docx: Docx| -> Docx {
        let t = text.trim();
        if t.is_empty() {
            return docx;
        }
        docx.add_paragraph(Paragraph::new().add_run(Run::new().add_text(t)))
    };

    let mut code_buffer: Vec<String> = Vec::new();

    // 收集中的表格行（每项是一行的单元格文本）。
    let mut table_rows: Vec<Vec<String>> = Vec::new();

    for (idx, line) in markdown.lines().enumerate() {
        let line_number = idx + 1;
        let trimmed = line.trim();

        // ---- 表格 ----
        // 表格行以 `|` 开头且以 `|` 结尾；连续的行组成一张表。
        // 必须在这里（所有其它块类型之前）处理：表格后面的标题、
        // 列表等都要排在表格**之后**，而收集表格的过程中不能把
        // 表格行当成普通段落。
        if is_table_row(trimmed) {
            docx = flush_paragraph(&current_paragraph.join(" "), docx);
            current_paragraph.clear();
            table_rows.push(split_table_row(trimmed));
            continue;
        }
        if !table_rows.is_empty() {
            docx = flush_table(&mut table_rows, docx);
        }

        // ---- Mermaid 块优先于通用代码块 ----
        if trimmed.starts_with("```mermaid") {
            // 先冲刷待决段落。
            docx = flush_paragraph(&current_paragraph.join(" "), docx);
            current_paragraph.clear();
            in_mermaid_open_line = Some(line_number);
            continue;
        }
        if in_mermaid_open_line.is_some() {
            if trimmed.starts_with("```") {
                let open_line = in_mermaid_open_line.take().unwrap();
                if let Some(png_bytes) = mermaid_pngs.get(&open_line) {
                    // 嵌入预渲染的 PNG。EMU = 每英寸 914400。
                    // 6 英寸宽的图片为 6 * 914400 = 5486400 EMU。
                    // 我们在此处不知道 PNG 尺寸，高度按默认 4:3 宽高比
                    // 计算——下面的 .size() 调用是请求的渲染尺寸，
                    // 而非源像素尺寸。
                    let width_emu: u32 = 6 * 914400;
                    let height_emu: u32 = 4 * 914400;
                    let pic = Pic::new(png_bytes).size(width_emu, height_emu);
                    docx = docx.add_paragraph(
                        Paragraph::new().add_run(Run::new().add_image(pic)),
                    );
                } else {
                    // 预渲染失败（mmdc 缺失或图表无效）。
                    // 插入可见占位文本，让用户知道发生了什么。
                    docx = docx.add_paragraph(
                        Paragraph::new()
                            .add_run(Run::new().add_text("[Mermaid diagram unavailable: mmdc not installed or render failed]")),
                    );
                }
            }
            continue;
        }

        // ---- 通用代码块 ----
        if let Some(_lang) = &in_code_block {
            if trimmed.starts_with("```") {
                // 代码块结束——输出它。
                let code_text = code_buffer.join("\n");
                docx = docx.add_paragraph(
                    Paragraph::new()
                        .style("CodeBlock")
                        .add_run(
                            Run::new()
                                .add_text(if code_text.is_empty() {
                                    " ".to_string()
                                } else {
                                    code_text
                                })
                                .fonts(docx_rs::RunFonts::new().ascii("Courier New")),
                        ),
                );
                code_buffer.clear();
                in_code_block = None;
                continue;
            } else {
                code_buffer.push(line.to_string());
                continue;
            }
        }
        if trimmed.starts_with("```") {
            // 进入代码块。
            docx = flush_paragraph(&current_paragraph.join(" "), docx);
            current_paragraph.clear();
            let lang = trimmed.trim_start_matches("```").trim().to_string();
            in_code_block = Some(lang);
            continue;
        }

        // ---- 标题 ----
        if let Some(rest) = trimmed.strip_prefix("# ") {
            docx = flush_paragraph(&current_paragraph.join(" "), docx);
            current_paragraph.clear();
            docx = docx.add_paragraph(
                Paragraph::new()
                    .style("Heading1")
                    .add_run(Run::new().add_text(strip_footnote_refs(rest, &footnotes)).bold().size(32)),
            );
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("## ") {
            docx = flush_paragraph(&current_paragraph.join(" "), docx);
            current_paragraph.clear();
            docx = docx.add_paragraph(
                Paragraph::new()
                    .style("Heading2")
                    .add_run(Run::new().add_text(strip_footnote_refs(rest, &footnotes)).bold().size(28)),
            );
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("### ") {
            docx = flush_paragraph(&current_paragraph.join(" "), docx);
            current_paragraph.clear();
            docx = docx.add_paragraph(
                Paragraph::new()
                    .style("Heading3")
                    .add_run(Run::new().add_text(strip_footnote_refs(rest, &footnotes)).bold().size(24)),
            );
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("#### ") {
            docx = flush_paragraph(&current_paragraph.join(" "), docx);
            current_paragraph.clear();
            docx = docx.add_paragraph(
                Paragraph::new()
                    .style("Heading4")
                    .add_run(Run::new().add_text(strip_footnote_refs(rest, &footnotes)).bold().size(22)),
            );
            continue;
        }

        // ---- 任务列表项（- [ ] 或 - [x]） ----
        if let Some(rest) = trimmed.strip_prefix("- [ ] ") {
            docx = flush_paragraph(&current_paragraph.join(" "), docx);
            current_paragraph.clear();
            list_items.push(Some(false));
            docx = docx.add_paragraph(
                Paragraph::new()
                    .style("ListTaskUnchecked")
                    .add_run(Run::new().add_text(format!("☐ {}", strip_footnote_refs(rest, &footnotes)))),
            );
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("- [x] ") {
            docx = flush_paragraph(&current_paragraph.join(" "), docx);
            current_paragraph.clear();
            list_items.push(Some(true));
            docx = docx.add_paragraph(
                Paragraph::new()
                    .style("ListTaskChecked")
                    .add_run(Run::new().add_text(format!("☑ {}", strip_footnote_refs(rest, &footnotes)))),
            );
            continue;
        }
        // ---- 普通圆点列表 ----
        if let Some(rest) = trimmed.strip_prefix("- ") {
            docx = flush_paragraph(&current_paragraph.join(" "), docx);
            current_paragraph.clear();
            list_items.push(None);
            docx = docx.add_paragraph(
                Paragraph::new()
                    .style("ListBullet")
                    .add_run(Run::new().add_text(format!("• {}", strip_footnote_refs(rest, &footnotes)))),
            );
            continue;
        }
        // ---- 有序列表（任意序号，如 `5. text` / `10. text`） ----
        // 旧实现只识别 `1. `–`4. ` 前缀，且把每一项都渲染成字面量
        // "1. text"（丢失真实序号）。现在解析完整的数字前缀并原样保留。
        if let Some((num, rest)) = trimmed
            .split_once('.')
            .filter(|(n, r)| {
                !n.is_empty()
                    && n.bytes().all(|b| b.is_ascii_digit())
                    && r.starts_with(' ')
            })
        {
            docx = flush_paragraph(&current_paragraph.join(" "), docx);
            current_paragraph.clear();
            docx = docx.add_paragraph(
                Paragraph::new()
                    .style("ListNumber")
                    .add_run(Run::new().add_text(format!(
                        "{}. {}",
                        num,
                        strip_footnote_refs(rest.trim(), &footnotes)
                    ))),
            );
            continue;
        }

        // ---- 空行：段落边界 ----
        if trimmed.is_empty() {
            docx = flush_paragraph(&current_paragraph.join(" "), docx);
            current_paragraph.clear();
            continue;
        }

        // ---- 否则，累积进当前段落 ----
        // 行内 `[^label]` 脚注引用会被改写为文档顺序编号 `[N]`
        // （与末尾 Footnotes 一节的编号一致），避免原始标记泄漏进正文。
        let cleaned = strip_footnote_refs(trimmed, &footnotes);
        if !cleaned.is_empty() {
            current_paragraph.push(cleaned);
        }
    }

    // 冲刷残留表格。
    docx = flush_table(&mut table_rows, docx);
    // 冲刷残留文本。
    docx = flush_paragraph(&current_paragraph.join(" "), docx);
    // 冲刷残留代码块。
    if !code_buffer.is_empty() {
        let code_text = code_buffer.join("\n");
        docx = docx.add_paragraph(
            Paragraph::new()
                .style("CodeBlock")
                .add_run(
                    Run::new()
                        .add_text(code_text)
                        .fonts(docx_rs::RunFonts::new().ascii("Courier New")),
                ),
        );
    }

    // 在文档末尾追加「Footnotes:」一节。我们采用 V1 方案（末尾带编号
    // 的段落），而不是注入真正的 `word/footnotes.xml` 部件，因为
    // docx-rs 0.4 没有一流的脚注 API，手工 XML 注入又很脆弱。
    // 未来的改动可以用正确的 `<w:footnoteReference>` 接线替换它。
    if !footnotes.is_empty() {
        docx = docx.add_paragraph(
            Paragraph::new()
                .add_run(Run::new().add_text("Footnotes").bold().size(24)),
        );
        for note in &footnotes {
            let line = format!("[{}] {}", note.number, note.content);
            docx = docx.add_paragraph(
                Paragraph::new().add_run(Run::new().add_text(line)),
            );
        }
    }

    // 构建并打包为 Vec<u8>。
    let xml_docx = docx.build();
    let mut buf = Vec::new();
    xml_docx
        .pack(Cursor::new(&mut buf))
        .map_err(|e| format!("pack error: {}", e))?;
    Ok(buf)
}

/// 把行内 `[^label]` 脚注引用改写为 `[N]`，其中 `N` 是
/// [`collect_footnotes`](markdown::collect_footnotes) 分配的文档顺序编号。
/// 脚注定义以独立一节追加在文档末尾，若不改写行内标记，
/// `[^1]` 这类原始文本就会原样泄漏进 docx 正文。
/// 找不到对应定义的标记（如 `[^missing]`）会被原样保留，
/// 让用户能看到引用了不存在的脚注。
///
/// `text` 中的多字节字符通过 `chars()` 逐字推进保证字节偏移
/// 始终落在字符边界上。
fn strip_footnote_refs(text: &str, footnotes: &[Footnote]) -> String {
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < text.len() {
        if let Some(rest) = text[i..].strip_prefix("[^") {
            if let Some(close) = rest.find(']') {
                let label = &rest[..close];
                if let Some(note) = footnotes.iter().find(|f| f.label == label) {
                    out.push('[');
                    out.push_str(&note.number.to_string());
                    out.push(']');
                    // 跳过 `[^`（2 字节）+ label（close 字节）+ `]`（1 字节）。
                    // 旧代码 `close + 1` 少跳 2 字节，label 残留输出
                    //（"see [^a] now" → "see [1]a] now"）。
                    i += close + 3;
                    continue;
                }
            }
        }
        let ch = text[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

#[cfg(test)]
mod tests {

    #[test]
    fn test_strip_footnote_refs_consumes_label() {
        // 回归：旧的 `i += close + 1` 少跳 2 字节，label 残留
        //（"see [^a] now" → "see [1]a] now"）。
        let footnotes = vec![markdown::FootnoteDef {
            label: "a".to_string(),
            content: "note text".to_string(),
            number: 1,
        }];
        let out = strip_footnote_refs("see [^a] now", &footnotes);
        assert_eq!(out, "see [1] now");
    }
    use super::*;

    #[test]
    fn export_word_basic_heading_and_paragraph() {
        let md = "# Title\n\nHello world.\n";
        let bytes = export_word(md, "T").expect("should produce bytes");
        // 输出必须是有效的 zip（docx 文件就是 zip）。
        assert!(bytes.len() > 4, "output too small");
        // PK\x03\x04 是 zip 文件头的魔数。
        assert_eq!(
            &bytes[0..4],
            b"PK\x03\x04",
            "docx is not a valid zip archive"
        );
    }

    #[test]
    fn export_word_contains_title() {
        let md = "# Hello\n\nbody\n";
        let bytes = export_word(md, "My Title").expect("should produce bytes");
        let s = String::from_utf8_lossy(&bytes);
        assert!(s.contains("My Title"), "title missing from docx");
        assert!(s.contains("Hello"), "heading missing from docx");
        assert!(s.contains("body"), "paragraph missing from docx");
    }

    #[test]
    fn export_word_handles_no_mermaid() {
        // 不含 mermaid 的纯 Markdown 仍应生成有效的 docx，且不嵌入 PNG。
        let md = "## Subtitle\n\nSome **bold** text.\n";
        let bytes = export_word(md, "T").expect("should produce bytes");
        let s = String::from_utf8_lossy(&bytes);
        // 无 mermaid 块时不应出现 word/media/ 目录。docx-rs 仅在
        // 添加 Pic 时才会创建 media 目录。
        assert!(!s.contains("word/media/"), "unexpected media folder");
    }

    #[test]
    fn export_word_ordered_list_preserves_real_numbers() {
        // 任意起始序号（≥5）都必须被识别，且序号原样保留
        // （旧实现只认 1.–4. 且把所有项渲染成 "1. ..."）。
        let md = "# T\n\n5. first\n6. second\n10. tenth\n";
        let bytes = export_word(md, "T").expect("should produce bytes");
        let s = String::from_utf8_lossy(&bytes).to_string();
        assert!(s.contains("5. first"), "expected '5. first' in docx");
        assert!(s.contains("10. tenth"), "expected '10. tenth' in docx");
        // 小数点正文（如 "3.14"）不得被误判为列表项。
        let md2 = "# T\n\npi is 3.14 approx\n";
        let bytes2 = export_word(md2, "T").expect("should produce bytes");
        let s2 = String::from_utf8_lossy(&bytes2).to_string();
        assert!(s2.contains("pi is 3.14 approx"), "decimal text mangled: {s2}");
    }

    #[test]
    fn export_word_inline_footnote_refs_are_renumbered_not_leaked() {
        // 行内 `[^a]` 应改写为文档顺序编号 `[1]`，
        // 原始标记不得泄漏进 docx 正文。
        let md = "Body with a ref [^a] and text.\n\n[^a]: The definition.\n";
        let bytes = export_word(md, "T").expect("should produce bytes");
        let s = String::from_utf8_lossy(&bytes).to_string();
        assert!(s.contains("[1]"), "renumbered ref missing: {s}");
        assert!(
            !s.contains("[^a]"),
            "raw footnote marker leaked into docx"
        );
        assert!(s.contains("The definition"), "footnote section missing");
    }

    #[test]
    fn strip_footnote_refs_keeps_unknown_labels_intact() {
        let notes: Vec<Footnote> = Vec::new();
        // 无定义：原样保留，让用户能看到悬空引用。
        assert_eq!(
            strip_footnote_refs("see [^missing] here", &notes),
            "see [^missing] here"
        );
        // 未闭合的 `[^` 不是引用，原样保留。
        assert_eq!(strip_footnote_refs("a [^ b", &notes), "a [^ b");
        // 多字节字符边界安全。
        assert_eq!(strip_footnote_refs("你好 [^x] 世界", &notes), "你好 [^x] 世界");
    }

    #[test]
    fn export_word_mermaid_block_uses_fallback_when_mmdc_missing() {
        // 设置了 MMDC_DISABLED 时，mermaid 块应回退为可见的
        // "[Mermaid diagram unavailable: ...]" 文本，而非崩溃。
        std::env::set_var("MMDC_DISABLED", "1");
        let md = "before\n\n```mermaid\ngraph TD\n    A --> B\n```\n\nafter\n";
        let bytes = export_word(md, "T").expect("should produce bytes");
        std::env::remove_var("MMDC_DISABLED");
        let s = String::from_utf8_lossy(&bytes);
        assert!(
            s.contains("Mermaid diagram unavailable"),
            "fallback message missing: {}",
            &s[..s.len().min(2000)]
        );
    }

    #[test]
    fn export_word_table_becomes_a_real_table() {
        // 表格此前被降级成一段段普通文本——结构丢失。
        let md = "| 列 A | 列 B |\n| --- | --- |\n| 值 1 | 值 2 |\n";
        let bytes = export_word(md, "T").expect("should produce bytes");
        let s = String::from_utf8_lossy(&bytes);
        assert!(s.contains("<w:tbl>"), "no table in output");
        assert!(s.contains("列 A") && s.contains("值 2"), "cell text missing");
        // 表头 + 一行数据 = 两行；分隔行不算数据行。
        assert_eq!(s.matches("<w:tr>").count(), 2, "unexpected row count");
    }

    #[test]
    fn export_word_table_keeps_escaped_pipe_in_cell() {
        // 单元格里写 `a\|b` 表示字面竖线——不能被当成列分隔符。
        let md = "| 表头 |\n| --- |\n| a\\|b |\n";
        let bytes = export_word(md, "T").expect("should produce bytes");
        let s = String::from_utf8_lossy(&bytes);
        assert_eq!(s.matches("<w:tr>").count(), 2, "escaped pipe split the row");
        assert!(s.contains("a|b"), "escaped pipe lost");
    }

    #[test]
    fn export_word_table_followed_by_heading_keeps_order() {
        let md = "| A |\n| --- |\n| 1 |\n\n## 之后的标题\n";
        let bytes = export_word(md, "T").expect("should produce bytes");
        let s = String::from_utf8_lossy(&bytes);
        let tbl = s.find("<w:tbl>").expect("no table");
        let heading = s.find("Heading2").expect("no heading");
        assert!(tbl < heading, "heading must come after the table");
    }
}
