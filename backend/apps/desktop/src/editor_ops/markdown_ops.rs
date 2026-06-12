//! Markdown-extension helpers: frontmatter, table transforms, code
//! folding, pandoc-style task items.
//!
//! All four are pure functions of the input `content` string —
//! no `AppState` access — so they share an `editor_ops/`
//! sub-module to keep `editor_ops/mod.rs` focused on the
//! "needs state" handlers (LRU registry, spell check).

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

// ============================== Table ==============================

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
    let mut csv = String::new();
    for row in &structure.rows {
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

// ============================== Folding ==============================

pub fn cmd_compute_folds(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"].as_str().ok_or("Missing 'content'")?;
    let ranges = markdown::compute_folding_ranges(content);
    Ok(serde_json::to_value(ranges).map_err(|e| e.to_string())?)
}

// ============================== Pandoc ==============================

pub fn cmd_parse_task_items(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let content = params["content"].as_str().ok_or("Missing 'content'")?;
    let items = markdown::parse_task_items(content);
    Ok(serde_json::to_value(items).map_err(|e| e.to_string())?)
}
