//! 调试专用测试驱动器（环境变量 `MARKPURE_TEST_DRIVER` 门控）。
//!
//! 背景：无头 / 锁定控制台的自动化测试环境下，物理屏幕截图与
//! 合成鼠标键盘事件不可用，但应用窗口与 WebView 本身是活的。
//! 本模块提供一个文件驱动的入口，让外部测试脚本能够：
//!
//! 1. 在 WebView 中执行任意 JS（测试脚本因此可以驱动 Tiptap
//!    编辑器、点击 Svelte 组件、读取 DOM 状态）；
//! 2. 把 WKWebView 的当前渲染结果栅格化成 PNG（真实像素，
//!    与屏幕是否休眠 / 被锁无关）。
//!
//! 协议：驱动目录（环境变量值）下出现 `cmd.json` 即为一条命令：
//!
//! ```json
//! {"id": 1, "js": "return document.title"}
//! {"id": 2, "snapshot": "/tmp/out.png"}
//! ```
//!
//! 处理结果写入 `result_<id>.json`（`{"ok":true,...}` 或
//! `{"ok":false,"error":"..."}`），随后命令文件被删除。
//! JS 的返回值经页面侧 `window.ipc.postMessage` →
//! `__driver_report` IPC 命令回传（复用既有 IPC 管道）。
//!
//! 生产环境不设置该环境变量，本模块完全不活动。

use super::state::{lock_or_recover, AppEvent};
use std::sync::{Arc, Mutex};

const CMD_FILE: &str = "cmd.json";

/// 驱动目录；未启用时为 `None`。
fn driver_dir() -> Option<std::path::PathBuf> {
    std::env::var("MARKPURE_TEST_DRIVER")
        .ok()
        .filter(|s| !s.is_empty())
        .map(std::path::PathBuf::from)
}

