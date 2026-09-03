use crate::state::{lock_or_recover, AppState};
use mt_core::AppConfig;
// ============================== 配置 ==============================

/// 共享辅助函数：把当前 `AppConfig` 序列化为设置界面消费的 JSON 结构。
/// 集中在一处，使 `cmd_get_config`（运行时读取）与
/// `cmd_export_config`（完整备份）保持同步——导出必须包含设置面板
/// 可编辑的每个字段，否则恢复时会丢失用户的个性化配置。
fn config_to_json(config: &AppConfig) -> serde_json::Value {
    let theme_class = match config.theme {
        mt_core::ThemeId::Light => "",
        mt_core::ThemeId::Dark => "theme-dark",
        mt_core::ThemeId::OneDark => "theme-one-dark",
        mt_core::ThemeId::Graphite => "theme-graphite",
        mt_core::ThemeId::Ulysses => "theme-ulysses",
        mt_core::ThemeId::MaterialDark => "theme-material-dark",
        mt_core::ThemeId::BlueTopaz => "theme-blue-topaz",
    };
    serde_json::json!({
        "theme": theme_class,
        "language": config.language,
        "last_workspace": config.last_workspace,
        "editor": {
            "font_family": config.editor.font_family,
            "font_size": config.editor.font_size,
            "tab_size": config.editor.tab_size,
            "soft_tabs": config.editor.soft_tabs,
            "line_numbers": config.editor.line_numbers,
            "word_wrap": config.editor.word_wrap,
            "auto_save_interval": config.editor.auto_save_interval,
            "spellcheck_enabled": config.editor.spellcheck_enabled,
            "spellcheck_language": config.editor.spellcheck_language,
            // 保存时标色开关。显示在「设置」中，并经导出/导入管道往返。
            "lint_on_save": config.editor.lint_on_save,
        },
        // 全局 Vim 模式开关。持久化为顶层的 AppConfig 字段；
        // 导出的备份必须包含它，恢复时才能还原用户的 Vim 设置。
        "vim_mode": config.vim_mode,
        // 字数目标（顶层 AppConfig 字段，不在 editor 内部——
        // 字数目标是写作流程偏好，而非代码编辑器旋钮）。前端
        // 从 get_config 的顶层读取它，导入路径也按顶层恢复。
        "word_count_goal": config.word_count_goal,
    })
}

pub fn cmd_get_config(state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let config = lock_or_recover(&state.config);
    Ok(config_to_json(&config))
}

pub fn cmd_get_recent_files(state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let config = lock_or_recover(&state.config);
    let arr: Vec<&String> = config.get_recent_files().iter().collect();
    Ok(serde_json::Value::Array(
        arr.into_iter()
            .map(|s| serde_json::Value::String(s.clone()))
            .collect(),
    ))
}

pub fn cmd_clear_recent_files(state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let mut config = lock_or_recover(&state.config);
    config.clear_recent_files();
    drop(config);
    state.save_config();
    Ok(serde_json::Value::Null)
}

pub fn cmd_set_config(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let mut config = lock_or_recover(&state.config);

    // 主题（同时接受 CSS 类名与人类可读标签）
    if let Some(theme_str) = params.get("theme").and_then(|v| v.as_str()) {
        match theme_str {
            "Cadmium Light" | "Light" | "" => config.theme = mt_core::ThemeId::Light,
            "Dark" | "theme-dark" => config.theme = mt_core::ThemeId::Dark,
            "One Dark" | "theme-one-dark" => config.theme = mt_core::ThemeId::OneDark,
            "Graphite" | "theme-graphite" => config.theme = mt_core::ThemeId::Graphite,
            "Ulysses" | "theme-ulysses" => config.theme = mt_core::ThemeId::Ulysses,
            "Material Dark" | "theme-material-dark" => {
                config.theme = mt_core::ThemeId::MaterialDark
            }
            "Blue Topaz" | "theme-blue-topaz" => config.theme = mt_core::ThemeId::BlueTopaz,
            _ => {}
        }
    }

    if let Some(language) = params.get("language").and_then(|v| v.as_str()) {
        config.set_language(Some(language.to_string()));
    }

    if let Some(workspace) = params.get("last_workspace") {
        // 向后兼容 IPC：旧版客户端仍发送 `last_workspace`。
        // 已废弃的 setter 汇入下次加载时运行的同一迁移路径。
        #[allow(deprecated)]
        config.set_last_workspace(workspace.as_str().map(|s| s.to_string()));
    }

    // 全局 Vim 模式开关（前端在保存配置时经同一条 set_config 管道
    // 持久化它；缺失该分支时开关会在重启后丢失）。
    if let Some(vim) = params.get("vim_mode").and_then(|v| v.as_bool()) {
        config.vim_mode = vim;
    }

    if let Some(editor) = params.get("editor") {
        if let Some(v) = editor.get("font_family").and_then(|v| v.as_str()) {
            config.editor.font_family = v.to_string();
        }
        if let Some(v) = editor.get("font_size").and_then(|v| v.as_u64()) {
            config.editor.font_size = v as u16;
        }
        if let Some(v) = editor.get("tab_size").and_then(|v| v.as_u64()) {
            config.editor.tab_size = v as u8;
        }
        if let Some(v) = editor.get("soft_tabs").and_then(|v| v.as_bool()) {
            config.editor.soft_tabs = v;
        }
        if let Some(v) = editor.get("line_numbers").and_then(|v| v.as_bool()) {
            config.editor.line_numbers = v;
        }
        if let Some(v) = editor.get("word_wrap").and_then(|v| v.as_bool()) {
            config.editor.word_wrap = v;
        }
        // `lint_on_save` 开关：自动 Markdown 清理。经同一 `editor.*`
        // 命名空间持久化，使设置界面可通过现有 `get_config` /
        // `set_config` 管道读写它。
        if let Some(v) = editor.get("lint_on_save").and_then(|v| v.as_bool()) {
            config.editor.lint_on_save = v;
        }
    }

    // 字数目标是顶层 AppConfig 字段（不在 `editor.*` 下——它是
    // 写作流程偏好，而非代码编辑器旋钮）。`0` 表示在状态栏禁用该胶囊。
    // 注意：外层 `config` 守卫已持有互斥锁，这里直接赋值——
    // 再次 lock 同一把锁会自死锁。
    if let Some(goal) = params.get("word_count_goal").and_then(|v| v.as_u64()) {
        config.word_count_goal = goal as u32;
    }

    drop(config);
    state.save_config();
    Ok(serde_json::Value::Null)
}

