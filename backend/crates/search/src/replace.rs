//! 搜索与替换功能
//!
//! 提供跨文件查找和替换文本的功能。

use regex::Regex;
use regex::RegexBuilder;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use walkdir::WalkDir;

use super::{build_pattern, read_file_content, SearchOptions, Error as SearchError};

/// 单处替换：（行号，行内字节起点，行内字节终点，原文，替换文）
type LineChange = (usize, usize, usize, String, String);

/// 搜索 / 替换覆盖的文件扩展名白名单。实际替换与预览必须共用
/// 同一份过滤逻辑，否则两者的结果集会漂移。
const SEARCHABLE_EXTS: &[&str] = &[
    "md", "markdown", "txt", "text", "html", "css", "js", "ts", "jsx",
    "tsx", "json", "yaml", "yml", "toml", "xml", "rs", "py", "go",
    "java", "c", "cpp", "h", "hpp", "swift", "kt", "rb", "php", "sh",
    "bash", "zsh", "vue", "svelte",
];

/// 无扩展名的文件视为可搜索（与历史行为一致）；有扩展名时必须
/// 在白名单内。
fn is_searchable(path: &std::path::Path) -> bool {
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) => SEARCHABLE_EXTS.contains(&ext.to_lowercase().as_str()),
        None => true,
    }
}

/// 用原文件的换行风格（CRLF / LF）与「是否以换行结尾」重新拼接
/// 行。旧实现直接 `lines().join("\n")`，会把 CRLF 文件改写为 LF
/// 并丢掉文件末尾的换行。
fn join_lines(new_lines: &[String], original: &str) -> String {
    let sep = if original.contains("\r\n") { "\r\n" } else { "\n" };
    let mut out = new_lines.join(sep);
    if original.ends_with('\n') {
        out.push_str(sep);
    }
    out
}

/// 表示文件中的单次替换
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplaceResult {
    pub file_path: String,
    pub line_number: usize,
    pub column: usize,
    pub original: String,
    pub replacement: String,
}

/// 跨多个文件的替换操作结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplaceSummary {
    pub results: Vec<ReplaceResult>,
    pub total_files_modified: usize,
    pub total_replacements: usize,
}

/// 不实际修改文件时的替换预览
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplacePreview {
    pub file_path: String,
    pub line_number: usize,
    pub line_before: String,
    pub line_after: String,
    pub replacements: Vec<ReplaceRange>,
}

/// 行内的单个替换区间
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplaceRange {
    pub from: usize,
    pub to: usize,
    pub original: String,
    pub replacement: String,
}

