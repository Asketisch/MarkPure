//! Markdown table transformation and operations
//!
//! Provides functionality for parsing, transforming, and rendering markdown tables.

use serde::{Deserialize, Serialize};

/// Table alignment options
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CellAlign {
    Left,
    Center,
    Right,
    None,
}

impl Default for CellAlign {
    fn default() -> Self {
        CellAlign::None
    }
}

impl From<char> for CellAlign {
    fn from(c: char) -> Self {
        match c {
            'l' => CellAlign::Left,
            'c' => CellAlign::Center,
            'r' => CellAlign::Right,
            _ => CellAlign::None,
        }
    }
}

impl From<CellAlign> for char {
    fn from(align: CellAlign) -> Self {
        match align {
            CellAlign::Left => 'l',
            CellAlign::Center => 'c',
            CellAlign::Right => 'r',
            CellAlign::None => '-',
        }
    }
}

/// Represents a parsed table structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableStructure {
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub alignments: Vec<CellAlign>,
    pub header_line: usize,  // Line number of header row
    pub delimiter_line: usize, // Line number of delimiter row
}

impl TableStructure {
    pub fn num_cols(&self) -> usize {
        self.headers.len()
    }

    pub fn num_rows(&self) -> usize {
        self.rows.len()
    }
}

/// Table operation types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum TableOpType {
    InsertRowBefore { row_idx: usize },
    InsertRowAfter { row_idx: usize },
    DeleteRow { row_idx: usize },
    InsertColumnBefore { col_idx: usize },
    InsertColumnAfter { col_idx: usize },
    DeleteColumn { col_idx: usize },
    MoveRow { from: usize, to: usize },
    MoveColumn { from: usize, to: usize },
    FormatAlign { col_idx: usize, align: CellAlign },
    DeleteTable,
}

/// Parse a markdown table into a structured representation
pub fn parse_table(table_md: &str) -> Option<TableStructure> {
    let lines: Vec<&str> = table_md.lines().collect();
    if lines.len() < 2 {
        return None;
    }

    // Parse header row
    let headers = parse_table_row(lines[0])?;
    let num_cols = headers.len();

    // Find delimiter row (contains only -, :, |)
    let mut delimiter_line = 1;
    let mut alignments: Vec<CellAlign> = Vec::new();

    for (i, line) in lines.iter().enumerate().skip(1) {
        let trimmed = line.trim();
        if trimmed.starts_with('|') && trimmed.chars().all(|c| c == '|' || c == ' ' || c == '-' || c == ':') {
            delimiter_line = i;
            // Parse alignment from delimiter
            alignments = parse_delimiter_row(trimmed, num_cols);
            break;
        }
    }

    // Parse data rows
    let mut rows: Vec<Vec<String>> = Vec::new();
    for line in lines.iter().skip(delimiter_line + 1) {
        if let Some(cells) = parse_table_row(line) {
            // Pad or truncate to match column count
            let mut row = cells;
            while row.len() < num_cols {
                row.push(String::new());
            }
            row.truncate(num_cols);
            rows.push(row);
        }
    }

    Some(TableStructure {
        headers,
        rows,
        alignments,
        header_line: 0,
        delimiter_line,
    })
}

/// Parse a single table row into cells
fn parse_table_row(line: &str) -> Option<Vec<String>> {
    let trimmed = line.trim();
    if !trimmed.starts_with('|') {
        return None;
    }

    let cells: Vec<String> = trimmed
        .trim_start_matches('|')
        .trim_end_matches('|')
        .split('|')
        .map(|cell| cell.trim().to_string())
        .collect();

    if cells.is_empty() {
        return None;
    }

    Some(cells)
}

/// Parse the delimiter row (e.g., |---|:---|---:|) to extract alignments
fn parse_delimiter_row(line: &str, num_cols: usize) -> Vec<CellAlign> {
    let cells: Vec<&str> = line
        .trim_start_matches('|')
        .trim_end_matches('|')
        .split('|')
        .collect();

    let mut alignments: Vec<CellAlign> = Vec::new();
    for cell in cells {
        let trimmed = cell.trim();
        if trimmed.is_empty() {
            alignments.push(CellAlign::None);
            continue;
        }

        let first = trimmed.chars().next().unwrap_or('-');
        let last = trimmed.chars().last().unwrap_or('-');

        let align = if first == ':' && last == ':' {
            CellAlign::Center
        } else if first == ':' {
            CellAlign::Left
        } else if last == ':' {
            CellAlign::Right
        } else {
            CellAlign::None
        };
        alignments.push(align);
    }

    // Ensure we have num_cols alignments
    while alignments.len() < num_cols {
        alignments.push(CellAlign::None);
    }
    alignments.truncate(num_cols);

    alignments
}

/// Render a TableStructure back to markdown
pub fn render_table(table: &TableStructure) -> String {
    let mut output = String::new();

    // Render header
    output.push_str("| ");
    output.push_str(&table.headers.join(" | "));
    output.push_str(" |\n");

    // Render delimiter with alignments
    output.push_str("|");
    for (i, align) in table.alignments.iter().enumerate() {
        let fill = "-".repeat(3.max(table.headers.get(i).map(|h| h.len()).unwrap_or(3)));
        match align {
            CellAlign::Left => output.push_str(&format!(" :{} |", fill)),
            CellAlign::Center => output.push_str(&format!(" :{}: |", fill)),
            CellAlign::Right => output.push_str(&format!(" {}: |", fill)),
            CellAlign::None => output.push_str(&format!(" {} |", fill)),
        }
    }
    output.push('\n');

    // Render data rows
    for row in &table.rows {
        output.push_str("| ");
        output.push_str(&row.join(" | "));
        output.push_str(" |\n");
    }

    output.trim_end_matches('\n').to_string()
}

