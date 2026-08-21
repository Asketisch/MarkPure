//! PDF 导出的行内图片提取与加载。
//!
//! Markdown 行循环把遇到的每个 `![alt](path)` 交给
//! `extract_inline_images`，再由 `load_image_bytes` 把每个路径
//! 变成主编排器可嵌入的 PNG/JPG 字节向量。单独放一个模块，让未来的
//! 图片格式支持（WebP、AVIF）和 SSRF 式护栏（拒绝远程 URL、
//! 限制相对路径）可以在不撑大 `pdf.rs` 的前提下添加。

use std::path::{Path, PathBuf};

/// 从单行 Markdown 中提取所有行内 `![alt](path)`。按源顺序返回
/// `(path, alt)` 对，调用方在构建替换标记时可按行+索引去重。
///
/// 手写的字符循环——让 export crate 不引入 `regex` 依赖
/// （该依赖只在 `markdown` 中）。不支持转义，与我们其他地方支持的
/// CommonMark 子集一致。
pub fn extract_inline_images(line: &str) -> Vec<(String, String)> {
    let bytes = line.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i + 4 < bytes.len() {
        if bytes[i] == b'!' && bytes[i + 1] == b'[' {
            // 扫描 alt，直到 `]`
            let alt_start = i + 2;
            let mut j = alt_start;
            while j < bytes.len() && bytes[j] != b']' {
                j += 1;
            }
            if j < bytes.len() && j + 1 < bytes.len() && bytes[j + 1] == b'(' {
                let alt = line[alt_start..j].to_string();
                // 扫描路径，直到 `)`
                let path_start = j + 2;
                let mut k = path_start;
                while k < bytes.len() && bytes[k] != b')' {
                    k += 1;
                }
                if k < bytes.len() {
                    let path = line[path_start..k].trim().to_string();
                    out.push((path, alt));
                    i = k + 1;
                    continue;
                }
            }
        }
        i += 1;
    }
    out
}

/// 若 `path` 是本地文件则读取该图片。远程 URL（http/https/data:）
/// 被拒绝。相对路径以源 Markdown 所在目录为基准解析，这样导出文档时
/// `![](./img.png)` 也能正常工作。
pub fn load_image_bytes(path: &str, source_path: Option<&str>) -> Option<Vec<u8>> {
    // 直接拒绝远程 / 内嵌来源。
    if path.starts_with("http://")
        || path.starts_with("https://")
        || path.starts_with("data:")
    {
        return None;
    }
    let resolved = if let Some(src) = source_path {
        let src_path = Path::new(src);
        let base = src_path.parent().unwrap_or_else(|| Path::new("."));
        if Path::new(path).is_absolute() {
            PathBuf::from(path)
        } else {
            base.join(path)
        }
    } else {
        PathBuf::from(path)
    };
    std::fs::read(&resolved).ok()
}