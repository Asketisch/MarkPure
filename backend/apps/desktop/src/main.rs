//! MarkPure 桌面端入口。
//!
//! 目前绝大部分 IPC 实现分布在按主题划分的模块中：
//!
//! - `state` —— 类型（`IpcMessage`、`IpcResponse`、`AppState`、
//!   `AppEvent`）及每个处理器都会用到的 `lock_or_recover` +
//!   `escape_for_js` 辅助函数。
//! - `dispatch` —— 唯一的 `handle_command` 路由表。
//! - `file_ops` —— 文件对话框、打开 / 保存、目录树、
//!   文件增删改、拖放。
//! - `editor_ops` —— 大纲 / 双链 / 标签、LRU 文档注册表、
//!   Markdown 扩展（mermaid、frontmatter、table、folding、
//!   pandoc）、拼写检查。
//! - `workspace_ops` —— 标签页、配置、最近文件、主题、
//!   快捷键、i18n、书签、应用信息。
//! - `export_ops` —— HTML / PDF / Word 导出、工作区
//!   搜索、资源（图片）上传。
//!
//! 本文件只保留：
//! - 上面的模块声明。
//! - 为 `mt://localhost` URL 提供资源的处理器。
//! - 把 wry WebView 与 tao 事件循环接起来的 `main()` 函数。
//! - 平台相关的原生菜单配置（仅 macOS）。

// 处理器实现住在库目标（`markpure`）里，本文件只保留窗口 /
// WebView / 事件循环的接线。见 `lib.rs` 的模块文档。
use markpure::state::{lock_or_recover, AppEvent, AppState, IpcMessage, IpcResponse};
use markpure::{dispatch, state, test_driver};
use std::sync::Arc;
use std::sync::Mutex;
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder};
use tao::window::WindowBuilder;
use wry::http::{header, header::CONTENT_TYPE, Response, StatusCode};
use wry::WebViewBuilder;

// ============================== 资源服务 ==============================

/// 提供嵌入的 Vite 构建产物中的文件。用于 WebView 发出的
/// `mt://localhost/...` 请求。SPA 路由回退到 `index.html`，
/// 让 `mt://localhost/some/note` 这类深链接在刷新后也能工作。
///
/// 细节：
/// - 响应必须带 `Access-Control-Allow-Origin`：Vite 构建给
///   `<script type="module" crossorigin>` / `modulepreload` /
///   样式表都加了 `crossorigin` 属性，而自定义协议上的 CORS 检查
///   需要 ACAO 头。缺失时模块脚本会被静默拦截，应用白屏无法启动。
/// - 带「类文件扩展名」的路径不做 SPA 回退：构建升级后旧的带哈希
///   资产名会失效，若把 `index.html`（HTML）当作 JS 返回，模块
///   同样静默失败。让它 404，配合 `no-store` 头强制 WebView 每次
///   取最新的 `index.html`，即可避免「旧 HTML 引用已删除资产」。
/// - `Cache-Control: no-store`：应用的资产随构建变化，无缓存价值。
fn serve_asset(path: &str) -> Response<Vec<u8>> {
    let path = path.trim_start_matches('/');

    const NO_STORE: &str = "no-store";

    if let Some(file) = state::Assets::get(path) {
        let mime = file.metadata.mimetype();
        return Response::builder()
            .header(CONTENT_TYPE, mime)
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .header(header::CACHE_CONTROL, NO_STORE)
            .body(file.data.to_vec())
            .unwrap();
    }

    // 资产类请求（带扩展名）缺失时直接 404，不回退到 SPA 入口。
    if path.split('/').last().is_some_and(|last| last.contains('.')) {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(b"404 Not Found".to_vec())
            .unwrap();
    }

    // SPA 回退
    if let Some(file) = state::Assets::get("index.html") {
        let mime = file.metadata.mimetype();
        return Response::builder()
            .header(CONTENT_TYPE, mime)
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .header(header::CACHE_CONTROL, NO_STORE)
            .body(file.data.to_vec())
            .unwrap();
    }

    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .body(b"404 Not Found".to_vec())
        .unwrap()
}

// ============================== 主入口 ==============================

