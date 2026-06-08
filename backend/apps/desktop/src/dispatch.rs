//! Central IPC dispatch.
//!
//! The single source of truth for the command name → handler
//! mapping. Each handler is defined in a topic-specific module
//! (`file_ops`, `editor_ops`, …) and re-exported here so the
//! routing table stays a one-screen function.
//!
//! Adding a new command:
//!  1. Implement `cmd_foo(params, state)` in the relevant module.
//!  2. Add the dispatch arm in `handle_command` below.
//!  3. Add a typed wrapper in `frontend/src/editor/commands.ts`.
//!
//! The fallback arm returns `Unknown command: <name>` so the
//! frontend gets a useful error instead of a silent timeout.

use super::editor_ops;
use super::export_ops;
use super::file_ops;
use super::state::{AppState, IpcMessage, IpcResponse};
use super::workspace_ops;

/// Single entry-point used by the WebView's `ipc.postMessage`
/// handler. Wraps every handler result into a uniform
/// `IpcResponse`.
pub fn handle_command(msg: &IpcMessage, state: &AppState) -> IpcResponse {
    let result: std::result::Result<serde_json::Value, String> = match msg.cmd.as_str() {
        // File dialogs
        "pick_open_file" => file_ops::cmd_pick_open_file(),
        "pick_save_file" => file_ops::cmd_pick_save_file(),
        "pick_directory" => file_ops::cmd_pick_directory(),

        // File operations
        "open_file" => file_ops::cmd_open_file(&msg.params, state),
        "save_file" => file_ops::cmd_save_file(&msg.params, state),
        "get_doc_stats" => file_ops::cmd_get_doc_stats(&msg.params),

        // Directory tree
        "get_directory_tree" => file_ops::cmd_get_directory_tree(&msg.params, state),
        "watch_directory" => file_ops::cmd_watch_directory(&msg.params, state),
        "unwatch_directory" => file_ops::cmd_unwatch_directory(state),

        // File CRUD
        "create_file" => file_ops::cmd_create_file(&msg.params, state),
        "create_directory" => file_ops::cmd_create_directory(&msg.params, state),
        "delete_file" => file_ops::cmd_delete_file(&msg.params, state),
        "rename_file" => file_ops::cmd_rename_file(&msg.params, state),
        "reveal_in_finder" => file_ops::cmd_reveal_in_finder(&msg.params),

        // Outline
        "get_outline" => editor_ops::cmd_get_outline(&msg.params),
        "get_wikilinks" => editor_ops::cmd_get_wikilinks(&msg.params),
        "get_tags" => editor_ops::cmd_get_tags(&msg.params),

        // Tabs
        "get_tabs" => workspace_ops::cmd_get_tabs(state),
        "save_tabs" => workspace_ops::cmd_save_tabs(&msg.params, state),
        "tearoff_tab" => workspace_ops::cmd_tearoff_tab(&msg.params, state),

        // Config
        "get_config" => workspace_ops::cmd_get_config(state),
        "set_config" => workspace_ops::cmd_set_config(&msg.params, state),
        "get_recent_files" => workspace_ops::cmd_get_recent_files(state),
        "clear_recent_files" => workspace_ops::cmd_clear_recent_files(state),
        "get_expanded_dirs" => workspace_ops::cmd_get_expanded_dirs(state),
        "set_expanded_dirs" => workspace_ops::cmd_set_expanded_dirs(&msg.params, state),

        // Export
        "export_html" => export_ops::cmd_export_html(&msg.params),
        "export_pdf" => export_ops::cmd_export_pdf(&msg.params),
        "export_word" => export_ops::cmd_export_word(&msg.params),

        // Search
        "search_workspace" => export_ops::cmd_search_workspace(&msg.params),

        // i18n
        "get_locale" => workspace_ops::cmd_get_locale(state),
        "set_locale" => workspace_ops::cmd_set_locale(&msg.params, state),
        "get_translations" => workspace_ops::cmd_get_translations(&msg.params),

        // Keybindings
        "get_keybindings" => workspace_ops::cmd_get_keybindings(),
        "set_keybindings" => workspace_ops::cmd_set_keybindings(&msg.params),
        "reset_keybindings" => workspace_ops::cmd_reset_keybindings(),
        "update_keybinding" => workspace_ops::cmd_update_keybinding(&msg.params),

        // Assets
        "save_pasted_image" => export_ops::cmd_save_pasted_image(&msg.params, state),
        "upload_image_remote" => export_ops::cmd_upload_image_remote(&msg.params),
        "image_to_base64" => export_ops::cmd_image_to_base64(&msg.params),
        "get_file_info" => export_ops::cmd_get_file_info(&msg.params),
        "track_file" => export_ops::cmd_track_file(&msg.params),
        "is_file_modified" => export_ops::cmd_is_file_modified(&msg.params),

        // Theme
        "get_themes" => workspace_ops::cmd_get_themes(),
        "import_theme" => workspace_ops::cmd_import_theme(&msg.params),
        "export_theme" => workspace_ops::cmd_export_theme(&msg.params),
        "delete_theme" => workspace_ops::cmd_delete_theme(&msg.params),
        "save_theme" => workspace_ops::cmd_save_theme(&msg.params),

        // App info
        "get_app_info" => workspace_ops::cmd_get_app_info(),

        // Spell check
        "check_spelling" => editor_ops::cmd_check_spelling(&msg.params),

        // Frontmatter
        "parse_frontmatter" => editor_ops::cmd_parse_frontmatter(&msg.params),
        "update_frontmatter_field" => editor_ops::cmd_update_frontmatter_field(&msg.params),

        // Table
        "transform_table" => editor_ops::cmd_transform_table(&msg.params),
        "align_table_column" => editor_ops::cmd_align_table_column(&msg.params),
        "table_to_csv" => editor_ops::cmd_to_csv(&msg.params),

        // Folding
        "compute_folds" => editor_ops::cmd_compute_folds(&msg.params),

        // Pandoc extensions
        "parse_task_items" => editor_ops::cmd_parse_task_items(&msg.params),

        // Bookmarks
        "get_bookmarks" => workspace_ops::cmd_get_bookmarks(),
        "add_bookmark" => workspace_ops::cmd_add_bookmark(&msg.params),
        "update_bookmark" => workspace_ops::cmd_update_bookmark(&msg.params),
        "remove_bookmark" => workspace_ops::cmd_remove_bookmark(&msg.params),

        // Workspace tag index (P0-7)
        "get_workspace_tags" => workspace_ops::cmd_get_workspace_tags(&msg.params),

        // Backlinks (P0-6)
        "get_backlinks" => workspace_ops::cmd_get_backlinks(&msg.params),

        // Per-workspace CSS (P1-7)
        "load_workspace_styles" => workspace_ops::cmd_load_workspace_styles(&msg.params),

        // Snippets (P2-5)
        "list_snippets" => workspace_ops::cmd_list_snippets(),

        // Document registry (Rust-owned text buffer)
        "doc_open" => editor_ops::cmd_doc_open(&msg.params, state),
        "doc_close" => editor_ops::cmd_doc_close(&msg.params, state),
        "doc_set_content" => editor_ops::cmd_doc_set_content(&msg.params, state),
        "doc_get_stats" => editor_ops::cmd_doc_get_stats(&msg.params, state),
        "doc_search" => editor_ops::cmd_doc_search(&msg.params, state),

        // File drop handling
        "open_dropped_files" => file_ops::cmd_open_dropped_files(&msg.params, state),

        _ => Err(format!("Unknown command: {}", msg.cmd)),
    };

    match result {
        Ok(v) => IpcResponse { id: msg.id, result: Some(v), error: None },
        Err(e) => IpcResponse { id: msg.id, result: None, error: Some(e) },
    }
}
