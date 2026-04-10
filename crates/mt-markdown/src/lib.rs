pub mod parser;
pub mod folding;
pub mod table;
pub mod mermaid;
pub mod frontmatter;
pub mod pandoc;

pub use parser::{parse_markdown, extract_headings, to_html};
pub use folding::{FoldRange, compute_folding_ranges, toggle_fold, get_collapsed_display_range, position_in_range, get_parent_fold};
pub use table::{TableStructure, TableOpType, CellAlign, parse_table, render_table, transform_table, validate_table, find_tables};
pub use mermaid::{DiagramType, MermaidError, MermaidResult, MermaidCompletion, validate_mermaid, extract_mermaid_blocks, parse_mermaid, get_mermaid_suggestions, render_mermaid_with_cli};
pub use frontmatter::{Frontmatter, FrontmatterFormat, FrontmatterBounds, FrontmatterValue, FrontmatterError, FrontmatterCompletion, CompletionKind, parse_frontmatter, validate_frontmatter, update_frontmatter_field, get_frontmatter_completions, find_frontmatter};
pub use pandoc::{Footnote, DefinitionItem, ParsedExtensions, TaskItem, TaskPriority, ExampleItem, RawHtmlBlock, ExtendedCellAlign, parse_footnotes, render_footnote_ref, get_footnote_references, parse_definition_list, parse_task_items, parse_example_numbers, parse_raw_html_blocks, parse_markdown_extensions, render_definition_list_html, render_footnotes_html};
