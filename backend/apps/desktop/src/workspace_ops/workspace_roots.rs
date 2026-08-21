use crate::state::{lock_or_recover, AppState};
use crate::editor_ops::doc_registry::gc_docs_outside_root;
// ============================== 多根目录工作区 ==============================
//
// 五个拥有多根目录工作区状态的 IPC 命令。它们都是快速命令
//（仅变更配置，无 I/O），因此位于内联分发表中；繁重工作
//（文件树、监听、搜索）由 `file_ops` / `export_ops` 处理，
// 并以这些命令分发的工作区 id 为键。

/// `add_workspace_root { path }` → 返回新建的 [`WorkspaceRoot`]
/// （路径为空或重复时返回错误）。持久化配置，且若这是首个根目录
/// 则更新活动 id。
pub fn cmd_add_workspace_root(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let path = params["path"]
        .as_str()
        .ok_or("Missing 'path' parameter")?;
    // 在锁内变更，然后在调用 `state.save_config()` *之前*释放——
    // 后者会重新加锁 `state.config` 以读取其序列化的快照，而
    // `std::sync::Mutex` 不可重入，若第二次加锁时守卫仍存活，
    // 本线程将自锁死。`config` 的花括号作用域确保守卫在此释放。
    let root = {
        let mut config = lock_or_recover(&state.config);
        config.add_workspace_root(path)?
    };
    state.save_config();
    serde_json::to_value(&root).map_err(|e| e.to_string())
}

/// `remove_workspace_root { root_id }` → 移除该根目录及其展开目录，
/// 并将 `active_workspace_root_id` 重新指向下一个剩余根目录（或 `None`）。
pub fn cmd_remove_workspace_root(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let root_id = params["root_id"]
        .as_str()
        .ok_or("Missing 'root_id' parameter")?;
    // 在 save_config 之前释放配置锁（死锁原因见
    // `cmd_add_workspace_root`）。
    {
        let mut config = lock_or_recover(&state.config);
        if !config.remove_workspace_root(root_id) {
            return Err(format!("root not found: {root_id}"));
        }
    }
    state.save_config();
    Ok(serde_json::Value::Null)
}

/// `list_workspace_roots` →
///   `{ roots: [{id, path, name, added_at, exists}], active_id }`。
///
/// 每个根目录携带实时的 `exists` 布尔值（在 IPC 时通过
/// `WorkspaceRoot::exists()` 计算）。渲染器据此为未挂载的外部
/// 驱动器 / 被移动的文件夹显示「⚠️ 缺失」徽标。我们*不*从配置中
/// 移除缺失的根目录——用户可能只是拔掉了驱动器，我们不愿静默
/// 丢失其工作区布局。移除操作需显式执行：通过
/// `remove_workspace_root`（胶囊上的 ×）或新的
/// `cmd_remove_missing_workspace_roots` 批量命令。
pub fn cmd_list_workspace_roots(
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let config = lock_or_recover(&state.config);
    let roots: Vec<serde_json::Value> = config
        .workspace_roots()
        .iter()
        .map(|r| {
            serde_json::json!({
                "id": r.id,
                "path": r.path,
                "name": r.name,
                "added_at": r.added_at,
                "exists": r.exists(),
            })
        })
        .collect();
    Ok(serde_json::json!({
        "roots": roots,
        "active_id": config.active_workspace_root_id,
    }))
}

/// `remove_missing_workspace_roots` → 移除所有 `path` 在磁盘上
/// 已不存在的根目录。返回被移除的 id 列表，供渲染器更新其
/// 标签页关闭列表。请谨慎使用——这是「是的，我知道我的驱动器
/// 没了」的显式操作。
pub fn cmd_remove_missing_workspace_roots(
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let removed: Vec<String> = {
        let config = lock_or_recover(&state.config);
        let mut removed: Vec<String> = Vec::new();
        for r in config.workspace_roots() {
            if !r.exists() {
                removed.push(r.id.clone());
            }
        }
        // 为执行移除操作重新获取可变锁。
        drop(config);
        let mut config = lock_or_recover(&state.config);
        for id in &removed {
            config.remove_workspace_root(id);
        }
        removed
    };
    if !removed.is_empty() {
        state.save_config();
    }
    Ok(serde_json::json!({ "removed_root_ids": removed }))
}