fn main() {
    // 启动耗时追踪。默认关闭；设 `MARKPURE_STARTUP_LOG=1` 后把各阶段
    // 的耗时打到 stderr。启动时间由三部分组成：AppKit 事件循环
    // (~50ms) + 窗口创建 (~45ms) + WKWebView 创建 (~85ms)，
    // 之后才是前端资源的加载与解析。
    let t0 = std::time::Instant::now();
    let startup_log = std::env::var("MARKPURE_STARTUP_LOG")
        .map(|v| v != "0" && !v.is_empty())
        .unwrap_or(false);
    let mark = |label: &str| {
        if startup_log {
            eprintln!("[startup] {label}: {:?}", t0.elapsed());
        }
    };
    mark("main entry");
    let event_loop = EventLoopBuilder::<AppEvent>::with_user_event().build();
    mark("event loop built");
    let state = Arc::new(AppState::new());
    mark("AppState ready");
    {
        let proxy = event_loop.create_proxy();
        lock_or_recover(&state.proxy).replace(proxy);
    }

    // 判断是否为子窗口
    let is_child = std::env::args().any(|a| a.starts_with("--child-window="));

    // 加载窗口图标（256x256 PNG）
    // 尝试多个位置：开发模式（项目根目录）与打包模式（Resources/）
    fn find_icon_path() -> Option<std::path::PathBuf> {
        let dev_path = std::path::Path::new("icons/256x256.png");
        if dev_path.exists() {
            return Some(dev_path.to_path_buf());
        }
        // 尝试打包模式：可执行文件在 Contents/MacOS/，图标在 Contents/Resources/icons/
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                let bundle_path = exe_dir
                    .parent()
                    .map(|p| p.join("Resources/icons/256x256.png"));
                if let Some(p) = bundle_path {
                    if p.exists() {
                        return Some(p);
                    }
                }
            }
        }
        None
    }

    let window_icon = find_icon_path().and_then(|icon_path| {
        match image::open(&icon_path) {
            Ok(img) => {
                let rgba = img.to_rgba8();
                let (width, height) = rgba.dimensions();
                tao::window::Icon::from_rgba(rgba.into_raw(), width, height).ok()
            }
            Err(e) => {
                eprintln!("Failed to load icon: {}", e);
                None
            }
        }
    });

    let mut window_builder = WindowBuilder::new()
        .with_title("MarkPure")
        .with_inner_size(tao::dpi::LogicalSize::new(1200, 800));
    if let Some(icon) = window_icon {
        window_builder = window_builder.with_window_icon(Some(icon));
    }
    // 测试钩子：MARKPURE_ALL_SPACES=1 时窗口悬浮于所有 Space
    // （自动化测试宿主常停在自身的全屏 Space 上，普通窗口会
    // 落在不可见的桌面 Space）。生产环境不设置该变量，行为不变。
    if std::env::var("MARKPURE_ALL_SPACES").as_deref() == Ok("1") {
        window_builder = window_builder.with_visible_on_all_workspaces(true);
    }
    let window = window_builder.build(&event_loop).unwrap();

    #[cfg(target_os = "macos")]
    setup_macos_menu();

    // `wry::WebView` 只被 UI 线程侧的回调（自定义协议处理器、
    // 事件循环处理器）使用；允许其 Arc 包装不满足 Send+Sync。
    #[allow(clippy::arc_with_non_send_sync)]
    let webview: Arc<Mutex<Option<wry::WebView>>> = Arc::new(Mutex::new(None));
    let wv_clone = webview.clone();
    let state_clone = state.clone();

    // DevTools 只在开发模式（`--dev`）下开启。正式版开启它会额外
    // 建立 WebKit 检查通道，实测让 WebView 创建多花约 30ms、窗口创建
    // 多花约 50ms——占启动时间的近三成。需要排查正式版时可用
    // `MARKPURE_DEVTOOLS=1` 强制打开。
    let dev_mode = std::env::args().any(|a| a == "--dev");
    let force_devtools = std::env::var("MARKPURE_DEVTOOLS")
        .map(|v| v != "0" && !v.is_empty())
        .unwrap_or(false);
    let mut builder = WebViewBuilder::new()
        .with_devtools(dev_mode || force_devtools)
        .with_custom_protocol("mt".into(), |_id, request| {
            let path = request.uri().path();
            serve_asset(path).map(Into::into)
        });

    if dev_mode {
        builder = builder.with_url("http://localhost:5173");
    } else if is_child {
        // 子窗口以撕离模式加载同一个应用
        builder = builder.with_url("mt://localhost");
    } else {
        builder = builder.with_url("mt://localhost");
    }

    let state_for_handler = state_clone.clone();
    builder = builder.with_ipc_handler(move |request| {
        let message = request.body();
        let msg: IpcMessage = match serde_json::from_str(message) {
            Ok(m) => m,
            Err(e) => {
                eprintln!("IPC parse error: {e}");
                // 解析失败时前端没有可匹配的 id——用 id=0 回一个
                // 错误响应，避免调用方 Promise 永久挂起；ipc.ts 的
                // 待处理表里没有 id 0，会安全忽略（或至少在控制台
                // 可见）。
                let response = IpcResponse {
                    id: 0,
                    result: None,
                    error: Some(format!("malformed IPC message: {e}")),
                };
                if let Ok(js) = serde_json::to_string(&response) {
                    let js_escaped = state::escape_for_js(&js);
                    if let Ok(wv) = wv_clone.lock() {
                        if let Some(ref webview) = *wv {
                            let _ = webview.evaluate_script(&format!(
                                "window.__mt_dispatch('{js_escaped}')"
                            ));
                        }
                    }
                }
                return;
            }
        };

        // 快速路径：内联执行并立即下发响应。
        if let Some(response) = dispatch::handle_command(&msg, &state_for_handler) {
            let js = match serde_json::to_string(&response) {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("IPC serialize error: {e}");
                    return;
                }
            };
            let js_escaped = state::escape_for_js(&js);
            if let Ok(wv) = wv_clone.lock() {
                if let Some(ref webview) = *wv {
                    let _ = webview.evaluate_script(&format!("window.__mt_dispatch('{js_escaped}')"));
                }
            }
            return;
        }

        // 慢速路径：卸载到 tokio 线程池。响应
        // 通过 EventLoopProxy → IpcResponse 事件送达。
        dispatch::dispatch_slow(msg, state_for_handler.clone());
    });

    mark("window built");
    let built = builder.build(&window).unwrap();
    mark("webview built");
    *lock_or_recover(&webview) = Some(built);

    // 调试专用测试驱动器（MARKPURE_TEST_DRIVER 门控）：命令经
    // EventLoopProxy 到主线程执行，见 `test_driver` 模块文档。
    test_driver::spawn_if_enabled(event_loop.create_proxy());

    let webview_for_el = webview.clone();
    mark("entering event loop (page load starts now)");
    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                *control_flow = ControlFlow::Exit;
            }
            Event::UserEvent(AppEvent::TestDriver(cmd)) => {
                // 测试命令允许失败：快照/求值的 objc 调用异常时
                // 捕获 panic（仅中止该条命令），应用保持存活。
                let body = cmd.clone();
                let wv = webview_for_el.clone();
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
                    test_driver::execute(&body, &wv);
                }))
                .map_err(|p| {
                    let msg = p
                        .downcast_ref::<String>()
                        .cloned()
                        .or_else(|| p.downcast_ref::<&str>().map(|s| s.to_string()))
                        .unwrap_or_else(|| "unknown panic".into());
                    eprintln!("[test_driver] command panicked: {msg}");
                });
            }
            Event::UserEvent(AppEvent::FileChanges(events)) => {
                if let Ok(wv) = webview_for_el.lock() {
                    if let Some(ref webview) = *wv {
                        let json = serde_json::to_string(&events)
                            .unwrap_or_else(|_| "[]".into());
                        let escaped = state::escape_for_js(&json);
                        let _ = webview.evaluate_script(&format!(
                            "window.__mt_on_file_changes('{escaped}')"
                        ));
                    }
                }
            }
            // 异步 IPC 响应从此处从 tokio 工作线程送达。
            Event::UserEvent(AppEvent::IpcResponse { js }) => {
                if let Ok(wv) = webview_for_el.lock() {
                    if let Some(ref webview) = *wv {
                        let _ = webview.evaluate_script(&format!(
                            "window.__mt_dispatch('{js}')"
                        ));
                    }
                }
            }
            // 拼写检查请求在这里分发，因为 macOS 上的 NSSpellChecker
            // 必须在主线程运行（这里就是主线程——tao 的
            // `event_loop.run` 要求如此）。其他平台则回退到内置的
            // 英文词典，它与线程无关，但为了路径统一仍会经过此分支。
            Event::UserEvent(AppEvent::SpellCheckRequest { text, lang, reply }) => {
                #[cfg(target_os = "macos")]
                let result: Result<Vec<spellcheck::SpellError>, String> = {
                    let errors = spellcheck::macos::check_with_nsspellchecker(&text, &lang);
                    Ok(errors)
                };
                #[cfg(not(target_os = "macos"))]
                let result: Result<Vec<spellcheck::SpellError>, String> = {
                    // 仅英文回退。中日韩语言会产生空错误（见
                    // `spellcheck::check_spelling`）。
                    let r = spellcheck::check_spelling(&text, &lang);
                    Ok(r.errors)
                };
                let _ = reply.send(result);
            }
            _ => {}
        }
    });
}

