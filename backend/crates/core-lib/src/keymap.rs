use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// 「切换专注模式」的默认快捷键。
/// macOS 上裸 F11 被 WKWebView/macOS 本身占用（它会触发系统全屏
/// 切换，与页内处理器竞争），因此改用 macOS 惯例的
/// 「Cmd+Ctrl+F」。其他平台保持 F11。
#[cfg(target_os = "macos")]
const ZEN_MODE_ACCELERATOR: &str = "Cmd+Ctrl+F";
#[cfg(not(target_os = "macos"))]
const ZEN_MODE_ACCELERATOR: &str = "F11";

/// 键盘快捷键定义
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyBinding {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub accelerator: Option<String>,
}

/// 编辑器的默认快捷键
pub fn default_keybindings() -> Vec<KeyBinding> {
    vec![
        // 文件操作
        KeyBinding {
            id: "file.new".into(),
            label: "New File".into(),
            accelerator: Some("CmdOrCtrl+N".into()),
        },
        KeyBinding {
            id: "file.open".into(),
            label: "Open File".into(),
            accelerator: Some("CmdOrCtrl+O".into()),
        },
        KeyBinding {
            id: "file.save".into(),
            label: "Save".into(),
            accelerator: Some("CmdOrCtrl+S".into()),
        },
        KeyBinding {
            id: "file.save_as".into(),
            label: "Save As".into(),
            accelerator: Some("CmdOrCtrl+Shift+S".into()),
        },
        KeyBinding {
            id: "file.close_tab".into(),
            label: "Close Tab".into(),
            accelerator: Some("CmdOrCtrl+W".into()),
        },
        // 编辑操作
        KeyBinding {
            id: "edit.undo".into(),
            label: "Undo".into(),
            accelerator: Some("CmdOrCtrl+Z".into()),
        },
        KeyBinding {
            id: "edit.redo".into(),
            label: "Redo".into(),
            accelerator: Some("CmdOrCtrl+Shift+Z".into()),
        },
        KeyBinding {
            id: "edit.find".into(),
            label: "Find".into(),
            accelerator: Some("CmdOrCtrl+F".into()),
        },
        KeyBinding {
            id: "edit.find_replace".into(),
            label: "Find and Replace".into(),
            accelerator: Some("CmdOrCtrl+H".into()),
        },
        // 多光标快捷键。Cmd+D 是「选择下一处出现」，Cmd+Shift+L
        // 选中所有匹配，Cmd+U 撤销上一次光标添加，Escape 清除全部
        // 副光标。
        KeyBinding {
            id: "edit.select_next_match".into(),
            label: "Select Next Match".into(),
            accelerator: Some("CmdOrCtrl+D".into()),
        },
        KeyBinding {
            id: "edit.select_all_matches".into(),
            label: "Select All Matches".into(),
            accelerator: Some("CmdOrCtrl+Shift+L".into()),
        },
        KeyBinding {
            id: "edit.undo_last_cursor".into(),
            label: "Undo Last Cursor".into(),
            accelerator: Some("CmdOrCtrl+U".into()),
        },
        KeyBinding {
            id: "edit.clear_multi_cursor".into(),
            label: "Clear Multi-Cursor".into(),
            accelerator: Some("Escape".into()),
        },
        // 视图操作
        KeyBinding {
            id: "view.toggle_sidebar".into(),
            label: "Toggle Sidebar".into(),
            accelerator: Some("CmdOrCtrl+B".into()),
        },
        // 分支撤销树。Cmd+\ 打开面板。
        KeyBinding {
            id: "view.toggle_undo_tree".into(),
            label: "Toggle Undo Tree Panel".into(),
            accelerator: Some("CmdOrCtrl+\\".into()),
        },
        KeyBinding {
            id: "undoTree.go_to_parent".into(),
            label: "Undo Tree: Go to Parent Branch".into(),
            accelerator: Some("CmdOrCtrl+Alt+Up".into()),
        },
        KeyBinding {
            id: "undoTree.prune_current".into(),
            label: "Undo Tree: Prune Current Branch".into(),
            accelerator: Some("CmdOrCtrl+Alt+Backspace".into()),
        },
        KeyBinding {
            id: "view.cycle_theme".into(),
            label: "Cycle Theme".into(),
            accelerator: Some("CmdOrCtrl+Shift+T".into()),
        },
        KeyBinding {
            id: "view.source_mode".into(),
            label: "Toggle Source Mode".into(),
            accelerator: Some("CmdOrCtrl+/".into()),
        },
        KeyBinding {
            id: "view.toggle_zen_mode".into(),
            label: "Toggle Zen Mode".into(),
            accelerator: Some(ZEN_MODE_ACCELERATOR.into()),
        },
        // Vim 模式开关。CmdOrCtrl+. 是「Cmd 加句号」的常见绑定——
        // 与 Apple Script 的「确认退出」助记一致，但本编辑器不内置
        // Apple Script，因此该组合键空闲可用。
        KeyBinding {
            id: "view.toggle_vim_mode".into(),
            label: "Toggle Vim Mode".into(),
            accelerator: Some("CmdOrCtrl+.".into()),
        },
        // 工作区
        KeyBinding {
            id: "workspace.search".into(),
            label: "Workspace Search".into(),
            accelerator: Some("CmdOrCtrl+Shift+F".into()),
        },
        // 格式化。`format.bold` 故意没有快捷键：Cmd/Ctrl+B 已被
        // `view.toggle_sidebar` 占用（前端全局键位处理器硬编码了该
        // 行为，菜单与快捷键面板也按此展示）。若这里再写一遍
        // `CmdOrCtrl+B`，数据层面就是双重绑定，且编辑器聚焦时
        // Tiptap 内置的 `Mod-b` 加粗会与侧栏切换同时触发。加粗仍
        // 可通过工具栏按钮与 `**` 输入规则完成。
        KeyBinding {
            id: "format.bold".into(),
            label: "Bold".into(),
            accelerator: None,
        },
        KeyBinding {
            id: "format.italic".into(),
            label: "Italic".into(),
            accelerator: Some("CmdOrCtrl+I".into()),
        },
        KeyBinding {
            id: "format.strikethrough".into(),
            label: "Strikethrough".into(),
            accelerator: Some("CmdOrCtrl+Shift+X".into()),
        },
        KeyBinding {
            id: "format.code".into(),
            label: "Inline Code".into(),
            accelerator: Some("CmdOrCtrl+`".into()),
        },
    ]
}

