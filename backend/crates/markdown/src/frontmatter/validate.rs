//! Strict frontmatter validation. [`validate_frontmatter`]
//! returns `Result<Frontmatter, FrontmatterError>` whereas
//! [`crate::frontmatter::parse_frontmatter`] returns `Option`;
//! use validate when an editor is about to save a file and
//! must surface bad-input feedback to the user.

use super::bounds::find_frontmatter;
use super::parse::parse_frontmatter;
use super::types::{Frontmatter, FrontmatterError, FrontmatterFormat};

/// Parse + sanity-check a frontmatter block. Returns the
/// same `Frontmatter` as [`parse_frontmatter`] when the
/// input is well-formed, or a `FrontmatterError` describing
/// what went wrong.
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

            // Basic validation based on format
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
                    // Check for balanced braces
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
