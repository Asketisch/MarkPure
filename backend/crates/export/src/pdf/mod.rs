//! PDF 导出流水线。
//!
//! 本模块拆分为若干个职责明确的子模块：
//!
//! - [`orchestration`] —— 主 `export_pdf` 逐行分发逻辑，以及页面布局 / 字体加载辅助函数。
//! - [`images`] —— `extract_inline_images` 与 `load_image_bytes`，
//!   为编排器提供逐行图片处理能力。
//! - [`table`] —— Markdown 表格判断谓词与逐行 `render_table_row` 辅助函数。
//! - [`wrap`] —— CJK 感知的 `wrap_text` 换行。
//! - [`fonts`] —— 平台字体路径解析（`get_font_paths`）。
//!
//! `export_pdf` 在此处重新导出，使公共 API（`crate::export_pdf`）保持稳定。
//! 新增图片格式的支持或表格相关的调整，应落在对应功能的子模块中。

mod fonts;
pub mod images;
mod orchestration;
pub mod strip;
pub mod table;
pub mod wrap;

#[allow(unused_imports)]
pub(crate) use fonts::get_font_paths;

// 供各子模块共用的内部辅助函数。通过 `pub(crate)` 实现
// `pub(super)` 级别的可见性：`orchestration` 与 `table`
// 可以访问它们，但外部 crate 无法访问。
#[allow(unused_imports)]
pub(crate) use images::{extract_inline_images, load_image_bytes};
#[allow(unused_imports)]
pub(crate) use strip::{strip_markdown, substitute_footnote_refs};
#[allow(unused_imports)]
pub(crate) use table::{is_table_row, is_table_separator, parse_table_row, render_table_row};
#[allow(unused_imports)]
pub(crate) use wrap::wrap_text;

// 重新导出 `add_page`，让表格渲染器无需直接依赖编排器即可分页。
pub(crate) use orchestration::add_page;

pub use orchestration::export_pdf;