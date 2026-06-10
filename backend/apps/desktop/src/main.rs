//! MarkPure desktop entry point.
//!
//! As of P8 the bulk of the IPC implementation lives in
//! topic-specific modules:
//!
//!   - `state`          — types (`IpcMessage`, `IpcResponse`,
//!                        `AppState`, `AppEvent`) and the
//!                        `lock_or_recover` + `escape_for_js`
//!                        helpers used by every handler.
//!   - `dispatch`       — the single `handle_command`
//!                        routing table.
//!   - `file_ops`       — file dialog, open / save, directory
//!                        tree, file CRUD, drag-and-drop.
//!   - `editor_ops`     — outline / wikilinks / tags, the
//!                        LRU document registry, markdown
//!                        extensions (mermaid, frontmatter,
//!                        table, folding, pandoc), spell check.
//!   - `workspace_ops`  — tabs, config, recent files, themes,
//!                        keybindings, i18n, bookmarks, app info.
//!   - `export_ops`     — HTML / PDF / Word export, workspace
//!                        search, asset (image) upload.
//!
//! This file holds only:
//!   - The module declarations above.
//!   - The asset-serving handler for `mt://localhost` URLs.
//!   - The `main()` function that wires the wry WebView and
//!     the tao event loop together.
//!   - The platform-specific native menu setup (macOS only).

mod dispatch;
mod editor_ops;
mod export_ops;
mod file_ops;
mod state;
mod workspace_ops;

use state::{lock_or_recover, AppEvent, AppState, IpcMessage};
use std::sync::Arc;
use std::sync::Mutex;
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder};
use tao::window::WindowBuilder;
use wry::http::{header::CONTENT_TYPE, Response, StatusCode};
use wry::WebViewBuilder;

// ============================== Asset serving ==============================

/// Serve a file from the embedded Vite build. Used for
/// `mt://localhost/...` requests from the WebView. Falls
/// through to `index.html` for SPA routes so deep links
/// like `mt://localhost/some/note` work after a reload.
fn serve_asset(path: &str) -> Response<Vec<u8>> {
    let path = path.trim_start_matches('/');

    if let Some(file) = state::Assets::get(path) {
        let mime = file.metadata.mimetype();
        return Response::builder()
            .header(CONTENT_TYPE, mime)
            .body(file.data.to_vec())
            .unwrap();
    }

    // SPA fallback
    if let Some(file) = state::Assets::get("index.html") {
        let mime = file.metadata.mimetype();
        return Response::builder()
            .header(CONTENT_TYPE, mime)
            .body(file.data.to_vec())
            .unwrap();
    }

    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .body(b"404 Not Found".to_vec())
        .unwrap()
}

// ============================== Main ==============================

fn main() {
    let event_loop = EventLoopBuilder::<AppEvent>::with_user_event().build();
    let state = Arc::new(AppState::new());
    {
        let proxy = event_loop.create_proxy();
        lock_or_recover(&state.proxy).replace(proxy);
    }

    // Check if this is a child window
    let is_child = std::env::args().any(|a| a.starts_with("--child-window="));
    let _child_tab_data: Option<String> = std::env::args()
        .find(|a| a.starts_with("--child-window="))
        .map(|a| a.trim_start_matches("--child-window=").to_string());

    // Load window icon (PNG at 256x256)
    // Try multiple locations: dev mode (project root) and bundle mode (Resources/)
    fn find_icon_path() -> Option<std::path::PathBuf> {
        let dev_path = std::path::Path::new("icons/256x256.png");
        if dev_path.exists() {
            return Some(dev_path.to_path_buf());
        }
        // Try bundle mode: executable is in Contents/MacOS/, icons in Contents/Resources/icons/
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
    let window = window_builder.build(&event_loop).unwrap();

    #[cfg(target_os = "macos")]
    setup_macos_menu();

    let webview: Arc<Mutex<Option<wry::WebView>>> = Arc::new(Mutex::new(None));
    let wv_clone = webview.clone();
    let state_clone = state.clone();

    let mut builder = WebViewBuilder::new()
        .with_devtools(true)
        .with_custom_protocol("mt".into(), |_id, request| {
            let path = request.uri().path();
            serve_asset(path).map(Into::into)
        });

    let dev_mode = std::env::args().any(|a| a == "--dev");
    if dev_mode {
        builder = builder.with_url("http://localhost:5173");
    } else if is_child {
        // Child window loads the same app but in tear-off mode
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
                return;
            }
        };

        // Fast path: execute inline and deliver response immediately.
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

        // Slow path: offload to tokio thread pool. The response
        // will be delivered via EventLoopProxy → IpcResponse event.
        dispatch::dispatch_slow(msg, state_for_handler.clone());
    });

    let built = builder.build(&window).unwrap();
    *lock_or_recover(&webview) = Some(built);

    let webview_for_el = webview.clone();
    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                *control_flow = ControlFlow::Exit;
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
            // Async IPC responses arrive here from tokio worker threads.
            Event::UserEvent(AppEvent::IpcResponse { js }) => {
                if let Ok(wv) = webview_for_el.lock() {
                    if let Some(ref webview) = *wv {
                        let _ = webview.evaluate_script(&format!(
                            "window.__mt_dispatch('{js}')"
                        ));
                    }
                }
            }
            // Spell-check requests are dispatched here because
            // NSSpellChecker on macOS must run on the main
            // thread (this IS the main thread — tao
            // `event_loop.run` requires it). On other platforms
            // we fall through to the embedded English
            // dictionary, which is thread-agnostic but goes
            // through this arm anyway for path uniformity.
            Event::UserEvent(AppEvent::SpellCheckRequest { text, lang, reply }) => {
                #[cfg(target_os = "macos")]
                let result: Result<Vec<spellcheck::SpellError>, String> = {
                    let errors = spellcheck::macos::check_with_nsspellchecker(&text, &lang);
                    Ok(errors)
                };
                #[cfg(not(target_os = "macos"))]
                let result: Result<Vec<spellcheck::SpellError>, String> = {
                    // English-only fallback. CJK languages
                    // produce empty errors (see
                    // `spellcheck::check_spelling`).
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

    // App menu
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

    // Edit menu
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
