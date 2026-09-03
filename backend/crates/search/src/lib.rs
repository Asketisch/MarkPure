pub mod preview;
pub mod replace;

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::PathBuf;
use thiserror::Error;
use walkdir::WalkDir;

pub use preview::{SearchPreview, get_search_preview, get_file_preview};
pub use replace::{ReplaceResult, ReplaceSummary, ReplacePreview, ReplaceRange, replace_in_files, replace_single, preview_replace};

#[derive(Error, Debug)]
pub enum Error {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Regex error: {0}")]
    Regex(#[from] regex::Error),
    #[error("Search error: {0}")]
    Search(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchOptions {
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub use_regex: bool,
    pub max_depth: Option<usize>,
}

impl Default for SearchOptions {
    fn default() -> Self {
        Self {
            case_sensitive: false,
            whole_word: false,
            use_regex: true,
            max_depth: Some(10),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchMatch {
    pub file: String,
    pub line_number: u64,
    /// 匹配在 `content` 中起始的字节偏移（UTF-8 字节，
    /// *不是*字符数——JS 使用 UTF-16 索引，换算由渲染器负责）。
    pub column: usize,
    /// 匹配的字节长度。前端需要它来高亮长度与查询字符串不同的
    /// 正则匹配（并正确切片中日韩内容）。
    #[serde(default)]
    pub match_length: usize,
    pub content: String,
}

/// 单次工作区搜索返回的匹配数上限。超过后提前停止收集
/// （`truncated` 置位，`total_matches` 为截断值，表示「还有更多」），
/// 避免超大工作区 + 高频词时内存与 IPC 序列化无限膨胀。
pub const MAX_MATCHES: usize = 5000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub matches: Vec<SearchMatch>,
    pub total_files: usize,
    pub total_matches: usize,
    /// 匹配数达到 `MAX_MATCHES` 上限而截断时为 true
    /// （`total_matches` / `total_files` 此时是下界）。
    #[serde(default)]
    pub truncated: bool,
}

/// 带编码检测地读取文件内容
pub(crate) fn read_file_content(path: &PathBuf) -> Result<String, Error> {
    let mut file = fs::File::open(path)?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;

    // 先尝试 UTF-8
    if let Ok(content) = String::from_utf8(bytes.clone()) {
        return Ok(content);
    }

    // 中文文件尝试 GBK
    let (decoded, _, had_errors) = encoding_rs::GBK.decode(&bytes);
    if !had_errors {
        return Ok(decoded.into_owned());
    }

    // 回退到带替换符的 UTF-8 转换
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// 按项目的 ReDoS 限制构建 `Regex`。
///
/// 用户提供的模式是不可信的。像 `(a+)+$` 这样的病态模式针对长行
/// 可能让搜索线程卡住数秒；regex 库的 `size_limit` 和 `dfa_size_limit`
/// 限制了回溯预算，让引擎能干净地放弃。
fn compile_search_regex(pattern: &str, case_insensitive: bool) -> Result<Regex, Error> {
    use regex::RegexBuilder;
    RegexBuilder::new(pattern)
        .case_insensitive(case_insensitive)
        .size_limit(8 * 1024 * 1024)
        .dfa_size_limit(8 * 1024 * 1024)
        .build()
        .map_err(Error::from)
}

/// 根据查询与选项构建正则模式
fn build_pattern(query: &str, options: &SearchOptions) -> Result<String, Error> {
    if options.use_regex {
        // 先校验正则（开销小：这里不运行，只确认它能解析）。
        // 使用与运行时正则相同的尺寸限制，这样超限的模式会
        // *在这里* 失败，而不是在搜索过程中静默出问题。
        compile_search_regex(query, !options.case_sensitive)?;
        if options.whole_word {
            // 给用户的正则包上单词边界
            Ok(format!(r"\b(?:{})\b", query))
        } else {
            Ok(query.to_string())
        }
    } else {
        // 作为普通文本转义
        let escaped = regex::escape(query);
        if options.whole_word {
            Ok(format!(r"\b{}\b", escaped))
        } else {
            Ok(escaped)
        }
    }
}

/// 在目录中的所有 Markdown 与文本文件中搜索文本
pub fn search_workspace(
    root_path: &PathBuf,
    query: &str,
    options: &SearchOptions,
) -> Result<SearchResult, Error> {
    let pattern = build_pattern(query, options)?;
    let regex = compile_search_regex(&pattern, !options.case_sensitive)?;

    let mut matches = Vec::new();
    let mut files_with_matches = std::collections::HashSet::new();
    let mut truncated = false;

    // 构建文件遍历器
    let walker = WalkDir::new(root_path)
        .follow_links(true)
        .max_depth(options.max_depth.unwrap_or(10));

    // 环护栏：`follow_links` 下符号链接目录环（`ln -s ..`）会无限
    // 遍历。按 (设备, inode/file_id) 记录每个已访问的真实目录，
    // 重复出现的直接剪枝。
    let mut visited_dirs: std::collections::HashSet<DirKey> = std::collections::HashSet::new();

    'walk: for entry in walker.into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();

        if entry.file_type().is_dir() {
            if let Some(key) = dir_key(path) {
                if !visited_dirs.insert(key) {
                    continue; // 已访问过的真实目录（符号链接环）
                }
            }
        }

        // 跳过隐藏文件/目录与常见忽略模式
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            if name.starts_with('.') || name == "node_modules" || name == "target" {
                continue;
            }
        }

        // 只搜索文本文件
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            let ext_lower = ext.to_lowercase();
            if !["md", "markdown", "txt", "text", "html", "css", "js", "ts", "jsx", "tsx", "json", "yaml", "yml", "toml", "xml", "rs", "py", "go", "java", "c", "cpp", "h", "hpp", "swift", "kt", "rb", "php", "sh", "bash", "zsh", "vue", "svelte"].contains(&ext_lower.as_str()) {
                continue;
            }
        } else {
            // 跳过无扩展名的文件（除非可能是配置文件）
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if !name.starts_with('.') && name != "Makefile" && name != "Dockerfile" && name != "Rakefile" {
                continue;
            }
        }

        // 跳过二进制文件
        if is_binary_file(&path.to_path_buf()) {
            continue;
        }

        let file_path = path.to_string_lossy().to_string();

        // 在该文件中搜索。`find_iter` 报告行内**每一处**匹配
        // （旧实现用 `find` 每行只报第一处）；达到上限即截断。
        if let Ok(content) = read_file_content(&path.to_path_buf()) {
            for (line_number, line) in content.lines().enumerate() {
                for m in regex.find_iter(line) {
                    if matches.len() >= MAX_MATCHES {
                        truncated = true;
                        break 'walk;
                    }
                    files_with_matches.insert(file_path.clone());
                    matches.push(SearchMatch {
                        file: file_path.clone(),
                        line_number: (line_number + 1) as u64,
                        column: m.start(),
                        match_length: m.end().saturating_sub(m.start()),
                        content: line.to_string(),
                    });
                }
            }
        }
    }

    let total_matches = matches.len();
    Ok(SearchResult {
        matches,
        total_files: files_with_matches.len(),
        total_matches,
        truncated,
    })
}

/// 环护栏用的真实目录标识（设备 + inode / file_id）。
#[derive(Eq, PartialEq, Hash)]
struct DirKey(u64, u64);

#[cfg(any(unix, windows))]
fn dir_key(path: &std::path::Path) -> Option<DirKey> {
    let meta = std::fs::metadata(path).ok()?;
    Some(dir_key_from_meta(&meta))
}

#[cfg(unix)]
fn dir_key_from_meta(meta: &std::fs::Metadata) -> DirKey {
    use std::os::unix::fs::MetadataExt;
    DirKey(meta.dev(), meta.ino())
}

#[cfg(windows)]
fn dir_key_from_meta(meta: &std::fs::Metadata) -> DirKey {
    use std::os::windows::fs::MetadataExt;
    let id = meta.file_id();
    DirKey(id.as_u64() as u64, id.as_u128() as u64)
}

#[cfg(not(any(unix, windows)))]
fn dir_key(_path: &std::path::Path) -> Option<DirKey> {
    // 其他平台无强目录标识：不启用环护栏
    // （max_depth 仍是兜底）。
    None
}

/// 多根变体：对每个根各跑一次 `search_workspace` 并合并结果。
/// 匹配顺序按根保持（按 `root_paths` 给出的顺序）；每个根内部
/// 按遍历顺序排列。`total_files` 是所有根去重后的计数。
///
/// 空或不存在的根路径会被静默跳过——调用方本应已做校验，
/// 但部分配置失效（例如外接硬盘被卸载）不应让搜索崩溃。
pub fn search_workspace_multi(
    root_paths: &[&PathBuf],
    query: &str,
    options: &SearchOptions,
) -> Result<SearchResult, Error> {
    let mut all_matches: Vec<SearchMatch> = Vec::new();
    let mut files_with_matches: std::collections::HashSet<String> =
        std::collections::HashSet::new();

    let mut truncated = false;
    for root in root_paths {
        if !root.exists() {
            continue;
        }
        let result = search_workspace(root, query, options)?;
        truncated = truncated || result.truncated;
        files_with_matches.extend(result.matches.iter().map(|m| m.file.clone()));
        all_matches.extend(result.matches);
        // 全局上限：跨根合并后同样不得无限增长。
        if all_matches.len() >= MAX_MATCHES {
            all_matches.truncate(MAX_MATCHES);
            truncated = true;
            break;
        }
    }

    let total_matches = all_matches.len();
    Ok(SearchResult {
        matches: all_matches,
        total_files: files_with_matches.len(),
        total_matches,
        truncated,
    })
}

/// 在单个文件中快速搜索
pub fn search_file(
    file_path: &PathBuf,
    query: &str,
    options: &SearchOptions,
) -> Result<Vec<SearchMatch>, Error> {
    let pattern = build_pattern(query, options)?;
    let regex = compile_search_regex(&pattern, !options.case_sensitive)?;

    let mut matches = Vec::new();
    let file_path_str = file_path.to_string_lossy().to_string();

    let content = read_file_content(file_path)?;

    for (line_number, line) in content.lines().enumerate() {
        // 行内每一处匹配都单独报告（与 search_workspace 一致）。
        for m in regex.find_iter(line) {
            matches.push(SearchMatch {
                file: file_path_str.clone(),
                line_number: (line_number + 1) as u64,
                column: m.start(),
                match_length: m.end().saturating_sub(m.start()),
                content: line.to_string(),
            });
        }
    }

    Ok(matches)
}

/// 判断文件是否为二进制
fn is_binary_file(path: &PathBuf) -> bool {
    if let Ok(mut file) = fs::File::open(path) {
        // 检查更多字节以减少误报（16KB 而非 8KB）
        let mut buffer = vec![0u8; 16384];
        if let Ok(n) = file.read(&mut buffer) {
            let sample = &buffer[..n];
            // 检查空字节
            if sample.contains(&0) {
                return true;
            }
            // 按 **字符** 统计不可打印比例（UTF-8 lossy 解码）。
            // 旧的按字节启发式把 UTF-8 中文（每字符 3 个 ≥0x80 的
            // 字节）全算成「不可打印」，中文笔记一律被误判为二进制
            // 而跳过搜索——中文场景下搜索功能等于完全失效。
            let text = String::from_utf8_lossy(sample);
            let mut non_printable = 0usize;
            let mut total = 0usize;
            for ch in text.chars() {
                total += 1;
                if ch == '\u{FFFD}' {
                    // 解码失败的字节：疑似二进制
                    non_printable += 1;
                } else if ch.is_control() && ch != '\n' && ch != '\r' && ch != '\t' {
                    non_printable += 1;
                }
            }
            if total > 0 && non_printable as f64 / total as f64 > 0.3 {
                return true;
            }
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_search_options_default() {
        let options = SearchOptions::default();
        assert!(!options.case_sensitive);
        assert!(options.use_regex);
    }

    #[test]
    fn test_build_pattern_literal() {
        let options = SearchOptions {
            case_sensitive: false,
            whole_word: false,
            use_regex: false,
            max_depth: Some(10),
        };
        let pattern = build_pattern("hello world", &options).unwrap();
        // 空格不是正则特殊字符，因此无需转义
        assert_eq!(pattern, "hello world");
    }

    #[test]
    fn test_build_pattern_whole_word() {
        let options = SearchOptions {
            case_sensitive: false,
            whole_word: true,
            use_regex: false,
            max_depth: Some(10),
        };
        let pattern = build_pattern("hello", &options).unwrap();
        assert_eq!(pattern, r"\bhello\b");
    }

    #[test]
    fn search_file_reports_every_match_on_a_line() {
        // 一行内多处匹配必须逐处报告（旧实现每行只报第一处）。
        let dir = std::env::temp_dir().join(format!("markpure-search-multi-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("multi.md");
        std::fs::write(&f, "cat cat cat\nnope\ncat\n").unwrap();
        let options = SearchOptions {
            case_sensitive: false,
            whole_word: false,
            use_regex: false,
            max_depth: Some(10),
        };
        let matches = search_file(&f, "cat", &options).unwrap();
        assert_eq!(matches.len(), 4, "expected 4 matches, got {:?}", matches);
        let cols: Vec<usize> = matches.iter().map(|m| m.column).collect();
        assert_eq!(cols, vec![0, 4, 8, 0]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_workspace_caps_matches() {
        // 高频词 + 大文件不得产生无上限的结果集。
        let dir = std::env::temp_dir().join(format!("markpure-search-cap-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let body: String = (0..6000).map(|i| format!("needle-{i}")).collect();
        std::fs::write(dir.join("big.md"), body).unwrap();
        let options = SearchOptions {
            case_sensitive: false,
            whole_word: false,
            use_regex: false,
            max_depth: Some(10),
        };
        let result = search_workspace(&dir, "needle", &options).unwrap();
        assert_eq!(result.matches.len(), MAX_MATCHES, "matches not capped");
        assert!(result.truncated, "truncated flag not set");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    #[cfg(unix)]
    fn search_workspace_survives_symlink_cycle() {
        // sub/loop -> 根目录 的符号链接环：环护栏必须剪枝，
        // 匹配只出现一次（无环护栏时文件会沿环重复出现）。
        let dir = std::env::temp_dir().join(format!("markpure-search-cycle-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("note.md"), "TODO cycle").unwrap();
        std::os::unix::fs::symlink(&dir, dir.join("sub").join("loop")).unwrap();
        let options = SearchOptions {
            case_sensitive: false,
            whole_word: false,
            use_regex: false,
            max_depth: Some(100), // 故意给大深度：环只能靠护栏终止
        };
        let result = search_workspace(&dir, "TODO", &options).unwrap();
        assert_eq!(
            result.matches.len(),
            1,
            "symlink cycle caused duplicate matches: {:?}",
            result.matches
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 多根搜索：跨两个临时目录搜索并确认两个根的匹配都返回了。
    /// 临时目录名带 "root-a" / "root-b"，以便从结果中的文件路径
    /// 观察到跨根合并的效果。
    #[test]
    fn search_workspace_multi_merges_across_roots() {
        let dir_a = std::env::temp_dir().join("markpure-search-root-a");
        let dir_b = std::env::temp_dir().join("markpure-search-root-b");
        let _ = std::fs::remove_dir_all(&dir_a);
        let _ = std::fs::remove_dir_all(&dir_b);
        std::fs::create_dir_all(&dir_a).unwrap();
        std::fs::create_dir_all(&dir_b).unwrap();
        std::fs::write(dir_a.join("a-note.md"), "TODO here").unwrap();
        std::fs::write(dir_b.join("b-note.md"), "TODO here").unwrap();

        let options = SearchOptions {
            case_sensitive: false,
            whole_word: false,
            use_regex: false,
            max_depth: Some(10),
        };
        let result =
            search_workspace_multi(&[&dir_a, &dir_b], "TODO", &options).unwrap();
        assert!(result.total_matches >= 2);
        let has_a = result.matches.iter().any(|m| m.file.contains("root-a"));
        let has_b = result.matches.iter().any(|m| m.file.contains("root-b"));
        assert!(has_a, "missing matches from root-a: {:?}", result.matches);
        assert!(has_b, "missing matches from root-b: {:?}", result.matches);

        // 不存在的根被静默跳过，而不是报错。
        let bogus = std::path::PathBuf::from("/nonexistent/markpure-zzz");
        let result2 =
            search_workspace_multi(&[&dir_a, &bogus], "TODO", &options).unwrap();
        assert!(result2.total_matches >= 1);

        let _ = std::fs::remove_dir_all(&dir_a);
        let _ = std::fs::remove_dir_all(&dir_b);
    }
}
