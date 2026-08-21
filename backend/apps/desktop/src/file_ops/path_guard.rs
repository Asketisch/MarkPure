use crate::state::{lock_or_recover, AppState};
use std::path::PathBuf;
// ============================== 文件 CRUD ==============================

/// 拒绝逃逸出当前工作区的路径。
///
/// 多根目录：只要路径位于**任一**已配置根目录之下即被接受。
/// 传入单个 `workspace_root` 的旧调用方仍由薄封装
/// [`ensure_path_in_workspace_single`] 提供服务。
///
/// 只有 IPC 层知道当前打开的是*哪个*工作区，所以该校验放在这里而
/// 不是 `fs` crate 中。我们对目标和根目录都做规范化，防止带 `../`
/// 的目标路径偷溜出工作区；同时容忍不存在的路径（调用方正要创建
/// 该文件）——通过规范化最深的已存在祖先目录来实现。
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
        // 不存在的根目录被静默跳过——用户可能有未挂载的外部磁盘，
        // 稍后它还会回来。
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

/// 供旧调用点使用的单根目录薄封装，这些调用点传入一个根路径。
/// 新调用方应优先使用传入切片的 [`ensure_path_in_workspace`]。
#[allow(dead_code)]
pub fn ensure_path_in_workspace_single(
    path: &std::path::Path,
    workspace_root: &std::path::Path,
) -> std::result::Result<(), String> {
    ensure_path_in_workspace(path, &[workspace_root.to_path_buf()])
}

/// 尽力而为的规范化，能容忍目标不存在：逐级上溯到最深的已存在
/// 祖先目录，从那里开始规范化；仅当路径上什么都不存在时才回退到
/// 词法层面的规范化。
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
                // 词法规范化——即使路径本身不存在也去除 `.` 和 `..`。
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

/// 供路径校验使用的活动工作区根目录。多根目录：返回*全部*已配置
/// 根目录（按声明顺序），让多根校验可以检查路径是否属于整个集合。
/// 空列表表示「没有打开的工作区」——破坏性处理器会拒绝运行。
pub fn active_workspace_roots(state: &AppState) -> Vec<PathBuf> {
    let cfg = lock_or_recover(&state.config);
    cfg.workspace_roots()
        .iter()
        .map(|r| PathBuf::from(&r.path))
        .collect()
}

/// 供仍期望返回单个路径的旧调用点使用的单根目录访问器。
/// 返回活动根目录的路径；若无活动根目录则返回错误。
#[allow(dead_code)]
pub fn active_workspace_root(state: &AppState) -> std::result::Result<PathBuf, String> {
    let cfg = lock_or_recover(&state.config);
    cfg.get_active_workspace_root()
        .map(|r| PathBuf::from(&r.path))
        .ok_or_else(|| "no active workspace — open a workspace first".to_string())
}
