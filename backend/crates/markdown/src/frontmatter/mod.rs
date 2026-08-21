//! Frontmatter 的解析与操作。
//!
//! 提供对 Markdown 文件中常用的 YAML/TOML/JSON frontmatter
//! 进行解析、校验与操作的功能。
//!
//! 实现拆分到若干子模块中，每个都小到一屏能看完：
//!
//! - [`types`] —— 数据结构（`Frontmatter`、`FrontmatterValue`、
//!   `FrontmatterError`、补全）。
//! - [`bounds`] —— 定位文档头部 frontmatter 块的起止位置。
//! - [`parse`] —— 各格式的解析器（YAML、TOML、JSON）以及
//!   [`parse_frontmatter`] 分发器。
//! - [`validate`] —— [`validate_frontmatter`] 是解析器的严格版，
//!   遇到坏输入时返回 `FrontmatterError`。
//! - [`completions`] —— 各格式的自动补全建议。
//! - [`update`] —— [`update_frontmatter_field`]，编辑器的
//!   「编辑单个值」入口。
//! - [`render`] —— 把 [`Frontmatter`] 还原为源格式
//!   （YAML/TOML/JSON）输出。

mod bounds;
mod completions;
mod parse;
mod render;
mod types;
mod update;
mod validate;

// 在 `frontmatter::` 命名空间下再导出调用方期望的一切。
// 没有这些导出，下游代码如 `markdown::frontmatter::FrontmatterCompletion`
// 就无法解析（该类型现在位于 `types.rs`）。
pub use types::{
    CompletionKind, Frontmatter, FrontmatterBounds, FrontmatterError, FrontmatterFormat,
    FrontmatterValue, FrontmatterCompletion,
};

pub use bounds::find_frontmatter;
pub use completions::get_frontmatter_completions;
pub use parse::parse_frontmatter;
pub use update::update_frontmatter_field;
pub use validate::validate_frontmatter;

#[cfg(test)]
mod tests;