#[cfg(target_os = "macos")]
fn setup_macos_menu() {
    use objc2_foundation::{MainThreadMarker, NSString};
    use objc2_app_kit::{
        NSApplication, NSEventModifierFlags, NSMenu, NSMenuItem,
    };

    let mtm = unsafe { MainThreadMarker::new_unchecked() };
    let app = NSApplication::sharedApplication(mtm);

    let menubar = NSMenu::new(mtm);

    // 应用菜单
    let app_menu = NSMenu::new(mtm);
    let app_item = NSMenuItem::new(mtm);
    unsafe {
        app_menu.addItemWithTitle_action_keyEquivalent(
            &NSString::from_str("Hide MarkPure"),
            Some(objc2::sel!(hide:)),
            &NSString::from_str("h"),
        );
        app_menu.addItemWithTitle_action_keyEquivalent(
            &NSString::from_str("Quit MarkPure"),
            Some(objc2::sel!(terminate:)),
            &NSString::from_str("q"),
        );
        app_item.setSubmenu(Some(&app_menu));
    }
    menubar.addItem(&app_item);

    // 编辑菜单
    let edit_menu = NSMenu::new(mtm);
    let edit_item = NSMenuItem::new(mtm);
    unsafe {
        edit_item.setTitle(&NSString::from_str("Edit"));

        edit_menu.addItemWithTitle_action_keyEquivalent(
            &NSString::from_str("Undo"),
            Some(objc2::sel!(undo:)),
            &NSString::from_str("z"),
        );

        let redo = edit_menu.addItemWithTitle_action_keyEquivalent(
            &NSString::from_str("Redo"),
            Some(objc2::sel!(redo:)),
            &NSString::from_str("Z"),
        );
        let cmd_shift = NSEventModifierFlags(
            (NSEventModifierFlags::NSEventModifierFlagCommand
                | NSEventModifierFlags::NSEventModifierFlagShift).0
        );
        redo.setKeyEquivalentModifierMask(cmd_shift);

        edit_menu.addItem(&NSMenuItem::separatorItem(mtm));

        edit_menu.addItemWithTitle_action_keyEquivalent(
            &NSString::from_str("Cut"),
            Some(objc2::sel!(cut:)),
            &NSString::from_str("x"),
        );
        edit_menu.addItemWithTitle_action_keyEquivalent(
            &NSString::from_str("Copy"),
            Some(objc2::sel!(copy:)),
            &NSString::from_str("c"),
        );
        edit_menu.addItemWithTitle_action_keyEquivalent(
            &NSString::from_str("Paste"),
            Some(objc2::sel!(paste:)),
            &NSString::from_str("v"),
        );
        edit_menu.addItemWithTitle_action_keyEquivalent(
            &NSString::from_str("Select All"),
            Some(objc2::sel!(selectAll:)),
            &NSString::from_str("a"),
        );

        edit_item.setSubmenu(Some(&edit_menu));
    }

    menubar.addItem(&edit_item);

    app.setMainMenu(Some(&menubar));
}