pub fn cmd_get_expanded_dirs(state: &AppState) -> std::result::Result<serde_json::Value, String> {
    let config = lock_or_recover(&state.config);
    Ok(serde_json::json!({ "expanded_dirs": config.get_expanded_dirs() }))
}

pub fn cmd_set_expanded_dirs(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let mut config = lock_or_recover(&state.config);
    if let Some(dirs) = params.get("expanded_dirs").and_then(|v| v.as_array()) {
        let expanded: Vec<String> = dirs
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
        // 向后兼容 IPC：旧版客户端发送扁平 `expanded_dirs` 列表。
        // 已废弃的 setter 把这些条目归入活动根目录。
        #[allow(deprecated)]
        config.set_expanded_dirs(expanded);
    }
    drop(config);
    state.save_config();
    Ok(serde_json::Value::Null)
}

// ============================== 配置导出 / 导入 ==============================
//
// 「导出偏好设置」 / 「导入偏好设置」——用单个 JSON 文件捕获每个
// 用户可调设置（主题、编辑器偏好、快捷键、自定义主题），用于备份 /
// 迁移 / 同步。Rust 端遍历实时的 `AppConfig` + 快捷键文件 + 自定义
// 主题目录，产出自描述的载荷；宿主端（App.svelte）把这些 IPC 接到
// 设置按钮上，并提供文件选择保存对话框。

/// 构建完整导出载荷。集中在一处，使导出与各组件 getter 不会漂移。
fn build_export_payload(state: &AppState) -> serde_json::Value {
    let config = lock_or_recover(&state.config);
    let cfg_json = config_to_json(&config);
    drop(config);

    // 快捷键——直接读取磁盘上的 JSON 文件，使导出与用户查看
    // `~/.config/markpure/keybindings.json` 时看到的一致。
    let keybindings_path = mt_core::keymap::keybindings_path();
    let keybindings: serde_json::Value = std::fs::read_to_string(&keybindings_path)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .unwrap_or_else(|| serde_json::json!([]));

    // 自定义主题——读取磁盘上的主题目录，把每个 JSON 文件内联为
    // 字符串，使导出成为单个自包含的数据块。
    let themes_dir = mt_core::theme::themes_dir();
    let mut themes: Vec<serde_json::Value> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&themes_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue
            }
            if let Ok(text) = std::fs::read_to_string(&path) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                    themes.push(json);
                }
            }
        }
    }

    serde_json::json!({
        "version": 1,
        "app": "MarkPure",
        "exported_at": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
        "config": cfg_json,
        "keybindings": keybindings,
        "themes": themes,
    })
}

pub fn cmd_export_config(
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    Ok(build_export_payload(state))
}

