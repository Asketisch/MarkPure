//! 搜索结果预览生成
//!
//! 提供生成带上下文搜索结果预览的功能。

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// 搜索匹配周围的预览上下文
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchPreview {
    /// 完整文件路径
    pub file_path: String,
    /// 匹配所在行号（从 1 开始）
    pub line_number: usize,
    /// 匹配之前的上下文行
    pub context_before: Vec<String>,
    /// 匹配行本身
    pub match_line: String,
    /// 匹配之后的上下文行
    pub context_after: Vec<String>,
    /// 文件总行数
    pub total_lines: usize,
    /// 匹配起始列
    pub match_start: usize,
    /// 匹配结束列
    pub match_end: usize,
}

/// 获取搜索匹配及其周围上下文的预览
///
/// # 参数
/// * `file_path` - 文件路径
/// * `line` - 匹配所在行号（从 1 开始）
/// * `match_start` - 匹配起始列（从 0 开始）
/// * `match_end` - 匹配结束列（从 0 开始）
/// * `context` - 前后各包含多少行上下文（默认 3）
pub fn get_search_preview(
    file_path: &str,
    line: usize,
    match_start: usize,
    match_end: usize,
    context: usize,
) -> Result<SearchPreview, String> {
    let path = PathBuf::from(file_path);
    // 复用 crate 根部的编码检测读取（UTF-8 → GBK → lossy UTF-8），
    // 避免两份读取逻辑漂移。
    let content = super::read_file_content(&path).map_err(|e| e.to_string())?;
    let lines: Vec<&str> = content.lines().collect();
    let total_lines = lines.len();

    let line_idx = line.saturating_sub(1);
    if line_idx >= total_lines {
        return Err("Line number out of range".to_string());
    }

    // 获取上文
    let start_idx = line_idx.saturating_sub(context);
    let context_before: Vec<String> = lines[start_idx..line_idx]
        .iter()
        .map(|s| s.to_string())
        .collect();

    // 获取下文
    let end_idx = (line_idx + context + 1).min(total_lines);
    let context_after: Vec<String> = lines[(line_idx + 1)..end_idx]
        .iter()
        .map(|s| s.to_string())
        .collect();

    Ok(SearchPreview {
        file_path: file_path.to_string(),
        line_number: line,
        context_before,
        match_line: lines[line_idx].to_string(),
        context_after,
        total_lines,
        match_start,
        match_end,
    })
}

/// 获取同一文件中多个搜索匹配的预览
pub fn get_file_preview(
    file_path: &str,
    matches: &[(usize, usize)], // (行号, 列) 对
    context: usize,
) -> Vec<SearchPreview> {
    let mut previews = Vec::new();

    // 按行分组匹配，避免重复读文件
    let mut line_matches: std::collections::HashMap<usize, Vec<(usize, usize)>> =
        std::collections::HashMap::new();

    for &(line, col_start) in matches {
        line_matches.entry(line).or_default().push((col_start, col_start + 1)); // 简化处理
    }

    for (line, cols) in line_matches {
        // 预览用第一列，但记录所有匹配
        let match_start = cols[0].0;
        let match_end = cols.iter().map(|(_, e)| *e).max().unwrap_or(match_start + 1);

        if let Ok(preview) = get_search_preview(file_path, line, match_start, match_end, context) {
            previews.push(preview);
        }
    }

    previews
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_preview_structure() {
        let preview = SearchPreview {
            file_path: "/test/file.md".to_string(),
            line_number: 5,
            context_before: vec!["line 4".to_string()],
            match_line: "line 5 with match".to_string(),
            context_after: vec!["line 6".to_string()],
            total_lines: 10,
            match_start: 10,
            match_end: 16,
        };

        assert_eq!(preview.line_number, 5);
        assert_eq!(preview.context_before.len(), 1);
        assert_eq!(preview.context_after.len(), 1);
    }
}
