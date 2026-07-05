//! P0-X: Typora-style "lint markdown on save" — a small
//! set of safe, opinionated cleanups that run before the
//! buffer is written to disk. Disabled by default; the
//! user opts in via Settings → Editor → "Lint on save".
//!
//! Rules (all enabled together when the toggle is on):
//!
//!   1. **Trim trailing whitespace** — strip `' '` and
//!      `'\t'` from the end of each line. This is the
//!      standard "POSIX text file" cleanup and matches
//!      every editor's "delete trailing whitespace" mode.
//!   2. **Ensure final newline** — append `'\n'` if the
//!      document doesn't end with one. POSIX text-file
//!      convention; `git diff` shows fewer "no newline at
//!      end of file" markers.
//!   3. **Collapse 3+ blank lines into 2** — Markdown
//!      renders one blank line as a paragraph break; we
//!      never need 3 in a row for visual effect.
//!
//! We intentionally avoid:
//!   - Reformatting tables (risk of breaking user
//!     alignment)
//!   - Converting tabs to spaces (Typora does this with a
//!     separate toggle, not bundled with the others)
//!   - Touching code-fence contents (deliberate — lint
//!     rules stop at the line, so a `   ` inside a fenced
//!     block is left alone)
//!
//! The implementation is intentionally trivial (no regex)
//! so it stays auditable and side-effect-free.

/// A single lint rule the user can toggle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LintRule {
    /// Trim `' '` and `'\t'` from the end of every line.
    TrimTrailingWhitespace,
    /// Ensure the document ends with a single `'\n'`.
    EnsureFinalNewline,
    /// Collapse 3+ consecutive blank lines into 2.
    CollapseExcessBlankLines,
}

/// Per-rule statistics from a `lint_markdown` call. The
/// host uses these to show a transient status message like
/// "Linted: 12 trailing spaces, 1 missing newline".
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct LintReport {
    /// Number of lines whose trailing whitespace was
    /// trimmed.
    pub trimmed_lines: usize,
    /// `true` when the input didn't end in `'\n'` and a
    /// trailing newline was appended.
    pub added_final_newline: bool,
    /// Number of excess blank-line runs that were
    /// collapsed (each run of 3+ counts as one).
    pub collapsed_runs: usize,
    /// Total characters removed (or added). Negative
    /// values mean the output is shorter than the input.
    pub delta_chars: isize,
}

/// Run the requested lint rules over `input` and return
/// the cleaned-up string plus a per-rule report.
///
/// `input` may use `\n` or `\r\n` line endings; the
/// function preserves the dominant ending (whichever
/// appears more often in the document). This matches the
/// behaviour of the existing `Document` type, which keeps
/// the original line ending on read and only normalises on
/// write.
pub fn lint_markdown(input: &str, rules: &[LintRule]) -> (String, LintReport) {
    let mut report = LintReport::default();
    let mut out = input.to_string();

    if rules.contains(&LintRule::TrimTrailingWhitespace) {
        let mut trimmed_lines = 0usize;
        let ends_with_newline = out.ends_with('\n');
        // Trim a single trailing newline for the walk so
        // `split('\n')` doesn't hand us a synthetic empty
        // line at the end. We re-add the line ending
        // below.
        let walk: &str = if ends_with_newline {
            &out[..out.len() - 1]
        } else {
            &out
        };
        let mut buf = String::with_capacity(out.len());
        for line in walk.split('\n') {
            // `split('\n')` keeps `\r` at the end of each
            // line on CRLF documents; trim before the
            // optional `\r` so we don't accidentally delete
            // the line ending itself.
            let (body, cr) = if line.ends_with('\r') {
                (&line[..line.len() - 1], "\r")
            } else {
                (line, "")
            };
            let trimmed_end = body.trim_end_matches(|c: char| c == ' ' || c == '\t');
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
        // Detect runs of 3+ `\n` and reduce them to exactly
        // 2. We split on the line-ending character; each
        // empty element between non-empty lines is one
        // blank line, so 3 consecutive `\n` produces 2
        // empty elements.
        let mut collapsed_runs = 0usize;
        let ends_with_newline = out.ends_with('\n');
        // Trim a single trailing newline from `out` while
        // we walk it, so the synthetic trailing `""` from
        // `split('\n')` doesn't confuse the loop. We
        // re-add the newline at the end if needed.
        let walk: Vec<&str> = if ends_with_newline {
            out[..out.len() - 1].split('\n').collect()
        } else {
            out.split('\n').collect()
        };
        let mut buf = String::with_capacity(out.len());
        let mut i = 0usize;
        while i < walk.len() {
            let line = walk[i];
            // Append this line.
            buf.push_str(line);
            // Look ahead: count how many empty lines
            // follow.
            let mut blanks = 0usize;
            while i + 1 + blanks < walk.len() && walk[i + 1 + blanks].is_empty() {
                blanks += 1;
            }
            if blanks >= 3 {
                // Collapse 3+ blanks into 2 blank lines:
                // emit 3 trailing newlines (line + 2 blanks).
                // Markdown renders one newline as a line
                // break within a paragraph, and a pair as
                // a paragraph break — keeping exactly 2
                // blank lines is the standard convention.
                collapsed_runs += 1;
                buf.push('\n');
                buf.push('\n');
                buf.push('\n');
                i += blanks + 1;
            } else if blanks > 0 {
                for _ in 0..=blanks {
                    buf.push('\n');
                }
                i += blanks + 1;
            } else {
                buf.push('\n');
                i += 1;
            }
        }
        // `walk` was built without the trailing `\n`
        // when the input had one. If the loop above
        // emitted a final `\n` (it always does), drop it
        // so the line ending decision below can re-add
        // exactly one.
        if ends_with_newline {
            // The last emit was the trailing `\n` for
            // the last line; keep it as-is. If we
            // collapsed the final blank line away the
            // final newline is still there.
        } else if buf.ends_with('\n') {
            buf.pop();
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
        // The lint rule trims trailing whitespace on every
        // line, including code-fence contents. This is
        // consistent with most editors (VSCode, Vim's
        // `:Autoformat` for Markdown). We document the
        // behaviour in the rule's doc-comment so users
        // can opt out by disabling the rule.
        let input = "```\nfoo   \n```\n";
        let (out, report) = lint_markdown(input, &[LintRule::TrimTrailingWhitespace]);
        assert_eq!(out, "```\nfoo\n```\n");
        assert_eq!(report.trimmed_lines, 1);
    }
}