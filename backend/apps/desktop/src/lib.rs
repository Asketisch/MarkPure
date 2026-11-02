//! MarkPure 桌面端的**库**目标。
//!
//! 之前所有 IPC 实现都住在 `main.rs` 的模块树里，只有二进制目标能
//! 触达。这让「跑一遍全部 IPC 命令」的自动化测试无从下手——除非
//! 把整个应用拉起来（需要 GUI 会话），否则没法在命令行里驱动
//! 处理器。
//!
//! 拆出库目标后：
//!
//! - `main.rs` 只负责窗口 / WebView / 事件循环接线；
//! - `src/bin/mt_harness.rs` 复用同一套处理器，以 JSON-lines 协议
//!   把 stdin/stdout 变成 IPC 通道，供 Python 测试脚本驱动；
//! - 单元测试可以直接 `use markpure::dispatch::...`。
//!
//! 模块职责见 `AGENTS.md`。

pub mod dispatch;
pub mod editor_ops;
pub mod export_ops;
pub mod file_ops;
pub mod state;
pub mod test_driver;
pub mod workspace_ops;
