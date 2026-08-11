//! PDF export pipeline.
//!
//! This module is split into focused submodules:
//!
//! - [`orchestration`] — the main `export_pdf` line-by-line
//!   dispatcher plus the page-layout / font-loading helpers.
//! - [`images`] — `extract_inline_images` and `load_image_bytes`,
//!   the per-line image handling that feeds the orchestrator.
//! - [`table`] — markdown table predicates and the per-row
//!   `render_table_row` helper.
//!
//! `export_pdf` is re-exported here so the public API
//! (`crate::export_pdf`) stays stable. New image-format support
//! or table tweaks should land in the per-feature submodule.

pub mod images;
mod orchestration;
pub mod strip;
pub mod table;

// Internal helpers used across the submodules. Kept
// `pub(super)`-style via `pub(crate)` so `orchestration` and
// `table` can reach them but outside crates cannot.
#[allow(unused_imports)]
pub(crate) use images::{extract_inline_images, load_image_bytes};
#[allow(unused_imports)]
pub(crate) use strip::{strip_markdown, substitute_footnote_refs};
#[allow(unused_imports)]
pub(crate) use table::{is_table_row, is_table_separator, parse_table_row, render_table_row};

// Re-export `add_page` so the table renderer can paginate
// without taking a direct dependency on the orchestrator.
pub(crate) use orchestration::add_page;

pub use orchestration::export_pdf;