/// 在目录内的文件中替换所有匹配查询的内容
///
/// # 参数
/// * `root_path` - 要搜索的根目录
/// * `query` - 搜索模式
/// * `replacement` - 替换文本
/// * `options` - 搜索选项
pub fn replace_in_files(
    root_path: &PathBuf,
    query: &str,
    replacement: &str,
    options: &SearchOptions,
) -> Result<ReplaceSummary, String> {
    let pattern = build_pattern(query, options).map_err(|e| e.to_string())?;

    let regex: Regex = if options.case_sensitive {
        RegexBuilder::new(&pattern)
            .case_insensitive(false)
            .build()
            .map_err(|e| SearchError::Regex(e).to_string())?
    } else {
        RegexBuilder::new(&pattern)
            .case_insensitive(true)
            .build()
            .map_err(|e| SearchError::Regex(e).to_string())?
    };

    let mut results: Vec<ReplaceResult> = Vec::new();
    let mut files_modified: HashMap<String, Vec<LineChange>> = HashMap::new();

    // 遍历目录并查找匹配
    // 剪枝 + 环护栏。此函数经 `replace_in_workspace` IPC 直接可达
    // 用户输入：`follow_links` 下符号链接环会无限遍历，隐藏目录 /
    // node_modules 不剪枝会把范围外的文件卷进替换（改写不可逆）。
    let walker = WalkDir::new(root_path)
        .follow_links(true)
        .max_depth(options.max_depth.unwrap_or(10))
        .into_iter()
        .filter_entry(|e| {
            if e.depth() == 0 {
                return true;
            }
            e.file_name()
                .to_str()
                .map(|name| !(name.starts_with('.') || name == "node_modules" || name == "target"))
                .unwrap_or(true)
        });

    for entry in walker.into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();

        // 跳过二进制文件
        if super::is_binary_file(&path.to_path_buf()) {
            continue;
        }

        // 只搜索白名单内的文本文件
        if !is_searchable(path) {
            continue;
        }

        let file_path = path.to_string_lossy().to_string();

        if let Ok(content) = read_file_content(&path.to_path_buf()) {
            // (行号, 行内字节起点, 行内字节终点, 原文, 替换文)。
            // 必须保留列偏移——旧实现丢弃列号后在落盘时用
            // `line.find(original)` 重新定位（只命中第一次出现，
            // 且可能命中刚写入的替换文本），同一行出现多次的
            // 匹配会替换错位置。
            let mut file_changes: Vec<(usize, usize, usize, String, String)> = Vec::new();

            for (line_number, line) in content.lines().enumerate() {
                let line_num = line_number + 1;
                for m in regex.find_iter(line) {
                    let original: String = m.as_str().to_string();
                    let repl: String = regex.replace(m.as_str(), replacement).to_string();

                    file_changes.push((line_num, m.start(), m.end(), original.clone(), repl.clone()));
                    results.push(ReplaceResult {
                        file_path: file_path.clone(),
                        line_number: line_num,
                        column: m.start(),
                        original,
                        replacement: repl,
                    });
                }
            }

            if !file_changes.is_empty() {
                // 执行实际的文件修改
                if let Err(e) = apply_replacements_to_file(&path.to_path_buf(), &content, &file_changes) {
                    eprintln!("Warning: Could not modify {}: {}", file_path, e);
                }
                files_modified.insert(file_path, file_changes);
            }
        }
    }

    Ok(ReplaceSummary {
        total_files_modified: files_modified.len(),
        total_replacements: results.len(),
        results,
    })
}

/// 替换文件中的单次出现
pub fn replace_single(
    file_path: &str,
    line: usize,
    from: usize,
    to: usize,
    replacement: &str,
) -> Result<String, String> {
    let path = PathBuf::from(file_path);
    let content = read_file_content(&path).map_err(|e| e.to_string())?;
    let lines: Vec<&str> = content.lines().collect();

    let line_idx = line.saturating_sub(1);
    if line_idx >= lines.len() {
        return Err("Line number out of range".to_string());
    }

    // `from`/`to` 来自调用方（未来将是 IPC）：必须校验为行内的
    // 合法字节边界，否则 `replace_range` 会因越界或落在多字节
    // 字符中间而 panic。
    let line = lines[line_idx];
    let from = from.min(line.len());
    let to = to.min(line.len()).max(from);
    if !line.is_char_boundary(from) || !line.is_char_boundary(to) {
        return Err("Replacement range is not on a character boundary".to_string());
    }

    let mut modified_line = line.to_string();
    modified_line.replace_range(from..to, replacement);

    let mut new_lines: Vec<String> = lines.iter().map(|s| s.to_string()).collect();
    new_lines[line_idx] = modified_line;

    let new_content = join_lines(&new_lines, &content);
    fs::write(&path, new_content.as_bytes()).map_err(|e| e.to_string())?;

    Ok(new_content)
}

