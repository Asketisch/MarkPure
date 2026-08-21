//! 工作区级扫描：标签索引、代码片段列表、按工作区加载的 CSS，
//! 以及反向链接。这四个功能都用 `walkdir` 遍历文件夹树并聚合结果，
//! 因此放在同一个文件中，共享 `is_hidden` 辅助函数和导入。
//!
//! 这些命令按「重复实现多根支持」的方式工作：每次调用只接受
//! 单个 `path`，需要跨根扫描时渲染器会对每个根各调用一次。
//! 跨根聚合属于后续迭代的范畴。

use std::collections::HashMap;
use std::path::Path;
use walkdir::WalkDir;

// ============================== 标签（P0-7） ==============================

/// 从参数中提取 `paths: Vec<String>` / `path: String`，应用与其他
/// 扫描命令相同的多根回退规则。按调用顺序返回解析后的列表；
/// 不存在的路径会保留（各扫描循环会跳过它们），这样调用方无需预先过滤。
///
/// `pub(super)` 以便 [`backlinks`] 子模块复用相同的
/// `path`/`paths` 解析规则。
pub(super) fn extract_root_paths(
    params: &serde_json::Value,
) -> std::result::Result<Vec<String>, String> {
    let mut paths: Vec<String> = params["paths"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    if paths.is_empty() {
        if let Some(p) = params["path"].as_str() {
            paths.push(p.to_string());
        }
    }
    if paths.is_empty() {
        return Err("Missing 'path' or 'paths' parameter".to_string());
    }
    Ok(paths)
}

/// 把工作区内所有 `#标签` 聚合成 `{name, count, files[]}` 索引。
/// 渲染器用它在「标签」面板中填充数据，并构建「按标签过滤」的搜索结果。
///
/// 多根：接受 `paths: Vec<String>` 用于跨根扫描（回退到旧版
/// `path: String`）。各根下的标签计数以渲染器已消费的
/// `(name → count, files)` 索引形状合并；标签文件会去重，
/// 因此同时存在于根 A 和根 B 的标签只有当文件路径完全相同时
/// 才会在同一文件上计两次（很少见，通常无影响）。
///
/// 范围：只扫描 `.md` / `.markdown` / `.mdx` 扩展名的文件。
/// 非文本内容通过与工作区搜索相同的 UTF-8 读取方式跳过
/// （留作后续改进；渲染器已能容忍不可读文件）。
pub fn cmd_get_workspace_tags(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let path_strs = extract_root_paths(params)?;
    let max_depth = params["max_depth"].as_u64().unwrap_or(10) as usize;
    let show_hidden = params["show_hidden"].as_bool().unwrap_or(false);

    // 索引结构：标签名 -> { 出现次数, 文件列表 }
    let mut index: HashMap<String, (u32, Vec<String>)> = HashMap::new();

    for path_str in &path_strs {
        let root = Path::new(path_str);
        if !root.exists() {
            continue;
        }
        for entry in WalkDir::new(root)
            .max_depth(max_depth)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| show_hidden || !is_hidden(e))
            .filter_map(|e| e.ok())
        {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let ext = path
                .extension()
                .and_then(|s| s.to_str())
                .map(|s| s.to_ascii_lowercase());
            if !matches!(ext.as_deref(), Some("md") | Some("markdown") | Some("mdx")) {
                continue;
            }
            let content = match std::fs::read_to_string(path) {
                Ok(c) => c,
                Err(_) => continue, // 二进制文件或权限被拒——跳过
            };
            for tag in markdown::extract_tags(&content) {
                let entry = index.entry(tag.name).or_insert((0, Vec::new()));
                entry.0 += 1;
                let path_str = path.to_string_lossy().to_string();
                if !entry.1.iter().any(|p| p == &path_str) {
                    entry.1.push(path_str);
                }
            }
        }
    }

    // 稳定的字母序排序，方便渲染器展示。
    let mut tags: Vec<serde_json::Value> = index
        .into_iter()
        .map(|(name, (count, files))| {
            serde_json::json!({
                "name": name,
                "count": count,
                "files": files,
            })
        })
        .collect();
    tags.sort_by(|a, b| {
        let an = a["name"].as_str().unwrap_or("");
        let bn = b["name"].as_str().unwrap_or("");
        an.cmp(bn)
    });

    Ok(serde_json::json!({ "tags": tags }))
}

// ============================== 代码片段（P2-5） ==============================

