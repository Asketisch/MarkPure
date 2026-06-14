//! Central IPC dispatch.
//!
//! The single source of truth for the command name → handler
//! mapping. Each handler is defined in a topic-specific module
//! (`file_ops`, `editor_ops`, …) and re-exported here so the
//! routing table stays a one-screen function.
//!
//! Commands are split into two categories:
//!
//!  - **Fast** (inline on the wry IPC thread): config reads/writes,
//!    document registry mutations, outline parsing, etc. These
//!    complete in microseconds and never block.
//!
//!  - **Slow** (offloaded to the tokio thread pool): file I/O,
//!    spell checking, directory walks, exports, workspace scans.
//!    These can take milliseconds to seconds; running them inline
//!    would block the single wry IPC thread and freeze the UI.
//!
//! Adding a new command:
//!  1. Implement `cmd_foo(params, state)` in the relevant module.
//!  2. Add the dispatch arm in `handle_command` (fast) or
//!     `dispatch_slow` (slow) below.
//!  3. Add a typed wrapper in `frontend/src/editor/commands.ts`.

use super::editor_ops;
use super::export_ops;
use super::file_ops;
use super::state::{AppState, IpcMessage, IpcResponse};
use super::workspace_ops;

use std::sync::Arc;

// ============================== Fast commands ==============================