/// 预览替换而不实际修改文件
pub fn preview_replace(
    root_path: &PathBuf,
    query: &str,
    replacement: &str,
    options: &SearchOptions,
) -> Result<Vec<ReplacePreview>, String> {
    let pattern = build_pattern(query, options).map_err(|e| e.to_string())?;

    let regex: Regex = if options.case_sensitive {
        RegexBuilder::new(&pattern)
            .case_insensitive(false)
            .build()
            .map_err(|e| SearchError::Regex(e).to_string())?
    } else {
        RegexBuilder::new(&pattern)
            .case_insensitive(true)
            .build()
            .map_err(|e| SearchError::Regex(e).to_string())?
    };

    // 键必须包含文件路径——旧实现只用行号做键，跨文件同编号的行会
    // 互相覆盖，导致预览丢失其他文件的结果。
    let mut file_preview: HashMap<(String, usize), ReplacePreview> = HashMap::new();

    // 剪枝 + 环护栏。此函数经 `replace_in_workspace` IPC 直接可达
    // 用户输入：`follow_links` 下符号链接环会无限遍历，隐藏目录 /
    // node_modules 不剪枝会把范围外的文件卷进替换（改写不可逆）。
    let walker = WalkDir::new(root_path)
        .follow_links(true)
        .max_depth(options.max_depth.unwrap_or(10))
        .into_iter()
        .filter_entry(|e| {
            if e.depth() == 0 {
                return true;
            }
            e.file_name()
                .to_str()
                .map(|name| !(name.starts_with('.') || name == "node_modules" || name == "target"))
                .unwrap_or(true)
        });

    for entry in walker.into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();

        if super::is_binary_file(&path.to_path_buf()) {
            continue;
        }

        // 与 `replace_in_files` 使用同一份扩展名过滤，
        // 保证「预览」与「实际替换」作用在相同的文件集合上。
        if !is_searchable(path) {
            continue;
        }

        let file_path_str = path.to_string_lossy().to_string();

        if let Ok(content) = read_file_content(&path.to_path_buf()) {
            let lines: Vec<&str> = content.lines().collect();

            for (line_number, line) in lines.iter().enumerate() {
                let line_num = line_number + 1;
                let mut line_ranges: Vec<ReplaceRange> = Vec::new();

                for m in regex.find_iter(line) {
                    let from = m.start();
                    let to = m.end();
                    let original: String = m.as_str().to_string();
                    let repl: String = regex.replace(m.as_str(), replacement).to_string();

                    line_ranges.push(ReplaceRange {
                        from,
                        to,
                        original,
                        replacement: repl,
                    });
                }

                if !line_ranges.is_empty() {
                    let mut new_line = line.to_string();
                    // 按逆序应用替换，以保持位置不变
                    for range in line_ranges.iter().rev() {
                        new_line.replace_range(range.from..range.to, &range.replacement);
                    }

                    file_preview.insert((file_path_str.clone(), line_num), ReplacePreview {
                        file_path: file_path_str.clone(),
                        line_number: line_num,
                        line_before: line.to_string(),
                        line_after: new_line,
                        replacements: line_ranges,
                    });
                }
            }
        }
    }

    // 汇总预览
    let mut all_previews: Vec<ReplacePreview> = file_preview.into_values().collect();
    all_previews.sort_by_key(|p| (p.file_path.clone(), p.line_number));

    Ok(all_previews)
}

