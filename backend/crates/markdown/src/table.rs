//! Markdown 表格转换与操作
//!
//! 提供解析、转换和渲染 Markdown 表格的功能。

use serde::{Deserialize, Serialize};

/// 表格对齐方式选项
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[derive(Default)]
pub enum CellAlign {
    Left,
    Center,
    Right,
    #[default]
    None,
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

/// 表示解析后的表格结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableStructure {
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub alignments: Vec<CellAlign>,
    pub header_line: usize,  // 表头行的行号
    pub delimiter_line: usize, // 分隔行的行号
}

impl TableStructure {
    pub fn num_cols(&self) -> usize {
        self.headers.len()
    }

    pub fn num_rows(&self) -> usize {
        self.rows.len()
    }
}

/// 表格操作类型
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

/// 把 Markdown 表格解析为结构化表示
pub fn parse_table(table_md: &str) -> Option<TableStructure> {
    let lines: Vec<&str> = table_md.lines().collect();
    if lines.len() < 2 {
        return None;
    }

    // 解析表头行
    let headers = parse_table_row(lines[0])?;
    let num_cols = headers.len();

    // 查找分隔行（只包含 -、:、|）。GFM 表格**必须**有分隔行——
    // 没有它，这段文本只是带 `|` 的普通行，不是表格。若把缺分隔行
    // 的文本当表格解析，`alignments` 会是空 Vec，后续的
    // FormatAlign / DeleteColumn / MoveColumn / InsertColumn 都会
    // 对空 Vec 取下标而 panic（这些入口均可经 IPC 触达）。
    let mut delimiter_line = 1;
    let mut alignments: Vec<CellAlign> = Vec::new();
    let mut found_delimiter = false;

    for (i, line) in lines.iter().enumerate().skip(1) {
        let trimmed = line.trim();
        if trimmed.starts_with('|') && trimmed.chars().all(|c| c == '|' || c == ' ' || c == '-' || c == ':') {
            delimiter_line = i;
            // 从分隔行解析对齐方式
            alignments = parse_delimiter_row(trimmed, num_cols);
            found_delimiter = true;
            break;
        }
    }
    if !found_delimiter {
        return None;
    }

    // 解析数据行
    let mut rows: Vec<Vec<String>> = Vec::new();
    for line in lines.iter().skip(delimiter_line + 1) {
        if let Some(cells) = parse_table_row(line) {
            // 补齐或截断以匹配列数
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

/// 把单行表格解析为单元格
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

/// 解析分隔行（例如 |---|:---|---:|）以提取对齐方式
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

    // 确保对齐方式数量与列数一致
    while alignments.len() < num_cols {
        alignments.push(CellAlign::None);
    }
    alignments.truncate(num_cols);

    alignments
}

/// 把表格结构渲染回 Markdown
pub fn render_table(table: &TableStructure) -> String {
    let mut output = String::new();

    // 渲染表头
    output.push_str("| ");
    output.push_str(&table.headers.join(" | "));
    output.push_str(" |\n");

    // 按对齐方式渲染分隔行
    output.push('|');
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

    // 渲染数据行
    for row in &table.rows {
        output.push_str("| ");
        output.push_str(&row.join(" | "));
        output.push_str(" |\n");
    }

    output.trim_end_matches('\n').to_string()
}

/// 对表格应用操作并返回新的 Markdown
pub fn transform_table(table_md: &str, op: &TableOpType) -> Option<String> {
    let mut table = parse_table(table_md)?;

    // 纵深防御：任何路径上到达这里都保证 alignments 与列数一致，
    // 这样各操作对 `table.alignments` 的取下标都不会越界。
    let cols = table.num_cols();
    table.alignments.resize_with(cols, || CellAlign::None);

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

/// 校验表格 Markdown 语法
pub fn validate_table(table_md: &str) -> bool {
    parse_table(table_md).is_some()
}

/// 在 Markdown 文档中查找所有表格
pub fn find_tables(content: &str) -> Vec<(usize, String)> {
    let mut tables: Vec<(usize, String)> = Vec::new();
    let lines: Vec<&str> = content.lines().collect();
    let mut i = 0;

    while i < lines.len() {
        if lines[i].trim().starts_with('|') {
            // 可能是表格起点，收集所有表格行
            let table_start = i;
            let mut table_end = i;

            // 确定表格范围（以 | 开头的连续行）
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

        // 仅验证行数变多（应有 3 行：表头 + 2 行数据）
        let lines: Vec<&str> = result.lines().collect();
        assert!(lines.len() >= 4); // 表头 + 分隔行 + 原行 + 新行
    }

    #[test]
    fn test_insert_column() {
        let md = r#"| A | B |
|---|---|
| 1 | 2 |"#;

        let op = TableOpType::InsertColumnAfter { col_idx: 0 };
        let result = transform_table(md, &op).unwrap();

        // 验证结果现在有 3 列
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

    #[test]
    fn test_parse_requires_delimiter_row() {
        // 缺分隔行的「表格」不是 GFM 表格——必须拒绝解析，
        // 否则空 alignments 会让列操作 panic。
        let md = "| A | B |\n| 1 | 2 |";
        assert!(parse_table(md).is_none());
        assert!(!validate_table(md));
    }

    #[test]
    fn test_transform_without_delimiter_is_none_not_panic() {
        let md = "| A | B |\n| 1 | 2 |";
        // 这些操作在旧实现里会对空 alignments Vec 取下标而 panic
        assert!(transform_table(md, &TableOpType::FormatAlign { col_idx: 0, align: CellAlign::Center }).is_none());
        assert!(transform_table(md, &TableOpType::DeleteColumn { col_idx: 0 }).is_none());
        assert!(transform_table(md, &TableOpType::MoveColumn { from: 0, to: 1 }).is_none());
        assert!(transform_table(md, &TableOpType::InsertColumnAfter { col_idx: 0 }).is_none());
    }
}
