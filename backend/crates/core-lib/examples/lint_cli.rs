//! `lint_markdown` 函数的手动端到端验证驱动。
//! 该测试程序接收单个参数（待检查的输入），运行完整的规则集，
//! 并将 `{content, report}` 以 JSON 形式输出到标准输出。
//!
//! 在 `backend/crates/core-lib/` 下通过 `cargo run --example lint_cli -- <输入>` 运行，
//! 或者作为更大的 `scripts/validate-lint-on-save.ts` 端到端测试的一部分
//! （该测试会把此二进制构建为 `scripts/validate-lint-on-save` 并调用它）。
//!
//! 成功时退出码为 `0`，输入非法时退出码为 `1`。

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