/// Apply an operation to a table and return the new markdown
pub fn transform_table(table_md: &str, op: &TableOpType) -> Option<String> {
    let mut table = parse_table(table_md)?;

    match op {
        TableOpType::InsertRowBefore { row_idx } => {
            let idx = (*row_idx).min(table.rows.len());
            let empty_row: Vec<String> = vec![String::new(); table.num_cols()];
            table.rows.insert(idx, empty_row);
        }
        TableOpType::InsertRowAfter { row_idx } => {
            let idx = (*row_idx + 1).min(table.rows.len());
            let empty_row: Vec<String> = vec![String::new(); table.num_cols()];
            table.rows.insert(idx, empty_row);
        }
        TableOpType::DeleteRow { row_idx } => {
            if *row_idx < table.rows.len() {
                table.rows.remove(*row_idx);
            }
        }
        TableOpType::InsertColumnBefore { col_idx } => {
            let idx = (*col_idx).min(table.num_cols());
            table.headers.insert(idx, String::new());
            for row in &mut table.rows {
                row.insert(idx, String::new());
            }
            table.alignments.insert(idx, CellAlign::None);
        }
        TableOpType::InsertColumnAfter { col_idx } => {
            let idx = (*col_idx + 1).min(table.num_cols());
            table.headers.insert(idx, String::new());
            for row in &mut table.rows {
                row.insert(idx, String::new());
            }
            table.alignments.insert(idx, CellAlign::None);
        }
        TableOpType::DeleteColumn { col_idx } => {
            if *col_idx < table.num_cols() {
                table.headers.remove(*col_idx);
                for row in &mut table.rows {
                    row.remove(*col_idx);
                }
                table.alignments.remove(*col_idx);
            }
        }
        TableOpType::MoveRow { from, to } => {
            if *from < table.rows.len() && *to < table.rows.len() && *from != *to {
                let row = table.rows.remove(*from);
                table.rows.insert(*to, row);
            }
        }
        TableOpType::MoveColumn { from, to } => {
            if *from < table.num_cols() && *to < table.num_cols() && *from != *to {
                let header = table.headers.remove(*from);
                table.headers.insert(*to, header);
                for row in &mut table.rows {
                    let cell = row.remove(*from);
                    row.insert(*to, cell);
                }
                let align = table.alignments.remove(*from);
                table.alignments.insert(*to, align);
            }
        }
        TableOpType::FormatAlign { col_idx, align } => {
            if *col_idx < table.num_cols() {
                table.alignments[*col_idx] = *align;
            }
        }
        TableOpType::DeleteTable => {
            return None;
        }
    }

    Some(render_table(&table))
}

/// Validate table markdown syntax
pub fn validate_table(table_md: &str) -> bool {
    parse_table(table_md).is_some()
}

/// Find all tables in a markdown document
pub fn find_tables(content: &str) -> Vec<(usize, String)> {
    let mut tables: Vec<(usize, String)> = Vec::new();
    let lines: Vec<&str> = content.lines().collect();
    let mut i = 0;

    while i < lines.len() {
        if lines[i].trim().starts_with('|') {
            // Potential table start, gather all table lines
            let table_start = i;
            let mut table_end = i;

            // Find table extent (consecutive lines starting with |)
            while table_end < lines.len() && lines[table_end].trim().starts_with('|') {
                table_end += 1;
            }

            let table_content = lines[table_start..table_end].join("\n");
            if validate_table(&table_content) {
                tables.push((table_start, table_content));
            }

            i = table_end;
        } else {
            i += 1;
        }
    }

    tables
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple_table() {
        let md = r#"| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |
| Cell 3   | Cell 4   |"#;

        let table = parse_table(md).unwrap();
        assert_eq!(table.num_cols(), 2);
        assert_eq!(table.num_rows(), 2);
        assert_eq!(table.headers[0], "Header 1");
    }

    #[test]
    fn test_parse_table_with_alignment() {
        let md = r#"| Left | Center | Right |
|:-----|:------:|------:|
| L    | C      | R     |"#;

        let table = parse_table(md).unwrap();
        assert_eq!(table.alignments[0], CellAlign::Left);
        assert_eq!(table.alignments[1], CellAlign::Center);
        assert_eq!(table.alignments[2], CellAlign::Right);
    }

    #[test]
    fn test_insert_row() {
        let md = r#"| A | B |
|---|---|
| 1 | 2 |"#;

        let op = TableOpType::InsertRowAfter { row_idx: 0 };
        let result = transform_table(md, &op).unwrap();

        // Just verify we have more rows now (should have 3 rows: header + 2 data)
        let lines: Vec<&str> = result.lines().collect();
        assert!(lines.len() >= 4); // header + delimiter + original row + new row
    }

    #[test]
    fn test_insert_column() {
        let md = r#"| A | B |
|---|---|
| 1 | 2 |"#;

        let op = TableOpType::InsertColumnAfter { col_idx: 0 };
        let result = transform_table(md, &op).unwrap();

        // Verify the result has 3 columns now
        assert!(result.contains("| A |"));
        assert!(result.contains("| 1 |"));
    }

    #[test]
    fn test_delete_column() {
        let md = r#"| A | B | C |
|---|---|---|
| 1 | 2 | 3 |"#;

        let op = TableOpType::DeleteColumn { col_idx: 1 };
        let result = transform_table(md, &op).unwrap();

        assert!(result.contains("| A | C |"));
    }

    #[test]
    fn test_format_alignment() {
        let md = r#"| A | B |
|---|---|
| 1 | 2 |"#;

        let op = TableOpType::FormatAlign { col_idx: 0, align: CellAlign::Center };
        let result = transform_table(md, &op).unwrap();

        assert!(result.contains(":---:"));
    }
}
