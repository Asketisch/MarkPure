use crate::state::{lock_or_recover, AppState};
use std::path::PathBuf;
// ============================== File CRUD ==============================

/// Reject paths that escape the active workspace.
///
/// P2-4 multi-root: the path is accepted if it lives under **any** of
/// the configured roots. Pre-P2-4 callers that hand us a single
/// `workspace_root` are still served by the thin
/// [`ensure_path_in_workspace_single`] wrapper.
///
/// The IPC layer is the only place with the context of *which*
/// workspace is open, so this validation lives here rather than in
/// the `fs` crate. We canonicalize both the target and the root so a
/// `../`-laden target can't smuggle out of the workspace, and we
/// tolerate non-existent paths (the caller is about to create the
/// file) by canonicalizing the deepest existing ancestor.
pub fn ensure_path_in_workspace(
    path: &std::path::Path,
    workspace_roots: &[PathBuf],
) -> std::result::Result<(), String> {
    if workspace_roots.is_empty() {
        return Err(
            "no workspace folder is open — use File ▸ Open Workspace Folder to choose one"
                .into(),
        );
    }
    let canonical_target = canonicalize_for_validation(path)?;
    for root in workspace_roots {
        // A non-existent root is silently skipped — the user might
        // have an unmounted external drive that will come back later.
        let canonical_root = match root.canonicalize() {
            Ok(p) => p,
            Err(_) => continue,
        };
        if canonical_target.starts_with(&canonical_root) {
            return Ok(());
        }
    }
    Err(format!(
        "path '{}' is outside any configured workspace root",
        path.display()
    ))
}

/// Thin single-root wrapper used by pre-P2-4 call sites that hand us
/// one root path. New callers should prefer
/// [`ensure_path_in_workspace`] with a slice.
pub fn ensure_path_in_workspace_single(
    path: &std::path::Path,
    workspace_root: &std::path::Path,
) -> std::result::Result<(), String> {
    ensure_path_in_workspace(path, &[workspace_root.to_path_buf()])
}

/// Best-effort canonicalization that survives a non-existent target:
/// walk up to the deepest existing ancestor, canonicalize from there,
/// and only fall back to lexical normalization when nothing on the
/// path exists.
fn canonicalize_for_validation(path: &std::path::Path) -> std::result::Result<PathBuf, String> {
    let mut p = path.to_path_buf();
    loop {
        if p.exists() {
            return p
                .canonicalize()
                .map_err(|e| format!("path not accessible: {}", e));
        }
        match p.parent() {
            Some(parent) if !parent.as_os_str().is_empty() => p = parent.to_path_buf(),
            _ => {
                // Lexical normalization — strips `.` and `..` even
                // when the path itself doesn't exist.
                return Ok(path.canonicalize().unwrap_or_else(|_| {
                    let mut normalized = PathBuf::new();
                    for comp in path.components() {
                        match comp {
                            std::path::Component::ParentDir => {
                                normalized.pop();
                            }
                            std::path::Component::CurDir => {}
                            other => normalized.push(other),
                        }
                    }
                    normalized
                }));
            }
        }
    }
}

/// Active workspace root for path-validation purposes. P2-4: returns
/// *all* configured roots (in declaration order) so the multi-root
/// guard can check membership against the full set. Empty list means
/// "no workspace open" — destructive handlers refuse to run.
pub fn active_workspace_roots(state: &AppState) -> Vec<PathBuf> {
    let cfg = lock_or_recover(&state.config);
    cfg.workspace_roots()
        .iter()
        .map(|r| PathBuf::from(&r.path))
        .collect()
}

/// Legacy single-root accessor used by older call sites that still
/// expect one path back. Returns the active root's path, or an error
/// if no root is active.
pub fn active_workspace_root(state: &AppState) -> std::result::Result<PathBuf, String> {
    let cfg = lock_or_recover(&state.config);
    cfg.get_active_workspace_root()
        .map(|r| PathBuf::from(&r.path))
        .ok_or_else(|| "no active workspace — open a workspace first".to_string())
}