/// Single entry-point used by the WebView's `ipc.postMessage`
/// handler for *fast* commands. Returns `Some(IpcResponse)` if
/// the command was handled inline, or `None` if it should be
/// dispatched asynchronously via `dispatch_slow`.
pub fn handle_command(msg: &IpcMessage, state: &AppState) -> Option<IpcResponse> {
    let result: std::result::Result<serde_json::Value, String> = match msg.cmd.as_str() {
        // File dialogs → slow (rfd blocks)
        "pick_open_file" | "pick_save_file" | "pick_directory" => return None,

        // File operations → slow (I/O)
        "open_file" | "save_file" | "get_doc_stats" => return None,

        // Directory tree → slow (walkdir)
        "get_directory_tree" => return None,

        // File watcher → slow (thread spawn)
        "watch_directory" | "unwatch_directory" => return None,

        // File CRUD → slow (I/O)
        "create_file" | "create_directory" | "delete_file" | "rename_file" => return None,

        "reveal_in_finder" => return None,

        // Outline — fast (pure computation)
        "get_outline" => editor_ops::cmd_get_outline(&msg.params),
        "get_wikilinks" => editor_ops::cmd_get_wikilinks(&msg.params),
        "get_tags" => editor_ops::cmd_get_tags(&msg.params),

        // Tabs — fast (in-memory)
        "get_tabs" => workspace_ops::cmd_get_tabs(state),
        "save_tabs" => workspace_ops::cmd_save_tabs(&msg.params, state),
        "tearoff_tab" => workspace_ops::cmd_tearoff_tab(&msg.params, state),

        // Config — fast (in-memory)
        "get_config" => workspace_ops::cmd_get_config(state),
        "set_config" => workspace_ops::cmd_set_config(&msg.params, state),
        "get_recent_files" => workspace_ops::cmd_get_recent_files(state),
        "clear_recent_files" => workspace_ops::cmd_clear_recent_files(state),
        "get_expanded_dirs" => workspace_ops::cmd_get_expanded_dirs(state),
        "set_expanded_dirs" => workspace_ops::cmd_set_expanded_dirs(&msg.params, state),

        // Export → slow (I/O + rendering)
        "export_html" | "export_pdf" | "export_word" | "export_png" => return None,

        // Search → slow (walkdir over workspace)
        "search_workspace" => return None,

        // i18n — fast (in-memory)
        "get_locale" => workspace_ops::cmd_get_locale(state),
        "set_locale" => workspace_ops::cmd_set_locale(&msg.params, state),
        "get_translations" => workspace_ops::cmd_get_translations(&msg.params),

        // Keybindings — fast (in-memory)
        "get_keybindings" => workspace_ops::cmd_get_keybindings(),
        "set_keybindings" => workspace_ops::cmd_set_keybindings(&msg.params),
        "reset_keybindings" => workspace_ops::cmd_reset_keybindings(),
        "update_keybinding" => workspace_ops::cmd_update_keybinding(&msg.params),

        // Assets → slow (I/O, network)
        "save_pasted_image" | "upload_image_remote" | "image_to_base64" | "get_file_info"
        | "track_file" | "is_file_modified" => return None,

        // Theme — fast (in-memory, except import/export which are I/O)
        "get_themes" => workspace_ops::cmd_get_themes(),
        "save_theme" => workspace_ops::cmd_save_theme(&msg.params),
        "import_theme" | "export_theme" | "delete_theme" => return None,

        // App info — fast
        "get_app_info" => workspace_ops::cmd_get_app_info(),

        // Spell check → slow (NSSpellChecker on main thread)
        "check_spelling" => return None,

        // Frontmatter — fast (pure computation)
        "parse_frontmatter" => editor_ops::cmd_parse_frontmatter(&msg.params),
        "update_frontmatter_field" => editor_ops::cmd_update_frontmatter_field(&msg.params),

        // Table — fast (pure computation)
        "transform_table" => editor_ops::cmd_transform_table(&msg.params),
        "align_table_column" => editor_ops::cmd_align_table_column(&msg.params),
        "table_to_csv" => editor_ops::cmd_to_csv(&msg.params),

        // Folding — fast (pure computation)
        "compute_folds" => editor_ops::cmd_compute_folds(&msg.params),

        // Pandoc extensions — fast (pure computation)
        "parse_task_items" => editor_ops::cmd_parse_task_items(&msg.params),

        // Bookmarks — fast (in-memory + JSON)
        "get_bookmarks" => workspace_ops::cmd_get_bookmarks(),
        "add_bookmark" => workspace_ops::cmd_add_bookmark(&msg.params),
        "update_bookmark" => workspace_ops::cmd_update_bookmark(&msg.params),
        "remove_bookmark" => workspace_ops::cmd_remove_bookmark(&msg.params),

        // Multi-root workspace (P2-4) — slow (canonicalize + save_config
        // hit the filesystem; running them inline would block the wry IPC
        // thread on slow/stalled mounts and freeze the UI).
        "add_workspace_root" | "remove_workspace_root" | "list_workspace_roots"
        | "set_active_workspace_root" | "remove_missing_workspace_roots" => return None,
        // Multi-root variants of the legacy expanded-dirs IPC.
        // The old names keep working for now; new code should use _v2.
        "get_expanded_dirs_v2" => workspace_ops::cmd_get_expanded_dirs_v2(&msg.params, state),
        "set_expanded_dirs_v2" => workspace_ops::cmd_set_expanded_dirs_v2(&msg.params, state),

        // Workspace tag index → slow (WalkDir over workspace)
        "get_workspace_tags" => return None,

        // Backlinks → slow (WalkDir over workspace)
        "get_backlinks" => return None,

        // Per-workspace CSS → slow (I/O)
        "load_workspace_styles" => return None,

        // Snippets — fast (in-memory)
        "list_snippets" => workspace_ops::cmd_list_snippets(),

        // Document registry — fast (in-memory rope ops)
        "doc_open" => editor_ops::cmd_doc_open(&msg.params, state),
        "doc_close" => editor_ops::cmd_doc_close(&msg.params, state),
        "doc_set_content" => editor_ops::cmd_doc_set_content(&msg.params, state),
        "doc_get_stats" => editor_ops::cmd_doc_get_stats(&msg.params, state),
        "doc_search" => editor_ops::cmd_doc_search(&msg.params, state),

        // File drop handling → slow (I/O)
        "open_dropped_files" => return None,

        _ => Err(format!("Unknown command: {}", msg.cmd)),
    };

    Some(match result {
        Ok(v) => IpcResponse { id: msg.id, result: Some(v), error: None },
        Err(e) => IpcResponse { id: msg.id, result: None, error: Some(e) },
    })
}

// ============================== Slow commands ==============================

/// Dispatch a slow command on a dedicated OS thread. The result
/// is serialized and sent back via `EventLoopProxy` as an
/// `AppEvent::IpcResponse`, which the tao event loop then
/// delivers to the WebView via `evaluate_script`.
///
/// We use `std::thread::spawn` (not `tokio::spawn`) because
/// many handlers internally call `state.rt().block_on(...)`,
/// which panics if called from within a tokio async context.
pub fn dispatch_slow(msg: IpcMessage, state: Arc<AppState>) {
    let proxy = {
        let guard = super::state::lock_or_recover(&state.proxy);
        match guard.as_ref() {
            Some(p) => p.clone(),
            None => {
                eprintln!("[dispatch] no event loop proxy, dropping command {}", msg.cmd);
                return;
            }
        }
    };

    let state_for_thread = state.clone();
    std::thread::spawn(move || {
        let result = run_slow_command(&msg, &state_for_thread);
        let response = match result {
            Ok(v) => IpcResponse { id: msg.id, result: Some(v), error: None },
            Err(e) => IpcResponse { id: msg.id, result: None, error: Some(e) },
        };
        let js = match serde_json::to_string(&response) {
            Ok(s) => super::state::escape_for_js(&s),
            Err(e) => {
                eprintln!("[dispatch] failed to serialize response: {e}");
                return;
            }
        };
        if let Err(e) = proxy.send_event(super::state::AppEvent::IpcResponse { js }) {
            eprintln!("[dispatch] failed to send IPC response: {e}");
        }
    });
}