/// 从 `cmd_export_config` 先前产生的载荷中恢复配置。返回一个小报告，
/// 描述重新导入了多少个主题，使设置面板能闪现「✓ 已恢复」/
/// 「部分恢复」/「失败」反馈。
///
/// 我们刻意*不*在部分失败时回滚——用户得到的是尽力而为的恢复
/// 与一份报告。
pub fn cmd_import_config(
    params: &serde_json::Value,
    state: &AppState,
) -> std::result::Result<serde_json::Value, String> {
    let payload = params.get("payload").ok_or("Missing 'payload'")?;

    // 校验版本，避免将来的备份文件静默覆盖新 schema。
    let version = payload.get("version").and_then(|v| v.as_u64()).unwrap_or(0);
    if version != 1 {
        return Err(format!(
            "Unsupported config export version: {version} (expected 1)"
        ));
    }

    // 1. 恢复 AppConfig（主题、语言、编辑器偏好）。
    let mut restored_keys: Vec<String> = Vec::new();
    if let Some(cfg) = payload.get("config") {
        // 复用现有 `cmd_set_config` 路径，使所有应用内重新配置逻辑
        //（主题 CSS 类、字体 CSS 变量等）像用户逐项点击设置那样
        // 精确执行。我们重建一个只含 JSON 参数的合成 IpcMessage 外壳。
        let synthetic_params = serde_json::json!({
            "theme": cfg.get("theme"),
            "language": cfg.get("language"),
            "last_workspace": cfg.get("last_workspace"),
            "editor": cfg.get("editor"),
        });
        cmd_set_config(&synthetic_params, state)?;
        if cfg.get("theme").is_some() { restored_keys.push("theme".to_string()) }
        if cfg.get("language").is_some() { restored_keys.push("language".to_string()) }
        if cfg.get("editor").is_some() { restored_keys.push("editor.*".to_string()) }
    }

    // Vim 模式是 AppConfig 的顶层字段——直接经运行时同路径写入。
    if let Some(vim_mode) = payload.get("config").and_then(|c| c.get("vim_mode")).and_then(|v| v.as_bool()) {
        let mut config = lock_or_recover(&state.config);
        config.vim_mode = vim_mode;
        drop(config);
        state.save_config();
        restored_keys.push("vim_mode".to_string());
    }

    // 字数目标——与 vim_mode 相同的模式。旧版导出把该字段放在
    // `editor.word_count_goal` 下，两种位置都接受。
    let goal = payload
        .get("config")
        .and_then(|c| {
            c.get("word_count_goal")
                .or_else(|| c.get("editor").and_then(|e| e.get("word_count_goal")))
        })
        .and_then(|v| v.as_u64());
    if let Some(goal) = goal {
        let mut config = lock_or_recover(&state.config);
        config.word_count_goal = goal as u32;
        drop(config);
        state.save_config();
        restored_keys.push("word_count_goal".to_string());
    }

    // 2. 通过把 JSON 数组写入磁盘上的快捷键文件来恢复快捷键。
    // 我们不逐条重发 `update_keybinding` IPC，因为宿主文件是
    // 唯一事实来源——下次编辑器挂载时会从它读取。
    let mut keybindings_restored = 0usize;
    if let Some(kb) = payload.get("keybindings").and_then(|v| v.as_array()) {
        let path = mt_core::keymap::keybindings_path();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        match std::fs::write(&path, serde_json::to_string_pretty(kb).unwrap_or_else(|_| "[]".to_string())) {
            Ok(_) => keybindings_restored = kb.len(),
            Err(e) => return Err(format!("Failed to write keybindings: {e}")),
        }
        restored_keys.push("keybindings".to_string());
    }

    // 3. 恢复自定义主题——把每个 JSON 文件写入自定义主题目录，
    // 跳过已存在的同 id 条目（我们不希望恢复操作覆盖用户本地编辑）。
    let mut themes_restored = 0usize;
    let mut themes_skipped = 0usize;
    if let Some(themes) = payload.get("themes").and_then(|v| v.as_array()) {
        let dir = mt_core::theme::themes_dir();
        let _ = std::fs::create_dir_all(&dir);
        for theme in themes {
            let Some(id) = theme.get("id").and_then(|v| v.as_str()) else { continue };
            // id 来自导入 payload——未校验就拼路径，`../../x` 可以
            // 写出主题目录。复用保存路径上的同一校验。
            if let Err(e) = mt_core::theme::validate_theme_id(id) {
                return Err(format!("invalid theme in backup: {e}"));
            }
            let target = dir.join(format!("{id}.json"));
            if target.exists() {
                themes_skipped += 1;
                continue;
            }
            match std::fs::write(&target, serde_json::to_string_pretty(theme).unwrap_or_else(|_| "{}".to_string())) {
                Ok(_) => themes_restored += 1,
                Err(_) => themes_skipped += 1,
            }
        }
        restored_keys.push("themes".to_string());
    }

    Ok(serde_json::json!({
        "ok": true,
        "restored": restored_keys,
        "themes_restored": themes_restored,
        "themes_skipped": themes_skipped,
        "keybindings_restored": keybindings_restored,
    }))
}
