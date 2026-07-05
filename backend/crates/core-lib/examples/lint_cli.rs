//! Manual end-to-end validation driver for the
//! `lint_markdown` function. The harness takes a single
//! argument (the input to lint), runs the full rule set,
//! and prints `{content, report}` as JSON to stdout.
//!
//! Run via `cargo run --example lint_cli -- <input>` from
//! `backend/crates/core-lib/`, or as part of the larger
//! `scripts/validate-lint-on-save.ts` end-to-end test
//! (which builds this binary as
//! `scripts/validate-lint-on-save` and invokes it).
//!
//! Exit code is `0` on success, `1` on bad input.

use mt_core::{lint_markdown, LintRule};
use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 2 {
        eprintln!("usage: lint_cli <input>");
        return ExitCode::from(1);
    }
    let input = &args[1];
    let rules = vec![
        LintRule::TrimTrailingWhitespace,
        LintRule::EnsureFinalNewline,
        LintRule::CollapseExcessBlankLines,
    ];
    let (content, report) = lint_markdown(input, &rules);
    let payload = serde_json::json!({
        "content": content,
        "report": report,
    });
    println!("{}", payload);
    ExitCode::SUCCESS
}