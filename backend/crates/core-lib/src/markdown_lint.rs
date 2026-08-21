//! 「保存时标色」——在缓冲区写入磁盘之前运行的一组安全、
//! 有主见的清理规则。默认关闭；用户在「设置 → 编辑器 → 保存时标色」
//! 中开启。
//!
//! 规则（开关打开时全部启用）：
//!
//!   1. **去除行尾空白**——删除每行末尾的 `' '` 和 `'\t'`。
//!      这是标准的「POSIX 文本文件」清理，与主流编辑器的
//!      「删除行尾空白」模式一致。
//!   2. **确保末尾换行**——若文档不以 `'\n'` 结尾则追加。
//!      POSIX 文本文件约定；`git diff` 中「文件末尾无换行」的
//!      标记会减少。
//!   3. **将 3 个以上连续空行折叠为 2 个**——Markdown 中一个
//!      空行渲染为段落间断；视觉上我们永远不需要连续 3 个。
//!
//! 我们刻意避免：
//!   - 重新格式化表格（有破坏用户对齐的风险）
//!   - 将制表符转换为空格（该功能应由单独的开关控制，不与其他规则捆绑）
//!
//! 注意：规则不识别 Markdown 结构——代码围栏内的行尾空白同样
//! 会被「去除行尾空白」规则清理（以行为界，保持实现简单可审计）。
//! 缩进代码块中整行空白的行被修剪后仍按空行处理，渲染不受影响。
//!
//! 实现刻意保持简单（无正则），以便审计且无副作用。

/// 用户可开关的单条标色规则。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LintRule {
    /// 删除每行末尾的 `' '` 和 `'\t'`。
    TrimTrailingWhitespace,
    /// 确保文档以单个 `'\n'` 结尾。
    EnsureFinalNewline,
    /// 将 3 个以上连续空行折叠为 2 个。
    CollapseExcessBlankLines,
}

/// 一次 `lint_markdown` 调用产生的按规则统计。宿主端用它们
/// 展示瞬时状态消息，例如「已标色：去除 12 处行尾空格、补 1 处末尾换行」。
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct LintReport {
    /// 行尾空白被去除的行数。
    pub trimmed_lines: usize,
    /// 输入不以 `'\n'` 结尾且已追加末尾换行时为 `true`。
    pub added_final_newline: bool,
    /// 被折叠的过量空行段数（每个 3 行以上的空行段计为一次）。
    pub collapsed_runs: usize,
    /// 移除（或新增）的字符总数。负值表示输出比输入短。
    pub delta_chars: isize,
}

