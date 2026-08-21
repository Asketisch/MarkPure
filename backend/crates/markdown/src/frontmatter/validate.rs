//! 严格的 frontmatter 校验。与返回 `Option` 的
//! [`crate::frontmatter::parse_frontmatter`] 不同，
//! [`validate_frontmatter`] 返回 `Result<Frontmatter, FrontmatterError>`；
//! 当编辑器即将保存文件、需要向用户反馈非法输入时，请使用该校验函数。

use super::bounds::find_frontmatter;
use super::parse::parse_frontmatter;
use super::types::{Frontmatter, FrontmatterError, FrontmatterFormat};

/// 解析并检查 frontmatter 块。当输入格式正确时，
/// 返回与 [`parse_frontmatter`] 相同的 `Frontmatter`，
/// 否则返回描述问题的 `FrontmatterError`。
pub fn validate_frontmatter(content: &str) -> Result<Frontmatter, FrontmatterError> {
    match find_frontmatter(content) {
        Some(bounds) => {
            let fm_content = &content[bounds.start..bounds.end];
            let (format, _body) = if fm_content.trim().starts_with("---") {
                (FrontmatterFormat::Yaml, fm_content.trim())
            } else if fm_content.trim().starts_with("+++") {
                (FrontmatterFormat::Toml, fm_content.trim())
            } else if fm_content.trim().starts_with("{") {
                (FrontmatterFormat::Json, fm_content.trim())
            } else {
                return Err(FrontmatterError {
                    message: "Unknown frontmatter format".to_string(),
                    line: None,
                    column: None,
                });
            };

            // 根据格式进行基础校验
            match format {
                FrontmatterFormat::Yaml => {
                    if !fm_content.trim().ends_with("---") {
                        return Err(FrontmatterError {
                            message: "YAML frontmatter must end with '---'".to_string(),
                            line: None,
                            column: None,
                        });
                    }
                }
                FrontmatterFormat::Toml => {
                    if !fm_content.trim().ends_with("+++") {
                        return Err(FrontmatterError {
                            message: "TOML frontmatter must end with '+++'".to_string(),
                            line: None,
                            column: None,
                        });
                    }
                }
                FrontmatterFormat::Json => {
                    // 检查花括号是否配对
                    let count = fm_content.matches('{').count();
                    let close_count = fm_content.matches('}').count();
                    if count != close_count {
                        return Err(FrontmatterError {
                            message: "Unbalanced braces in JSON frontmatter".to_string(),
                            line: None,
                            column: None,
                        });
                    }
                }
            }

            parse_frontmatter(content).ok_or_else(|| FrontmatterError {
                message: "Failed to parse frontmatter".to_string(),
                line: None,
                column: None,
            })
        }
        None => Err(FrontmatterError {
            message: "No frontmatter found".to_string(),
            line: None,
            column: None,
        }),
    }
}