/// 把替换应用到文件。
///
/// 按解析时记录的**精确字节偏移**落盘，按列降序应用（从行尾到
/// 行首），保证前面的偏移始终有效。旧实现丢弃列号、落盘时用
/// `line.find(original)` 重新定位：同一行出现多次的匹配只有第一
/// 次能被正确替换，且 `find` 可能命中刚写入的替换文本，把文件改坏。
fn apply_replacements_to_file(
    path: &PathBuf,
    content: &str,
    changes: &[LineChange],
) -> Result<(), std::io::Error> {
    let mut new_lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();

    // 按行分组变更
    let mut changes_by_line: HashMap<usize, Vec<&LineChange>> = HashMap::new();
    for change in changes {
        changes_by_line.entry(change.0).or_default().push(change);
    }

    for (line_num, line_changes) in changes_by_line {
        let line_idx = line_num.saturating_sub(1);
        if line_idx >= new_lines.len() {
            continue;
        }

        // 按列降序排序，从行尾应用到行首
        let mut sorted_changes: Vec<&LineChange> = line_changes.clone();
        sorted_changes.sort_by_key(|c| std::cmp::Reverse(c.1));

        for (_, from, to, _, replacement) in &sorted_changes {
            // 偏移来自同一份内容的解析结果，正常不会越界；
            // 仍做防御性截断，避免任何上游改动让 replace_range panic。
            let line_len = new_lines[line_idx].len();
            let from = (*from).min(line_len);
            let to = (*to).min(line_len).max(from);
            new_lines[line_idx].replace_range(from..to, replacement);
        }
    }

    let new_content = join_lines(&new_lines, content);
    fs::write(path, new_content.as_bytes())?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::tempdir;

    #[test]
    fn test_replace_single() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("test.md");
        writeln!(fs::File::create(&file_path).unwrap(), "Hello World").unwrap();

        let result = replace_single(
            file_path.to_str().unwrap(),
            1,
            0,
            5,
            "Goodbye",
        );

        assert!(result.is_ok());
        let content = fs::read_to_string(&file_path).unwrap();
        assert!(content.contains("Goodbye"));
    }

    #[test]
    fn test_replace_in_files_repeats_on_same_line() {
        // 旧实现丢弃列号后用 `line.find` 重新定位，同一行多次
        // 出现会替换错位置。
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("dup.md");
        writeln!(fs::File::create(&file_path).unwrap(), "ab ab").unwrap();

        let options = SearchOptions {
            case_sensitive: true,
            whole_word: false,
            use_regex: false,
            max_depth: Some(1),
        };
        let root = dir.path().to_path_buf();
        let summary = replace_in_files(&root, "ab", "xab", &options).unwrap();
        assert_eq!(summary.total_replacements, 2);

        let content = fs::read_to_string(&file_path).unwrap();
        assert_eq!(content.trim(), "xab xab");
    }

    #[test]
    fn test_replace_in_files_preserves_crlf_and_trailing_newline() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("crlf.md");
        fs::write(&file_path, "hello\r\nworld\r\n").unwrap();

        let options = SearchOptions {
            case_sensitive: true,
            whole_word: false,
            use_regex: false,
            max_depth: Some(1),
        };
        let root = dir.path().to_path_buf();
        let _ = replace_in_files(&root, "hello", "hi", &options).unwrap();

        let content = fs::read_to_string(&file_path).unwrap();
        assert_eq!(content, "hi\r\nworld\r\n");
    }

    #[test]
    fn test_replace_single_bounds_are_guarded() {
        let dir = tempdir().unwrap();

        // 越过行尾的范围：截断到行尾，合法而不是 panic
        let p1 = dir.path().join("a.md");
        writeln!(fs::File::create(&p1).unwrap(), "abc").unwrap();
        let r = replace_single(p1.to_str().unwrap(), 1, 0, 9999, "x");
        assert!(r.is_ok());
        assert_eq!(fs::read_to_string(&p1).unwrap().trim(), "x");

        // 落在多字节字符中间的字节位置：拒绝而不是 panic
        let p2 = dir.path().join("b.md");
        writeln!(fs::File::create(&p2).unwrap(), "你好abc").unwrap();
        let r = replace_single(p2.to_str().unwrap(), 1, 1, 2, "x");
        assert!(r.is_err());

        // 行号越界
        let r = replace_single(p2.to_str().unwrap(), 99, 0, 1, "x");
        assert!(r.is_err());
    }

    #[test]
    fn test_preview_replace_keeps_distinct_files() {
        // 两个文件都在第 1 行有匹配：旧实现按行号做 HashMap 键，
        // 后者的条目会覆盖前者。
        let dir = tempdir().unwrap();
        writeln!(fs::File::create(dir.path().join("a.md")).unwrap(), "same").unwrap();
        writeln!(fs::File::create(dir.path().join("b.md")).unwrap(), "same").unwrap();

        let options = SearchOptions {
            case_sensitive: true,
            whole_word: false,
            use_regex: false,
            max_depth: Some(1),
        };
        let root = dir.path().to_path_buf();
        let previews = preview_replace(&root, "same", "X", &options).unwrap();
        assert_eq!(previews.len(), 2);
    }
}