/// 列出存储在 `~/.config/markpure/snippets/*.md` 中的用户代码片段。
/// 每个片段的名字（文件名去掉 `.md`）就是其短代码。内容即文件内容。
/// 这里不展开 `$1`/`{{date}}` 等占位符——由渲染器负责。列表按字母序排列。
pub fn cmd_list_snippets() -> std::result::Result<serde_json::Value, String> {
    let dir = mt_core::AppConfig::config_path()
        .parent()
        .map(|p| p.join("snippets"))
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return Err(format!("Failed to create snippets dir: {}", e));
    }
    let mut entries: Vec<(String, String)> = Vec::new();
    for entry in WalkDir::new(&dir)
        .max_depth(2)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let p = entry.path();
        if !p.is_file() {
            continue;
        }
        let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("");
        if !ext.eq_ignore_ascii_case("md") {
            continue;
        }
        let name = p
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string())
            .unwrap_or_default();
        if name.is_empty() {
            continue;
        }
        if let Ok(content) = std::fs::read_to_string(p) {
            entries.push((name, content));
        }
    }
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    let snippets: Vec<serde_json::Value> = entries
        .into_iter()
        .map(|(name, content)| serde_json::json!({ "name": name, "content": content }))
        .collect();
    Ok(serde_json::json!({ "snippets": snippets }))
}

// ============================== 按工作区加载 CSS（P1-7） ==============================

/// 读取 `<workspace>/.markpure/styles/` 下的所有 `*.css` 文件并拼接返回。
/// 渲染器把返回的字符串注入全局 <style> 元素，使按工作区定制的样式
/// 覆盖全局主题。文件按字母序读取，用户可用 `01-…`、`02-…` 前缀
/// 控制顺序。不存在的文件会被静默忽略——没有 `.markpure/styles/`
/// 目录是正常情况，不是错误。
///
/// 多根：当提供 `paths: Vec<String>` 时，各根的样式按根路径的**字典序**
/// 拼接，且**活动根的样式最后输出**，让它的 CSS 规则在级联中胜出——
/// 这是单根版本已有「更具体的胜出」规则（字母序靠后的文件胜出）在
/// 多根场景下的变体。可选的 `active_root_path` 字段告诉处理器
/// 哪个根应该放在最后；缺省时 `paths` 的第一个元素视为活动根。
pub fn cmd_load_workspace_styles(
    params: &serde_json::Value,
) -> std::result::Result<serde_json::Value, String> {
    let path_strs = extract_root_paths(params)?;
    let active_root_path = params["active_root_path"].as_str();

    // 对根排序，让活动根排在最后。其余根按路径排序，保证多次调用时
    // 顺序稳定。
    let mut roots = path_strs.clone();
    roots.sort();
    if let Some(active) = active_root_path {
        if let Some(idx) = roots.iter().position(|r| r == active) {
            let active_root = roots.remove(idx);
            roots.push(active_root);
        }
    }

    let mut combined = String::new();
    let mut files = Vec::new();
    for path_str in &roots {
        let root = Path::new(path_str);
        if !root.exists() {
            continue;
        }
        let styles_dir = root.join(".markpure").join("styles");
        if !styles_dir.exists() {
            continue;
        }

        let mut entries: Vec<(String, std::path::PathBuf)> = Vec::new();
        for entry in WalkDir::new(&styles_dir)
            .max_depth(2)
            .follow_links(false)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let p = entry.path();
            if p.is_file()
                && p.extension()
                    .and_then(|s| s.to_str())
                    .map(|s| s.eq_ignore_ascii_case("css"))
                    .unwrap_or(false)
            {
                entries.push((
                    p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default(),
                    p.to_path_buf(),
                ));
            }
        }
        entries.sort_by(|a, b| a.0.cmp(&b.0));

        for (name, p) in &entries {
            match std::fs::read_to_string(p) {
                Ok(c) => {
                    combined.push_str(&format!("\n/* === {} ({}) === */\n", name, path_str));
                    combined.push_str(&c);
                    combined.push('\n');
                    files.push(name.clone());
                }
                Err(_) => continue,
            }
        }
    }

    Ok(serde_json::json!({ "css": combined, "files": files }))
}

// ============================== 共享辅助函数 ==============================

/// 若目录条目的名字以点开头则返回 true——默认情况下
/// （`show_hidden=false`）这些条目会从工作区扫描中跳过。
///
/// `pub(super)` 以便 [`backlinks`] 子模块复用同一套
/// 「什么算隐藏」的规则而无需重复实现。
pub(super) fn is_hidden(entry: &walkdir::DirEntry) -> bool {
    entry
        .file_name()
        .to_str()
        .map(|s| s.starts_with('.'))
        .unwrap_or(false)
}

