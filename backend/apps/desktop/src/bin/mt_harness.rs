//! MarkPure IPC 测试 harness。
//!
//! 把桌面应用的 IPC 通道暴露成 **JSON-lines over stdin/stdout**：
//! 每行输入一个 `{"id":N,"cmd":"...","params":{...}}`，每行输出一个
//! `{"id":N,"result":...}` 或 `{"id":N,"error":"..."}`。
//!
//! 它复用 `markpure::dispatch::execute_command`——与真实应用**完全
//! 相同**的路由表与处理器——因此测试脚本能覆盖真正的后端逻辑，
//! 而不必拉起 GUI。
//!
//! 用法：
//!
//! ```text
//! cargo run --bin mt_harness            # 交互式（每行一条命令）
//! echo '{"id":1,"cmd":"get_app_info"}' | cargo run --bin mt_harness
//! ```
//!
//! 特殊命令：
//!
//! - `__shutdown` —— 立即退出（供测试脚本收尾）。
//! - `__ping` —— 回显 `{"pong":true}`，用于测量往返延迟。
//! - `__poll_file_changes` —— 返回自上次调用以来积压的文件变更事件。
//!   桌面版由 Rust 通过 `evaluate_script` 主动推送；harness 没有事件
//!   循环，改为轮询，这样浏览器端的 dev 桥也能拿到同样的事件。
//!
//! 环境变量：
//!
//! - `MARKPURE_CONFIG_DIR` —— 配置目录（测试里指向临时目录，
//!   避免污染用户真实设置）。

use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::sync::mpsc::Receiver;

use markpure::dispatch::execute_command;
use markpure::state::{AppState, IpcMessage, IpcResponse};

/// harness 的运行时状态。
struct Harness {
    state: AppState,
    /// 每个被监视的工作区 id 对应的事件接收端。桌面版由事件循环线程
    /// 消费；harness 改为在 `__poll_file_changes` 时排空。
    change_receivers: HashMap<String, Receiver<fs::FileChangeEvent>>,
}

impl Harness {
    fn new() -> Self {
        Self {
            state: AppState::new(),
            change_receivers: HashMap::new(),
        }
    }

    /// 执行一条命令。
    fn execute(&mut self, msg: &IpcMessage) -> std::result::Result<serde_json::Value, String> {
        match msg.cmd.as_str() {
            // 拼写检查在生产路径上要经 tao 事件循环弹到主线程
            // （NSSpellChecker 的线程要求）。harness 没有事件循环，
            // 但它的主线程**就是**进程主线程，因此可以直接调用平台
            // 检查器，得到与生产环境等价的结果。
            "check_spelling" => {
                let text = msg
                    .params
                    .get("text")
                    .and_then(|v| v.as_str())
                    .ok_or("Missing 'text' parameter")?;
                let lang = msg
                    .params
                    .get("lang")
                    .and_then(|v| v.as_str())
                    .unwrap_or("en");
                markpure::editor_ops::check_spelling_direct(text, lang)
            }

            // 文件监视：桌面版把事件推给事件循环，harness 把接收端
            // 存起来，供 `__poll_file_changes` 排空。
            "watch_directory" => self.watch_directory(msg),

            _ => execute_command(msg, &self.state),
        }
    }

    fn watch_directory(
        &mut self,
        msg: &IpcMessage,
    ) -> std::result::Result<serde_json::Value, String> {
        let path_str = msg.params["path"]
            .as_str()
            .ok_or("Missing 'path' parameter")?;
        let path = std::path::PathBuf::from(path_str);

        let id = msg
            .params
            .get("workspace_id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(String::from)
            .unwrap_or_else(|| path_str.to_string());

        let mut watcher = markpure::state::lock_or_recover(&self.state.watcher);
        let rx = watcher.watch(&path, id.clone()).map_err(|e| e.to_string())?;
        drop(watcher);

        self.change_receivers.insert(id, rx);
        Ok(serde_json::Value::Null)
    }

    /// 排空所有监视器上积压的事件。
    fn poll_file_changes(&mut self) -> serde_json::Value {
        let mut events: Vec<serde_json::Value> = Vec::new();
        for rx in self.change_receivers.values() {
            while let Ok(ev) = rx.try_recv() {
                events.push(serde_json::to_value(ev).unwrap_or(serde_json::Value::Null));
            }
        }
        serde_json::Value::Array(events)
    }
}

fn main() {
    let mut harness = Harness::new();
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut out = stdout.lock();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[harness] stdin read error: {e}");
                break;
            }
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let msg: IpcMessage = match serde_json::from_str(trimmed) {
            Ok(m) => m,
            Err(e) => {
                // 解析失败也要回一行，否则客户端会一直等。
                let resp = IpcResponse {
                    id: 0,
                    result: None,
                    error: Some(format!("invalid IPC envelope: {e}")),
                };
                write_response(&mut out, &resp);
                continue;
            }
        };

        if msg.cmd == "__shutdown" {
            break;
        }
        if msg.cmd == "__ping" {
            let resp = IpcResponse {
                id: msg.id,
                result: Some(serde_json::json!({ "pong": true })),
                error: None,
            };
            write_response(&mut out, &resp);
            continue;
        }
        if msg.cmd == "__poll_file_changes" {
            let resp = IpcResponse {
                id: msg.id,
                result: Some(harness.poll_file_changes()),
                error: None,
            };
            write_response(&mut out, &resp);
            continue;
        }

        let resp = match harness.execute(&msg) {
            Ok(v) => IpcResponse { id: msg.id, result: Some(v), error: None },
            Err(e) => IpcResponse { id: msg.id, result: None, error: Some(e) },
        };
        write_response(&mut out, &resp);
    }
}

/// 把一条响应写成一行 JSON 并 flush。
///
/// 必须 flush——客户端按行读取，管道是全缓冲的。
fn write_response<W: Write>(out: &mut W, resp: &IpcResponse) {
    match serde_json::to_string(resp) {
        Ok(s) => {
            let _ = writeln!(out, "{s}");
            let _ = out.flush();
        }
        Err(e) => {
            eprintln!("[harness] failed to serialize response: {e}");
            let fallback = IpcResponse {
                id: resp.id,
                result: None,
                error: Some(format!("failed to serialize response: {e}")),
            };
            if let Ok(s) = serde_json::to_string(&fallback) {
                let _ = writeln!(out, "{s}");
                let _ = out.flush();
            }
        }
    }
}