/// 轮询线程：检测 `cmd.json` 并投递到事件循环（WebView 操作必须
/// 在主线程执行）。未启用时直接返回。
pub fn spawn_if_enabled(proxy: tao::event_loop::EventLoopProxy<AppEvent>) -> bool {
    let Some(dir) = driver_dir() else {
        return false;
    };
    if let Err(e) = std::fs::create_dir_all(&dir) {
        eprintln!("[test_driver] cannot create driver dir {dir:?}: {e}");
        return false;
    }
    eprintln!("[test_driver] enabled, dir = {dir:?}");
    std::thread::spawn(move || loop {
        let cmd_path = dir.join(CMD_FILE);
        if cmd_path.exists() {
            match std::fs::read_to_string(&cmd_path) {
                Ok(body) => {
                    // 先改名再读，避免测试脚本用「写入即存在」信号
                    // 重复投递同一条命令。
                    let _ = std::fs::rename(&cmd_path, dir.join("cmd.processing"));
                    if let Err(e) = proxy.send_event(AppEvent::TestDriver(body)) {
                        eprintln!("[test_driver] send_event failed: {e}");
                        return;
                    }
                }
                Err(e) => {
                    eprintln!("[test_driver] read cmd.json failed: {e}");
                    let _ = std::fs::remove_file(&cmd_path);
                }
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    });
    true
}

/// 主线程执行一条驱动命令。`webview` 是应用唯一的 WebView。
pub fn execute(cmd_body: &str, webview: &Arc<Mutex<Option<wry::WebView>>>) {
    #[derive(serde::Deserialize)]
    struct DriverCmd {
        id: u64,
        #[serde(default)]
        js: Option<String>,
        #[serde(default)]
        snapshot: Option<String>,
    }
    let cmd: DriverCmd = match serde_json::from_str(cmd_body) {
        Ok(c) => c,
        Err(e) => {
            write_result(driver_dir(), 0, false, &format!("bad command json: {e}"));
            return;
        }
    };
    let dir = driver_dir();
    let wv_guard = lock_or_recover(webview);
    let Some(ref webview) = *wv_guard else {
        write_result(dir, cmd.id, false, "webview not ready");
        return;
    };
    if let Some(path) = &cmd.snapshot {
        // 结果由完成回调异步写出（PNG 落盘后）。
        if let Err(e) = snapshot_webview(webview, path, dir.clone(), cmd.id) {
            write_result(dir, cmd.id, false, &e);
        }
        return;
    }
    if let Some(js) = &cmd.js {
        // 页面侧异步求值；结果经 `__driver_report` 回传（见下方
        // `cmd_report`）。包装器把用户代码的返回值/异常转成 IPC。
        let wrapped = format!(
            "(async () => {{ {js} }})() \
             .then(r => window.ipc && window.ipc.postMessage(JSON.stringify({{ \
             id: 987654321, cmd: '__driver_report', params: {{ req: {id}, result: (r === undefined ? null : r) }}}}))) \
             .catch(e => window.ipc && window.ipc.postMessage(JSON.stringify({{ \
             id: 987654321, cmd: '__driver_report', params: {{ req: {id}, error: String(e) }}}})))",
            id = cmd.id,
            js = js
        );
        match webview.evaluate_script(&wrapped) {
            Ok(()) => { /* 结果异步到达 */ }
            Err(e) => write_result(dir, cmd.id, false, &format!("evaluate_script: {e}")),
        }
        return;
    }
    write_result(dir, cmd.id, false, "command had neither 'js' nor 'snapshot'");
}

/// `__driver_report` IPC 命令：页面把 JS 求值结果写回驱动目录。
/// 快速路径调用；返回 Null（前端没有该 id 的 pending 请求，
/// 迟到响应会被 `ipc.ts` 静默忽略）。
pub fn cmd_report(params: &serde_json::Value) -> std::result::Result<serde_json::Value, String> {
    let req = params["req"].as_u64().unwrap_or(0);
    if let Some(result) = params.get("result") {
        write_result_raw(driver_dir(), req, true, result.clone());
    } else {
        let err = params["error"].as_str().unwrap_or("unknown page error");
        write_result(driver_dir(), req, false, err);
    }
    Ok(serde_json::Value::Null)
}

fn write_result(dir: Option<std::path::PathBuf>, id: u64, ok: bool, msg: &str) {
    let value = if ok {
        serde_json::json!({ "ok": true, "message": msg })
    } else {
        serde_json::json!({ "ok": false, "error": msg })
    };
    write_result_raw(dir, id, ok, value);
}

fn write_result_raw(
    dir: Option<std::path::PathBuf>,
    id: u64,
    ok: bool,
    value: serde_json::Value,
) {
    let Some(dir) = dir else { return };
    let body = if ok {
        serde_json::json!({ "ok": true, "result": value })
    } else {
        serde_json::json!({ "ok": false, "error": value })
    };
    let path = dir.join(format!("result_{id}.json"));
    if let Err(e) = std::fs::write(&path, body.to_string()) {
        eprintln!("[test_driver] write result {path:?} failed: {e}");
    }
    // 清理处理标记，让驱动线程知道本轮完成。
    let _ = std::fs::remove_file(dir.join("cmd.processing"));
}

/// 用 WKWebView 的 `takeSnapshotWithConfiguration:completionHandler:`
/// 把当前内容栅格化成 PNG。参数全是对象（无结构体编码问题），且
/// 与屏幕状态无关——窗口在其他 Space / 显示器休眠时同样有效。
/// 完成回调异步到达；结果文件在回调里写出。
#[cfg(target_os = "macos")]
fn snapshot_webview(
    webview: &wry::WebView,
    out_path: &str,
    driver_dir: Option<std::path::PathBuf>,
    cmd_id: u64,
) -> Result<(), String> {
    use block2::RcBlock;
    use objc2::class;
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    use objc2_foundation::NSString;

    let view = wry::WebViewExtMacOS::webview(webview);

    let out_path = out_path.to_string();
    let handler = RcBlock::new(move |image_ptr: *mut AnyObject| {
        // 完成回调跨 ObjC 边界进入 Rust：panic 不允许外溢（会 abort），
        // 一律捕获并落盘为失败结果。
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| -> Result<(), String> {
            unsafe {
                if image_ptr.is_null() {
                    return Err("snapshot image is nil".into());
                }
                let tiff_ptr: *mut AnyObject = msg_send![image_ptr, TIFFRepresentation];
                if tiff_ptr.is_null() {
                    return Err("TIFFRepresentation is nil".into());
                }
                let rep_ptr: *mut AnyObject =
                    msg_send![class!(NSBitmapImageRep), imageRepWithData: tiff_ptr];
                if rep_ptr.is_null() {
                    return Err("imageRepWithData is nil".into());
                }
                let dict_ptr: *mut AnyObject = msg_send![class!(NSDictionary), dictionary];
                let png_ptr: *mut AnyObject =
                    msg_send![rep_ptr, representationUsingType: 4u64, properties: dict_ptr];
                if png_ptr.is_null() {
                    return Err("PNG representation is nil".into());
                }
                let path = NSString::from_str(&out_path);
                let written: bool = msg_send![png_ptr, writeToFile: &*path, atomically: true];
                if !written {
                    return Err(format!("writeToFile failed: {out_path}"));
                }
                Ok(())
            }
        }));
        match result {
            Ok(Ok(())) => write_result(driver_dir.clone(), cmd_id, true, "snapshot written"),
            Err(_) | Ok(Err(_)) => {}
        }
        if let Err(panic) = &result {
            let msg = panic
                .downcast_ref::<String>()
                .cloned()
                .or_else(|| panic.downcast_ref::<&str>().map(|s| s.to_string()))
                .unwrap_or_else(|| "unknown panic".into());
            eprintln!("[test_driver] snapshot block panicked: {msg}");
            write_result(driver_dir.clone(), cmd_id, false, &msg);
        }
    });

    unsafe {
        let config_ptr: *mut AnyObject = msg_send![class!(WKSnapshotConfiguration), new];
        let _: () = msg_send![
            &view,
            takeSnapshotWithConfiguration: config_ptr,
            completionHandler: &*handler
        ];
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn snapshot_webview(_webview: &wry::WebView, _out_path: &str) -> Result<(), String> {
    Err("snapshot only implemented on macOS".into())
}