/// Execute a slow command synchronously. Runs on a dedicated OS
/// thread (NOT in a tokio context), so `state.rt().block_on()`
/// is safe.
fn run_slow_command(
    msg: &IpcMessage,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    match msg.cmd.as_str() {
        // File dialogs (rfd blocks the calling thread — safe on tokio)
        "pick_open_file" => file_ops::cmd_pick_open_file(),
        "pick_save_file" => file_ops::cmd_pick_save_file(),
        "pick_directory" => file_ops::cmd_pick_directory(),

        // File I/O
        "open_file" => file_ops::cmd_open_file(&msg.params, state),
        "save_file" => file_ops::cmd_save_file(&msg.params, state),
        "get_doc_stats" => file_ops::cmd_get_doc_stats(&msg.params),

        // Directory tree
        "get_directory_tree" => file_ops::cmd_get_directory_tree(&msg.params, state),

        // File watcher
        "watch_directory" => file_ops::cmd_watch_directory(&msg.params, state),
        "unwatch_directory" => file_ops::cmd_unwatch_directory(&msg.params, state),

        // File CRUD
        "create_file" => file_ops::cmd_create_file(&msg.params, state),
        "create_directory" => file_ops::cmd_create_directory(&msg.params, state),
        "delete_file" => file_ops::cmd_delete_file(&msg.params, state),
        "rename_file" => file_ops::cmd_rename_file(&msg.params, state),
        "reveal_in_finder" => file_ops::cmd_reveal_in_finder(&msg.params),

        // Export
        "export_html" => export_ops::cmd_export_html(&msg.params),
        "export_pdf" => export_ops::cmd_export_pdf(&msg.params),
        "export_word" => export_ops::cmd_export_word(&msg.params),
        // P1-8: PNG export. The frontend has already rasterised
        // the document via `html-to-image`; we just persist it.
        "export_png" => export_ops::cmd_export_png(&msg.params),

        // Workspace search
        "search_workspace" => export_ops::cmd_search_workspace(&msg.params),

        // Assets
        "save_pasted_image" => export_ops::cmd_save_pasted_image(&msg.params, state),
        "upload_image_remote" => export_ops::cmd_upload_image_remote(&msg.params),
        "image_to_base64" => export_ops::cmd_image_to_base64(&msg.params),
        "get_file_info" => export_ops::cmd_get_file_info(&msg.params),
        "track_file" => export_ops::cmd_track_file(&msg.params),
        "is_file_modified" => export_ops::cmd_is_file_modified(&msg.params),

        // Theme I/O
        "import_theme" => workspace_ops::cmd_import_theme(&msg.params),
        "export_theme" => workspace_ops::cmd_export_theme(&msg.params),
        "delete_theme" => workspace_ops::cmd_delete_theme(&msg.params),

        // Spell check (still routes through main thread via SyncSender)
        "check_spelling" => editor_ops::cmd_check_spelling(&msg.params, state),

        // Workspace scans
        "get_workspace_tags" => workspace_ops::cmd_get_workspace_tags(&msg.params),
        "get_backlinks" => workspace_ops::cmd_get_backlinks(&msg.params),

        // Per-workspace CSS
        "load_workspace_styles" => workspace_ops::cmd_load_workspace_styles(&msg.params),

        // File drop
        "open_dropped_files" => file_ops::cmd_open_dropped_files(&msg.params, state),

        // Multi-root workspace (P2-4) — moved off the fast path
        // because `cmd_add_workspace_root` /
        // `cmd_set_active_workspace_root` /
        // `cmd_remove_missing_workspace_roots` perform
        // `std::fs::canonicalize` and `is_dir()` checks; on a
        // slow or stalled mount those can block for minutes
        // and freeze the wry IPC thread.
        "add_workspace_root" => workspace_ops::cmd_add_workspace_root(&msg.params, state),
        "remove_workspace_root" => workspace_ops::cmd_remove_workspace_root(&msg.params, state),
        "list_workspace_roots" => workspace_ops::cmd_list_workspace_roots(state),
        "set_active_workspace_root" => workspace_ops::cmd_set_active_workspace_root(&msg.params, state),
        "remove_missing_workspace_roots" => workspace_ops::cmd_remove_missing_workspace_roots(state),

        _ => Err(format!("Unknown slow command: {}", msg.cmd)),
    }
}
