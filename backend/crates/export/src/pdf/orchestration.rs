use printpdf::*;
use std::collections::HashMap;
use std::fs::File;
use std::io::BufWriter;

// `printpdf 0.7` 把自己的 `image` 依赖以 `image_crate` 重导出，因此我们
// 始终走该路径，避免与我们为 SVG 栅格化路径（在 markdown crate 中）声明的
// `image = "0.25"` 版本不匹配。此处的 0.24 重导出暴露了
// PNG 解码所需的 `load_from_memory` 函数。
use printpdf::image_crate::load_from_memory;

// 各功能子模块的重导出。编排器（本文件）仍持有逐行分发器；
// 表格 / 图片辅助函数位于 `super::{images,table}`，在此引入后
// 调用点无需改动。
use super::text::{needs_cjk_font, FontSet};
use super::{extract_inline_images, is_table_row, is_table_separator,
            load_image_bytes, parse_table_row, render_table_row, strip_markdown,
            substitute_footnote_refs, wrap_text};

/// 将 Markdown 文本导出为 PDF 文件，带基础文本排版。
///
/// Markdown 以段落、标题、代码块、引用块和内联强调的流式渲染。
/// Mermaid 围栏代码块先经 `mmdc -e png` 预渲染为 PNG，再作为
/// 按页面内容宽度缩放的图片嵌入。
pub fn export_pdf(
    markdown: &str,
    title: &str,
    output_path: &str,
    source_path: Option<&str>,
) -> Result<(), String> {
    let (mut doc, page_idx, layer_idx) = create_document(title);

    // 字体集合：拉丁字体必备，文档含 CJK 字符时才额外加载 CJK 字体
    // ——拉丁字体没有 CJK 字形，用它渲染中文只会得到空白。
    let fonts = FontSet::load(&mut doc, markdown.chars().any(needs_cjk_font))?;

    let page_width = Mm(210.0).0;
    let margin = Mm(20.0).0;
    let content_width = page_width - 2.0 * margin;

    let mut y = Mm(277.0).0; // 从 A4 页面顶部附近开始
    let line_height = 5.0; // 单位 mm
    let mut current_page_idx = page_idx;
    let mut current_layer_idx = layer_idx;

    // 预渲染每个 mermaid 块为 PNG，使逐行循环无需第二次遍历即可嵌入。
    // 渲染结果在内部缓存，因此同一文档的重复导出开销很小。
    let mermaid_blocks = markdown::extract_mermaid_blocks(markdown);
    let mut mermaid_pngs: HashMap<usize, Vec<u8>> = HashMap::new();
    for (line_number, source) in &mermaid_blocks {
        if let Ok(png) = markdown::render_mermaid_to_png_cached(source) {
            mermaid_pngs.insert(*line_number, png);
        }
    }

    // 预加载每个内联 `![alt](path)` 图片。标记 `\x00IMG_<line>_<index>\x00`
    // 在行循环中替代图片语法，然后在此匹配以嵌入 PNG/JPG。我们只解析
    // 文件路径——远程 URL（http/https）刻意跳过，使导出保持离线安全。
    // 路径尽可能基于源 Markdown 文件所在目录解析。
    let mut image_markers: HashMap<String, Vec<u8>> = HashMap::new();
    for (line_no, line) in markdown.lines().enumerate() {
        // 标记行号与主循环一致使用 1-based——旧实现这里用 0-based
        // 行号建键、主循环用 1-based 查键，导致行内图片永远嵌不进去。
        let line_number = line_no + 1;
        for (img_idx, (path, _alt)) in extract_inline_images(line).into_iter().enumerate() {
            let Some(bytes) = load_image_bytes(&path, source_path) else {
                continue;
            };
            image_markers.insert(format!("IMG_{line_number}_{img_idx}"), bytes);
        }
    }

    // 预收集脚注，使正文中的 `[^N]` 渲染为编号标记，并在文档末尾
    // 追加「Footnotes:」一节列出定义。
    let footnotes = markdown::collect_footnotes(markdown);

    // 跟踪当前所在 mermaid 块的开头围栏行号（不在块内时为 None）。
    let mut in_mermaid_open_line: Option<usize> = None;

    // 检测表格行。Markdown 表格行以 `|` 开头和结尾，且表头之后
    // 紧接一行 `---|---|---` 分隔符。我们用常规字体（表头加粗）
    // 把表格渲染为列网格。
    let mut in_table: bool = false;

    for (idx, line) in markdown.lines().enumerate() {
        let line_number = idx + 1;
        let trimmed = line.trim();

        // 检测 mermaid 开头围栏。
        if trimmed.starts_with("```mermaid") {
            in_mermaid_open_line = Some(line_number);
            continue;
        }

        // 在 mermaid 块内检测结束围栏。
        if in_mermaid_open_line.is_some() && trimmed.starts_with("```") {
            let open_line = in_mermaid_open_line.take().unwrap();
            if let Some(png_bytes) = mermaid_pngs.get(&open_line) {
                // 嵌入预渲染的 PNG。预渲染步骤已在上方完成，
                // 因此这里纯粹是 I/O 操作。
                if let Err(e) = embed_mermaid_png(
                    &mut doc,
                    &mut current_page_idx,
                    &mut current_layer_idx,
                    &mut y,
                    margin,
                    content_width,
                    line_height,
                    png_bytes,
                ) {
                    render_fallback_text(
                        &mut doc,
                        &mut current_page_idx,
                        &mut current_layer_idx,
                        &mut y,
                        margin,
                        content_width,
                        line_height,
                        &fonts,
                        &format!("[Mermaid render error: {}]", e),
                    );
                }
            } else {
                // 预渲染失败（mmdc 缺失或图表无效）。
                // 放一行占位文本，让用户知道图表本该在哪里。
                render_fallback_text(
                    &mut doc,
                    &mut current_page_idx,
                    &mut current_layer_idx,
                    &mut y,
                    margin,
                    content_width,
                    line_height,
                    &fonts,
                    "[Mermaid diagram unavailable: mmdc not installed or render failed]",
                );
            }
            continue;
        }

        // 在 mermaid 块内时跳过源行——渲染出的 PNG 就是全部内容。
        if in_mermaid_open_line.is_some() {
            continue;
        }

        // 表格行检测。行形如 `| col | col |`，分隔符形如 `| --- | --- |`。
        // 我们把表格渲染为按表头宽度定列的网格。
        if is_table_row(trimmed) {
            let cols = parse_table_row(trimmed);
            if !in_table {
                in_table = true;
                // 紧跟表头行之后的一行是分隔符；跳过它（无文本）。
                if let Some(next) = markdown.lines().nth(idx + 1) {
                    if is_table_separator(next.trim()) {
                        // 标记在下次迭代跳过分隔符时重新检测。
                        // 我们用简单的状态：现在就用粗体渲染表头，
                        // 由下次循环迭代检测分隔符。
                        render_table_row(
                            &mut doc,
                            &mut current_page_idx,
                            &mut current_layer_idx,
                            &mut y,
                            margin,
                            content_width,
                            &fonts,
                            true,
                            &cols,
                        );
                        continue;
                    }
                }
            }
            render_table_row(
                &mut doc,
                &mut current_page_idx,
                &mut current_layer_idx,
                &mut y,
                margin,
                content_width,
                &fonts,
                false,
                &cols,
            );
            continue;
        } else if in_table {
            // 表格后的第一行非表格行——以一个小间距结束表格。
            in_table = false;
            y -= line_height * 0.5;
        }

        // 图片嵌入。对本行出现的每个预加载图片，在其余文本之前嵌入。
        // 一行的多张图片按 img_idx 升序纵向堆叠——直接枚举
        // HashMap 键的迭代顺序是任意的，会打乱多图顺序。
        let prefix = format!("IMG_{line_number}_");
        let mut img_idxs: Vec<usize> = image_markers
            .keys()
            .filter_map(|k| k.strip_prefix(&prefix)?.parse().ok())
            .collect();
        img_idxs.sort_unstable();
        for img_idx in img_idxs {
            if let Some(png_bytes) = image_markers.get(&format!("IMG_{line_number}_{img_idx}")) {
                if let Err(e) = embed_mermaid_png(
                    &mut doc,
                    &mut current_page_idx,
                    &mut current_layer_idx,
                    &mut y,
                    margin,
                    content_width,
                    line_height,
                    png_bytes,
                ) {
                    render_fallback_text(
                        &mut doc,
                        &mut current_page_idx,
                        &mut current_layer_idx,
                        &mut y,
                        margin,
                        content_width,
                        line_height,
                        &fonts,
                        &format!("[Image embed error: {}]", e),
                    );
                }
            }
        }

        // 常规 Markdown 行：标题检测 + 纯文本。
        if trimmed.is_empty() {
            y -= line_height * 0.5;
            continue;
        }

        // 标题检测
        let (text, size, is_bold) = if let Some(rest) = trimmed.strip_prefix("# ") {
            (rest, 16.0, true)
        } else if let Some(rest) = trimmed.strip_prefix("## ") {
            (rest, 14.0, true)
        } else if let Some(rest) = trimmed.strip_prefix("### ") {
            (rest, 12.0, true)
        } else if let Some(rest) = trimmed.strip_prefix("#### ") {
            (rest, 11.0, true)
        } else {
            (trimmed, 9.0, false)
        };

        // 对纯文本输出去除基础 Markdown 格式，然后把 `[^id]`
        // 引用替换为文档顺序号 `[N]`。
        let clean_text = substitute_footnote_refs(&strip_markdown(text), &footnotes);

        // 在 content_width 内换行
        let chars_per_line = (content_width / (size * 0.35)) as usize;
        let wrapped_lines = wrap_text(&clean_text, chars_per_line.max(20));

        for wrapped_line in &wrapped_lines {
            // 检查是否需要开新页
            if y < margin {
                let (new_page, new_layer) = add_page(&mut doc);
                current_page_idx = new_page;
                current_layer_idx = new_layer;
                y = Mm(277.0).0;
            }

            let layer = doc.get_page(current_page_idx).get_layer(current_layer_idx);

            fonts.draw_line(&layer, wrapped_line, size, margin, y, is_bold);

            y -= line_height;
        }
    }

    // 在正文末尾追加「Footnotes:」一节，让读者能找到脚注文本。
    // 我们不为该节做像 HTML 导出那样精细的排版——只是用空行分隔的
    // 纯编号段落。
    if !footnotes.is_empty() {
        // 在当页预留空间，或开新页。
        if y < margin + line_height * 3.0 {
            let (new_page, new_layer) = add_page(&mut doc);
            current_page_idx = new_page;
            current_layer_idx = new_layer;
            y = Mm(277.0).0;
        }
        // 章节标题。
        y -= line_height;
        let layer = doc.get_page(current_page_idx).get_layer(current_layer_idx);
        fonts.draw_line(&layer, "Footnotes", 11.0, margin, y, true);
        y -= line_height;

        for note in &footnotes {
            if y < margin {
                let (new_page, new_layer) = add_page(&mut doc);
                current_page_idx = new_page;
                current_layer_idx = new_layer;
                y = Mm(277.0).0;
            }
            let layer = doc.get_page(current_page_idx).get_layer(current_layer_idx);
            let header = format!("[{}] {}", note.number, note.content);
            let chars_per_line = (content_width / (9.0 * 0.35)) as usize;
            for line in wrap_text(&header, chars_per_line.max(20)) {
                fonts.draw_line(&layer, &line, 9.0, margin, y, false);
                y -= line_height;
            }
            y -= line_height * 0.3;
        }
    }

    // 原子化保存：先写同目录下的临时文件再重命名，保存中断时
    // 磁盘上要么是完整旧文件、要么是完整新文件，不留半截 PDF。
    let tmp_path = format!("{}.tmp", output_path);
    let save_result: Result<(), String> = (|| {
        let file = File::create(&tmp_path).map_err(|e| e.to_string())?;
        doc.save(&mut BufWriter::new(file)).map_err(|e| e.to_string())
    })();
    match save_result {
        Ok(()) => std::fs::rename(&tmp_path, output_path).map_err(|e| e.to_string())?,
        Err(e) => {
            let _ = std::fs::remove_file(&tmp_path);
            return Err(e);
        }
    }

    Ok(())
}