/// `set_active_workspace_root { root_id }` → 切换活动根目录。
/// 成功时渲染器必须拆除旧文件树请求，并为新根目录重建。
///
/// 同时丢弃所有不属于新活动根目录的内存中文档（根目录切换时
/// 的 LRU 回收）。返回载荷中的 `evicted_doc_ids` 让渲染器同步
/// 关闭对应标签页——渲染器是标签页状态的唯一事实来源，因此
/// Rust 只能告诉它要丢弃哪些。
pub fn cmd_set_active_workspace_root(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let root_id = params["root_id"]
        .as_str()
        .ok_or("Missing 'root_id' parameter")?;
    {
        let mut config = lock_or_recover(&state.config);
        if !config.set_active_workspace_root(root_id) {
            return Err(format!("root not found: {root_id}"));
        }
    }
    state.save_config();
    let evicted = gc_docs_outside_root(state, root_id);
    Ok(serde_json::json!({ "evicted_doc_ids": evicted }))
}

/// `get_expanded_dirs` 的多根目录版本。
///
/// 接受 `root_id`（首选）或旧式隐式形式（无 `root_id`，回退到
/// 活动根目录）。为请求的根目录返回 `{ expanded_dirs: [String] }`。
pub fn cmd_get_expanded_dirs_v2(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let config = lock_or_recover(&state.config);
    let root_id = match params["root_id"].as_str() {
        Some(id) if !id.is_empty() => id.to_string(),
        _ => config
            .active_workspace_root_id
            .clone()
            .ok_or("no active workspace and no root_id supplied")?,
    };
    let dirs = config.get_expanded_dirs_for(&root_id);
    Ok(serde_json::json!({ "expanded_dirs": dirs }))
}

