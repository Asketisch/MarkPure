//! Frontmatter parsing and manipulation.
//!
//! Provides functionality to parse, validate, and manipulate
//! YAML/TOML/JSON frontmatter commonly used in Markdown files
//! for metadata.
//!
//! The implementation is split across a few submodules so each
//! stays small enough to scan in one screen:
//!
//!   - [`types`]       — data structures (`Frontmatter`,
//!                       `FrontmatterValue`, `FrontmatterError`,
//!                       completions).
//!   - [`bounds`]      — locate the start/end of a frontmatter
//!                       block at the head of a document.
//!   - [`parse`]       — format-specific parsers (YAML, TOML,
//!                       JSON) and the [`parse_frontmatter`]
//!                       dispatcher.
//!   - [`validate`]    — [`validate_frontmatter`], the strict
//!                       version of the parser that returns
//!                       `FrontmatterError` on bad input.
//!   - [`completions`] — per-format autocompletion suggestions.
//!   - [`update`]      — [`update_frontmatter_field`], the
//!                       editor's "edit a single value" entry
//!                       point.
//!   - [`render`]      — emit a [`Frontmatter`] back to its
//!                       source format (YAML/TOML/JSON).

mod bounds;
mod completions;
mod parse;
mod render;
mod types;
mod update;
mod validate;

// Re-export everything callers expect under the `frontmatter::`
// path. Without these, downstream code like
// `markdown::frontmatter::FrontmatterCompletion` wouldn't
// resolve (the type lives in `types.rs` now).
pub use types::{
    CompletionKind, Frontmatter, FrontmatterBounds, FrontmatterError, FrontmatterFormat,
    FrontmatterValue, FrontmatterCompletion,
};

use std::collections::HashMap;

pub use bounds::find_frontmatter;
pub use completions::get_frontmatter_completions;
pub use parse::parse_frontmatter;
pub use update::update_frontmatter_field;
pub use validate::validate_frontmatter;

// Internal render functions are only used by the update
// path; keep them at their original path so tests can poke
// at them via the fully-qualified name.
pub(crate) use render::render_yaml_frontmatter;

#[cfg(test)]
mod tests;