fn create_document(title: &str) -> (PdfDocumentReference, PdfPageIndex, PdfLayerIndex) {
    PdfDocument::new(title, Mm(210.0), Mm(297.0), "Layer 1")
}

pub(crate) fn add_page(doc: &mut PdfDocumentReference) -> (PdfPageIndex, PdfLayerIndex) {
    doc.add_page(Mm(210.0), Mm(297.0), "Layer 1")
}

/// 将预渲染的 mermaid PNG 嵌入当前页，缩放至内容宽度并保持源宽高比。
/// PNG 无法解码时返回 `Err`。
// 参数多是因为要透传 printpdf 的可变页面状态（doc/页/图层/y）与版式常量。
#[allow(clippy::too_many_arguments)]
fn embed_mermaid_png(
    doc: &mut PdfDocumentReference,
    current_page_idx: &mut PdfPageIndex,
    current_layer_idx: &mut PdfLayerIndex,
    y: &mut f32,
    margin: f32,
    content_width: f32,
    line_height: f32,
    png_bytes: &[u8],
) -> Result<(), String> {
    // 把 PNG 解码为 DynamicImage，再用 printpdf 的 Image 包装。
    let dyn_img = load_from_memory(png_bytes).map_err(|e| format!("PNG decode error: {}", e))?;
    let img = Image::from_dynamic_image(&dyn_img);
    let (src_w, src_h) = (dyn_img.width() as f32, dyn_img.height() as f32);
    if src_w <= 0.0 || src_h <= 0.0 {
        return Err("invalid PNG dimensions".into());
    }

    // 缩放至内容宽度。图片高度（mm）为 (content_width / src_w) * src_h。
    // 限制高度，使很高的图表不会溢出页面。
    let scale: f32 = content_width / src_w;
    let drawn_h_mm: f32 = (src_h * scale).min(220.0); // 给周围文本留约 50mm

    // 若纵向空间不足则先分页。
    if *y - drawn_h_mm < margin {
        let (new_page, new_layer) = add_page(doc);
        *current_page_idx = new_page;
        *current_layer_idx = new_layer;
        *y = Mm(277.0).0;
    }

    let layer = doc.get_page(*current_page_idx).get_layer(*current_layer_idx);
    img.add_to_layer(
        layer,
        ImageTransform {
            translate_x: Some(Mm(margin)),
            translate_y: Some(Mm(*y - drawn_h_mm)),
            scale_x: Some(scale),
            scale_y: Some(scale),
            dpi: Some(300.0),
            rotate: None,
        },
    );

    *y -= drawn_h_mm + line_height;
    Ok(())
}