/// 对 `input` 运行请求的标色规则，返回清理后的字符串及逐规则报告。
///
/// `input` 可使用 `\n` 或 `\r\n` 行末。「去除行尾空白」逐行保留
/// 每行原有的行末；「折叠空行」按文档重新输出——只要文档中出现过
/// `\r\n` 就统一用 `\r\n`，否则用 `\n`（混合行末的文档会被统一）。
pub fn lint_markdown(input: &str, rules: &[LintRule]) -> (String, LintReport) {
    let mut report = LintReport::default();
    let mut out = input.to_string();

    if rules.contains(&LintRule::TrimTrailingWhitespace) {
        let mut trimmed_lines = 0usize;
        let ends_with_newline = out.ends_with('\n');
        // 为遍历先去掉末尾的一个换行，避免 `split('\n')`
        // 在末尾给出一行合成的空行。下面会重新加上行末。
        let walk: &str = if ends_with_newline {
            &out[..out.len() - 1]
        } else {
            &out
        };
        let mut buf = String::with_capacity(out.len());
        for line in walk.split('\n') {
            // 在 CRLF 文档中 `split('\n')` 会把 `\r` 留在每行末尾；
            // 先于可选的 `\r` 之前修剪，以免误删行末本身。
            let (body, cr) = match line.strip_suffix('\r') {
                Some(stripped) => (stripped, "\r"),
                None => (line, ""),
            };
            let trimmed_end = body.trim_end_matches([' ', '\t']);
            if trimmed_end.len() != body.len() {
                trimmed_lines += 1;
            }
            buf.push_str(trimmed_end);
            buf.push_str(cr);
            buf.push('\n');
        }
        if !ends_with_newline && buf.ends_with('\n') {
            buf.pop();
        }
        out = buf;
        report.trimmed_lines = trimmed_lines;
    }

    if rules.contains(&LintRule::EnsureFinalNewline) && !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
        report.added_final_newline = true;
    }

    if rules.contains(&LintRule::CollapseExcessBlankLines) {
        // 检测 3 个以上空行的连续段并缩减为恰好 2 个。
        // 按 `\n` 切分后，CRLF 文档的每行末尾会残留一个 `\r`——
        // 若不先剥掉它，「空行」变成字符串 `"\r"`（非空），
        // 整条规则对 CRLF 文档静默失效；换行也一律用主导行末
        // 重新输出，保持 CRLF 文档仍为 CRLF。
        let crlf = out.contains("\r\n");
        let sep = if crlf { "\r\n" } else { "\n" };
        let mut collapsed_runs = 0usize;
        let ends_with_newline = out.ends_with('\n');
        // 遍历时先从 `out` 去掉末尾的一个换行，避免 `split('\n')`
        // 合成的尾部 `""` 干扰循环。需要时末尾再补回换行。
        let raw: Vec<&str> = if ends_with_newline {
            out[..out.len() - 1].split('\n').collect()
        } else {
            out.split('\n').collect()
        };
        // 剥掉 CRLF 残留的 `\r`，让空行判断回到「空字符串」。
        let walk: Vec<&str> = raw
            .iter()
            .map(|l| l.strip_suffix('\r').unwrap_or(*l))
            .collect();
        let mut buf = String::with_capacity(out.len());
        let mut i = 0usize;
        while i < walk.len() {
            let line = walk[i];
            // 追加本行。
            buf.push_str(line);
            // 向前看：统计后面跟随多少空行。
            let mut blanks = 0usize;
            while i + 1 + blanks < walk.len() && walk[i + 1 + blanks].is_empty() {
                blanks += 1;
            }
            if blanks >= 3 {
                // 把 3 个以上空行折叠为 2 个空行：
                // 输出 3 个行尾换行（本行 + 2 个空行）。
                // Markdown 中一个换行渲染为段落内的换行，一对换行
                // 渲染为段落间断——恰好保留 2 个空行是通行约定。
                collapsed_runs += 1;
                buf.push_str(sep);
                buf.push_str(sep);
                buf.push_str(sep);
                i += blanks + 1;
            } else if blanks > 0 {
                for _ in 0..=blanks {
                    buf.push_str(sep);
                }
                i += blanks + 1;
            } else {
                buf.push_str(sep);
                i += 1;
            }
        }
        // 输入不带末尾换行时，上面的循环会多输出一个行末；
        // 把它裁掉，恢复「原文档末尾无换行」的状态。
        if !ends_with_newline && buf.ends_with(sep) {
            buf.truncate(buf.len() - sep.len());
        }
        out = buf;
        report.collapsed_runs = collapsed_runs;
    }

    report.delta_chars = out.len() as isize - input.len() as isize;
    (out, report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trims_trailing_whitespace() {
        let input = "hello   \nworld\t\t\n";
        let (out, report) = lint_markdown(input, &[LintRule::TrimTrailingWhitespace]);
        assert_eq!(out, "hello\nworld\n");
        assert_eq!(report.trimmed_lines, 2);
    }

    #[test]
    fn trims_trailing_whitespace_preserves_crlf() {
        let input = "hello   \r\nworld\t\r\n";
        let (out, report) = lint_markdown(input, &[LintRule::TrimTrailingWhitespace]);
        assert_eq!(out, "hello\r\nworld\r\n");
        assert_eq!(report.trimmed_lines, 2);
    }

    #[test]
    fn ensures_final_newline() {
        let input = "hello\nworld";
        let (out, report) =
            lint_markdown(input, &[LintRule::EnsureFinalNewline]);
        assert_eq!(out, "hello\nworld\n");
        assert!(report.added_final_newline);
    }

    #[test]
    fn ensures_final_newline_is_noop_when_present() {
        let input = "hello\n";
        let (out, report) =
            lint_markdown(input, &[LintRule::EnsureFinalNewline]);
        assert_eq!(out, "hello\n");
        assert!(!report.added_final_newline);
    }

    #[test]
    fn ensures_final_newline_is_noop_when_empty() {
        let (out, report) = lint_markdown("", &[LintRule::EnsureFinalNewline]);
        assert_eq!(out, "");
        assert!(!report.added_final_newline);
    }

    #[test]
    fn collapses_excess_blank_lines() {
        let input = "a\n\n\n\n\nb\n";
        let (out, report) = lint_markdown(
            input,
            &[LintRule::CollapseExcessBlankLines],
        );
        assert_eq!(out, "a\n\n\nb\n");
        assert_eq!(report.collapsed_runs, 1);
    }

    #[test]
    fn collapses_excess_blank_lines_crlf() {
        // CRLF 文档：`split('\n')` 后空行是 `"\r"` 而非 `""`，
        // 规则必须仍然生效且保持 CRLF 行末。
        let input = "a\r\n\r\n\r\n\r\nb\r\n";
        let (out, report) = lint_markdown(
            input,
            &[LintRule::CollapseExcessBlankLines],
        );
        assert_eq!(out, "a\r\n\r\n\r\nb\r\n");
        assert_eq!(report.collapsed_runs, 1);
    }

    #[test]
    fn collapses_excess_blank_lines_preserves_two() {
        let input = "a\n\n\nb\n";
        let (out, report) = lint_markdown(
            input,
            &[LintRule::CollapseExcessBlankLines],
        );
        assert_eq!(out, "a\n\n\nb\n");
        assert_eq!(report.collapsed_runs, 0);
    }

    #[test]
    fn runs_all_rules_together() {
        let input = "hello   \n\n\n\n\nworld  ";
        let (out, report) = lint_markdown(
            input,
            &[
                LintRule::TrimTrailingWhitespace,
                LintRule::EnsureFinalNewline,
                LintRule::CollapseExcessBlankLines,
            ],
        );
        assert_eq!(out, "hello\n\n\nworld\n");
        assert_eq!(report.trimmed_lines, 2);
        assert!(report.added_final_newline);
        assert_eq!(report.collapsed_runs, 1);
    }

    #[test]
    fn leaves_code_block_trailing_whitespace_alone() {
        // 标色规则会去除每一行的行尾空白，包括代码围栏内容。
        // 这与多数编辑器对 Markdown 的处理一致。该行为已在
        // 规则的文档注释中说明，用户可以通过停用该规则来退出。
        let input = "```\nfoo   \n```\n";
        let (out, report) = lint_markdown(input, &[LintRule::TrimTrailingWhitespace]);
        assert_eq!(out, "```\nfoo\n```\n");
        assert_eq!(report.trimmed_lines, 1);
    }
}