/// 获取快捷键文件的路径
pub fn keybindings_path() -> PathBuf {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("markpure");
    fs::create_dir_all(&config_dir).ok();
    config_dir.join("keybindings.json")
}

/// 从磁盘加载自定义快捷键
pub fn load_keybindings() -> Vec<KeyBinding> {
    let path = keybindings_path();
    if !path.exists() {
        return default_keybindings();
    }
    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_else(|_| default_keybindings()),
        Err(_) => default_keybindings(),
    }
}

/// 把自定义快捷键保存到磁盘
pub fn save_keybindings(keybindings: &[KeyBinding]) -> Result<(), String> {
    let path = keybindings_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(keybindings).map_err(|e| e.to_string())?;
    crate::atomic::atomic_write(&path, &content).map_err(|e| e.to_string())?;
    Ok(())
}

/// 把快捷键重置为默认值
pub fn reset_keybindings() -> Result<Vec<KeyBinding>, String> {
    let defaults = default_keybindings();
    save_keybindings(&defaults)?;
    Ok(defaults)
}

/// 更新单个快捷键
pub fn update_keybinding(id: &str, accelerator: Option<String>) -> Result<Vec<KeyBinding>, String> {
    let mut keybindings = load_keybindings();
    if let Some(binding) = keybindings.iter_mut().find(|b| b.id == id) {
        binding.accelerator = accelerator;
    } else {
        return Err(format!("Unknown keybinding: {}", id));
    }
    save_keybindings(&keybindings)?;
    Ok(keybindings)
}