// 参数多是因为要透传 printpdf 的可变页面状态（doc/页/图层/y）与版式常量。
#[allow(clippy::too_many_arguments)]
fn render_fallback_text(
    doc: &mut PdfDocumentReference,
    current_page_idx: &mut PdfPageIndex,
    current_layer_idx: &mut PdfLayerIndex,
    y: &mut f32,
    margin: f32,
    content_width: f32,
    line_height: f32,
    fonts: &FontSet,
    text: &str,
) {
    let chars_per_line = (content_width / (9.0 * 0.35)) as usize;
    let wrapped = wrap_text(text, chars_per_line.max(20));
    for line in &wrapped {
        if *y < margin {
            let (new_page, new_layer) = add_page(doc);
            *current_page_idx = new_page;
            *current_layer_idx = new_layer;
            *y = Mm(277.0).0;
        }
        let layer = doc.get_page(*current_page_idx).get_layer(*current_layer_idx);
        fonts.draw_line(&layer, line, 9.0, margin, *y, false);
        *y -= line_height;
    }
}

#[test]
fn test_strip_markdown() {
    assert_eq!(strip_markdown("**bold**"), "bold");
    assert_eq!(strip_markdown("plain text"), "plain text");
}

/// 最小的 1×1 红色像素 PNG（8-bit RGB），69 字节。
#[cfg(test)]
const MIN_PNG: &[u8] = &[
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG 签名
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1×1
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, // 8-bit RGB
    0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, // IDAT
    0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x03, 0x01, 0x01, 0x00,
    0xc9, 0xfe, 0x92, 0xef, // IDAT CRC
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, // IEND
    0xae, 0x42, 0x60, 0x82, // IEND CRC
];

#[test]
fn export_pdf_embeds_inline_image() {
    // 行内图片必须真正嵌入（旧实现因 0-based/1-based 行号
    // 不一致，`IMG_*` 标记永远查不到，图片静默丢失）。
    let dir = std::env::temp_dir().join(format!("markpure-pdf-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let img = dir.join("pixel.png");
    std::fs::write(&img, MIN_PNG).unwrap();
    let out = dir.join("out.pdf");

    let md = format!("before\n\n![alt]({})\n\nafter", img.display());
    export_pdf(
        &md,
        "T",
        out.display().to_string().leak(),
        Some(img.display().to_string().leak()),
    )
    .expect("export should succeed");

    let pdf_bytes = std::fs::read(&out).unwrap();
    let s = String::from_utf8_lossy(&pdf_bytes).to_string();
    assert!(
        s.contains("Image"),
        "embedded image XObject missing from PDF"
    );
    assert!(
        !s.contains("Image embed error"),
        "image fallback text present — embed failed"
    );

    // 原子写：保存后不得残留 .tmp 文件。
    assert!(!out.with_extension("pdf.tmp").exists(), "tmp file left behind");

    let _ = std::fs::remove_file(&out);
    let _ = std::fs::remove_file(&img);
}