/// `set_expanded_dirs` 的多根目录版本。
///
/// 接受 `{ root_id?, expanded_dirs: [String] }`。为向前兼容，渲染器
/// 必须传 `root_id`——隐式回退仅供旧式单根目录调用方使用。
pub fn cmd_set_expanded_dirs_v2(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let dirs: Vec<String> = params["expanded_dirs"]
        .as_array()
        .ok_or("Missing 'expanded_dirs'")?
        .iter()
        .filter_map(|v| v.as_str().map(String::from))
        .collect();
    // 在配置锁下解析 root_id 并执行变更，然后在
    // `state.save_config()` 重新加锁同一 `std::sync::Mutex` 之前
    // 释放（见 cmd_add_workspace_root）。
    {
        let mut config = lock_or_recover(&state.config);
        let root_id = match params["root_id"].as_str() {
            Some(id) if !id.is_empty() => id.to_string(),
            _ => config
                .active_workspace_root_id
                .clone()
                .ok_or("no active workspace and no root_id supplied")?,
        };
        config.set_expanded_dirs_for(&root_id, dirs);
    }
    state.save_config();
    Ok(serde_json::Value::Null)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    /// 用墙钟看门狗对命令进行计时。若调用在 `state.config` 互斥锁上
    /// 死锁（本次修复的 bug），工作线程将永不返回，测试以
    /// 「did not return within」消息 panic——这正是我们想要的，
    /// 因为旧行为是无诊断的静默 UI 冻结。
    ///
    /// 我们通过在整个测试期间覆盖 `$HOME` 把 `app_config_dir()`
    /// 指向临时目录，从而绝不触碰用户的真实配置。
    #[test]
    fn add_workspace_root_does_not_deadlock_on_config_lock() {
        let tmp = std::env::temp_dir().join(format!(
            "markpure-test-{}-{}",
            std::process::id(),
            Instant::now().elapsed().as_nanos()
        ));
        std::fs::create_dir_all(&tmp).expect("create temp dir");

        // 保存真实的 HOME，以便恢复。
        let saved_home = std::env::var("HOME").ok();

        // 此测试执行时是单线程测试进程，没有其他线程观察 $HOME。
        // std::env::set_var 对单线程测试执行是安全的。
        std::env::set_var("HOME", &tmp);
        // Windows 上 APPDATA 优先——清掉它。
        std::env::remove_var("APPDATA");
        std::env::remove_var("XDG_CONFIG_HOME");

        let result = std::panic::catch_unwind(|| {
            // 基于临时配置目录构建 AppState。
            let state = AppState::new();
            // 添加一个用户几乎肯定存在的真实路径。
            let params = serde_json::json!({ "path": "/tmp" });
            let t0 = Instant::now();
            let res = cmd_add_workspace_root(&params, &state);
            let elapsed = t0.elapsed();
            (res, elapsed)
        });

        // 即使 panic 也恢复环境变量。
        if let Some(h) = saved_home {
            std::env::set_var("HOME", h);
        } else {
            std::env::remove_var("HOME");
        }
        // 尽力清理。
        let _ = std::fs::remove_dir_all(&tmp);

        let (res, elapsed) = result.expect("test panicked");
        // 死锁的处理程序会使测试无限挂起；成功往返 5 秒绰绰有余。
        assert!(
            elapsed < Duration::from_secs(5),
            "cmd_add_workspace_root took {elapsed:?} — likely self-deadlocked on state.config mutex"
        );
        // 它必须成功（或失败于领域错误，而非与锁相关）。
        // "/tmp" 在每个 Unix 及几乎每台 macOS 开发机上都是真实目录，
        // 因此成功是预期结果。
        let value = res.expect("cmd_add_workspace_root returned Err");
        // 返回的 JSON 必须携带新根目录的 id、name 和规范路径。
        assert!(value.get("id").is_some(), "missing id in {value:?}");
        assert_eq!(value["name"], "tmp");
        // macOS 上路径会被规范化为 /private/tmp；Linux 上保持 /tmp。
        // 只检查后缀。
        let p = value["path"].as_str().expect("path is string");
        assert!(p.ends_with("/tmp"), "unexpected path {p}");
    }

    /// `cmd_remove_workspace_root` 的配套测试——相同的死锁模式，
    /// 相同的修复形态。
    #[test]
    fn remove_workspace_root_does_not_deadlock_on_config_lock() {
        let tmp = std::env::temp_dir().join(format!(
            "markpure-test-rm-{}-{}",
            std::process::id(),
            Instant::now().elapsed().as_nanos()
        ));
        std::fs::create_dir_all(&tmp).expect("create temp dir");

        let saved_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", &tmp);
        std::env::remove_var("APPDATA");
        std::env::remove_var("XDG_CONFIG_HOME");

        let result = std::panic::catch_unwind(|| {
            let state = AppState::new();
            let add_params = serde_json::json!({ "path": "/tmp" });
            let add_res = cmd_add_workspace_root(&add_params, &state)
                .expect("add should succeed");
            let root_id = add_res["id"].as_str().expect("id present").to_string();
            let rm_params = serde_json::json!({ "root_id": root_id });
            let t0 = Instant::now();
            let res = cmd_remove_workspace_root(&rm_params, &state);
            let elapsed = t0.elapsed();
            (res, elapsed)
        });

        if let Some(h) = saved_home {
            std::env::set_var("HOME", h);
        } else {
            std::env::remove_var("HOME");
        }
        let _ = std::fs::remove_dir_all(&tmp);

        let (res, elapsed) = result.expect("test panicked");
        assert!(
            elapsed < Duration::from_secs(5),
            "cmd_remove_workspace_root took {elapsed:?} — likely self-deadlocked"
        );
        res.expect("cmd_remove_workspace_root returned Err");
    }

    // 当测试模块未引用下方全部辅助函数编译时，抑制未使用导入警告。
    #[allow(dead_code)]
    fn _silence_unused(_: &Arc<Mutex<PathBuf>>) {}
}
