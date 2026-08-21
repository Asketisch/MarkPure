//! 拼写检查：在主线程上调度 NSSpellChecker。
//!
//! 为什么单独放一个文件：`cmd_check_spelling` 是 editor_ops 中唯一
//! 跨线程的处理器（它通过 `state.proxy` 把请求弹到 tao 事件循环的
//! 主线程上）。把它隔离出来，让跨线程约定容易找到，测试面也更小。

use crate::state::{lock_or_recover, AppEvent, AppState};

/// 把拼写检查请求转发到 tao 事件循环的主线程（那里才能安全调用
/// NSSpellChecker），然后在一次性通道上同步等待结果。
///
/// 为什么要绕这么一圈：IPC 处理器运行在 wry 回调线程上，而不是
/// 主线程。macOS 上的 NSSpellChecker 只保证主线程调用安全。
/// 非 macOS 的回退路径也走相同的事件循环分支，以保持行为一致，
/// 尽管它没有线程要求。
///
/// 等待有 5 秒超时上限。若事件循环卡住（例如 WebView 正在重绘
/// 超大帧），IPC 会干净地失败而不是让渲染器永远阻塞——前端的拼写
/// 检查插件对那一批内容只是不产生标记，并在下一次防抖时重试。
pub fn cmd_check_spelling(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let text = params["text"].as_str().ok_or("Missing 'text' parameter")?;
    let lang = params.get("lang").and_then(|v| v.as_str()).unwrap_or("en");

    // 构建请求。SyncSender(1) 是一次性通道——每个请求只回复一次，
    // 事件循环分支一完成，发送端随即被丢弃。
    let (tx, rx) = std::sync::mpsc::sync_channel::<Result<Vec<spellcheck::SpellError>, String>>(1);
    let event = AppEvent::SpellCheckRequest {
        text: text.to_string(),
        lang: lang.to_string(),
        reply: tx,
    };

    // 发送到主线程。事件循环代理在 `main()` 中事件循环构建完成后
    // 立即填充；若此处缺失，说明存在严重的初始化顺序 bug，
    // 因此返回一个相当于 5xx 的错误而不是 panic。
    {
        let proxy_guard = lock_or_recover(&state.proxy);
        let proxy = proxy_guard
            .as_ref()
            .ok_or_else(|| "event loop proxy not initialized".to_string())?;
        proxy
            .send_event(event)
            .map_err(|e| format!("failed to dispatch spell check: {}", e))?;
    }

    // 有界等待。即使处理 1MB 的文档，NSSpellChecker 也会在一秒内
    // 返回；5 秒是「事件循环出问题」的临界值。
    let errors = rx
        .recv_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| format!("spell check timed out: {}", e))??;

    let result = spellcheck::SpellCheckResult {
        errors,
        language: lang.to_string(),
    };
    serde_json::to_value(result).map_err(|e| e.to_string())
}
