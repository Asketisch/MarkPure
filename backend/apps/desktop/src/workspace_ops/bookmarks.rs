// ============================== Bookmarks ==============================

pub fn cmd_get_bookmarks() -> std::result::Result<serde_json::Value, String> {
    let list = bookmark::load_bookmarks().map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(list).map_err(|e| e.to_string())?)
}

pub fn cmd_add_bookmark(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let path = params["path"].as_str().ok_or("Missing 'path'")?;
    let title = params["title"].as_str().ok_or("Missing 'title'")?;
    let tags: Vec<String> = params["tags"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    // P2-4: optional multi-root binding. Old callers that
    // don't supply the field get `None` — the bookmark is
    // treated as "untagged / unknown root" by the renderer.
    let workspace_root_id = params["workspace_root_id"].as_str();
    let bm = bookmark::add_bookmark(path, title, tags, workspace_root_id)
        .map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(bm).map_err(|e| e.to_string())?)
}

pub fn cmd_update_bookmark(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let id = params["id"].as_str().ok_or("Missing 'id'")?;
    let title = params.get("title").and_then(|v| v.as_str());
    let description = params.get("description").and_then(|v| v.as_str());
    let tags = params.get("tags").and_then(|v| v.as_array()).map(|a| {
        a.iter()
            .filter_map(|v| v.as_str().map(String::from))
            .collect()
    });
    let bm = bookmark::update_bookmark(id, title, description, tags)
        .map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(bm).map_err(|e| e.to_string())?)
}

pub fn cmd_remove_bookmark(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let id = params["id"].as_str().ok_or("Missing 'id'")?;
    bookmark::remove_bookmark(id).map_err(|e| e.to_string())?;
    Ok(serde_json::Value::Null)
}
