//! Markdown 扩展辅助：frontmatter、表格转换、代码折叠、
//! pandoc 风格任务项。
//!
//! 这四类都是输入 `content` 字符串的纯函数——不访问 `AppState`——
//! 因此共享一个 `editor_ops/` 子模块，让 `editor_ops/mod.rs` 专注于
//! 「需要状态」的处理器（LRU 注册表、拼写检查）。

// ============================== Frontmatter ==============================

pub fn cmd_parse_frontmatter(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"].as_str().ok_or("Missing 'content'")?;
    let bounds = markdown::find_frontmatter(content);
    let parsed = markdown::parse_frontmatter(content);
    Ok(serde_json::json!({ "bounds": bounds, "frontmatter": parsed }))
}

pub fn cmd_update_frontmatter_field(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"].as_str().ok_or("Missing 'content'")?;
    let key = params["key"].as_str().ok_or("Missing 'key'")?;
    let value = params["value"].as_str().unwrap_or("");
    match markdown::update_frontmatter_field(content, key, value) {
        Some(updated) => Ok(serde_json::json!({ "content": updated })),
        None => Err("no frontmatter block present".to_string()),
    }
}

// ============================== Markdown 整理 ==============================

/// 独立的 `lint_markdown` IPC。设置面板的「预览整理结果」按钮用
/// 当前编辑器内容调用它，让用户可以在打开开关之前看到差异。
/// 当 `config.editor.lint_on_save` 为 true 时，`cmd_save_file`
/// 会就地应用相同的规则（见 `file_ops/open_save.rs`）。
pub fn cmd_lint_markdown(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"].as_str().ok_or("Missing 'content'")?;
    let rules = vec![
        mt_core::LintRule::TrimTrailingWhitespace,
        mt_core::LintRule::EnsureFinalNewline,
        mt_core::LintRule::CollapseExcessBlankLines,
    ];
    let (cleaned, report) = mt_core::lint_markdown(content, &rules);
    Ok(serde_json::json!({
        "content": cleaned,
        "report": report,
    }))
}

// ============================== 表格 ==============================

pub fn cmd_transform_table(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"].as_str().ok_or("Missing 'content'")?;
    let op: markdown::TableOpType = serde_json::from_value(params["op"].clone())
        .map_err(|e| format!("invalid op: {}", e))?;
    let start = params["start"].as_u64().unwrap_or(0) as usize;
    let end = params["end"].as_u64().unwrap_or(0) as usize;
    let table_md = content.get(start..end).ok_or("invalid range")?;
    let transformed = markdown::transform_table(table_md, &op)
        .ok_or_else(|| "table transform failed".to_string())?;
    Ok(serde_json::json!({ "transformed": transformed, "start": start, "end": end }))
}

pub fn cmd_align_table_column(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"].as_str().ok_or("Missing 'content'")?;
    let start = params["start"].as_u64().unwrap_or(0) as usize;
    let end = params["end"].as_u64().unwrap_or(0) as usize;
    let col_idx = params["col"].as_u64().unwrap_or(0) as usize;
    let alignment = params["alignment"].as_str().unwrap_or("default");
    let table_md = content.get(start..end).ok_or("invalid range")?;
    let op = match alignment {
        "left" => markdown::TableOpType::FormatAlign {
            col_idx,
            align: markdown::CellAlign::Left,
        },
        "center" => markdown::TableOpType::FormatAlign {
            col_idx,
            align: markdown::CellAlign::Center,
        },
        "right" => markdown::TableOpType::FormatAlign {
            col_idx,
            align: markdown::CellAlign::Right,
        },
        _ => markdown::TableOpType::FormatAlign {
            col_idx,
            align: markdown::CellAlign::None,
        },
    };
    let transformed = markdown::transform_table(table_md, &op)
        .ok_or_else(|| "table transform failed".to_string())?;
    Ok(serde_json::json!({ "transformed": transformed, "start": start, "end": end }))
}

pub fn cmd_to_csv(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"].as_str().ok_or("Missing 'content'")?;
    let start = params["start"].as_u64().unwrap_or(0) as usize;
    let end = params["end"].as_u64().unwrap_or(0) as usize;
    let table_md = content.get(start..end).ok_or("invalid range")?;
    let structure = markdown::parse_table(table_md).ok_or("not a valid table")?;

    // 表头行必须写进 CSV——否则列名会整个丢失，导出的表格再也无法
    // 与原文对应。`parse_table` 把表头放在 `headers`、数据行放在
    // `rows`，两者都要输出。
    let mut rows: Vec<&Vec<String>> = Vec::with_capacity(structure.rows.len() + 1);
    rows.push(&structure.headers);
    for row in &structure.rows {
        rows.push(row);
    }

    let mut csv = String::new();
    for row in rows {
        let cells: Vec<String> = row
            .iter()
            .map(|c| {
                if c.contains(',') || c.contains('"') || c.contains('\n') {
                    format!("\"{}\"", c.replace('"', "\"\""))
                } else {
                    c.clone()
                }
            })
            .collect();
        csv.push_str(&cells.join(","));
        csv.push('\n');
    }
    Ok(serde_json::json!({ "csv": csv }))
}

// ============================== 折叠 ==============================

pub fn cmd_compute_folds(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"].as_str().ok_or("Missing 'content'")?;
    let ranges = markdown::compute_folding_ranges(content);
    serde_json::to_value(ranges).map_err(|e| e.to_string())
}

// ============================== Pandoc ==============================

pub fn cmd_parse_task_items(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"].as_str().ok_or("Missing 'content'")?;
    let items = markdown::parse_task_items(content);
    serde_json::to_value(items).map_err(|e| e.to_string())
}
