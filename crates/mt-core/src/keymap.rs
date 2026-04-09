use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// Keyboard shortcut definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyBinding {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub accelerator: Option<String>,
}

/// Default keybindings for the editor
pub fn default_keybindings() -> Vec<KeyBinding> {
    vec![
        // File operations
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
        // Edit operations
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
        // View operations
        KeyBinding {
            id: "view.toggle_sidebar".into(),
            label: "Toggle Sidebar".into(),
            accelerator: Some("CmdOrCtrl+B".into()),
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
        // Workspace
        KeyBinding {
            id: "workspace.search".into(),
            label: "Workspace Search".into(),
            accelerator: Some("CmdOrCtrl+Shift+F".into()),
        },
        // Formatting
        KeyBinding {
            id: "format.bold".into(),
            label: "Bold".into(),
            accelerator: Some("CmdOrCtrl+B".into()),
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

/// Get the keybindings file path
pub fn keybindings_path() -> PathBuf {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("markpure");
    fs::create_dir_all(&config_dir).ok();
    config_dir.join("keybindings.json")
}

/// Load custom keybindings from disk
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

/// Save custom keybindings to disk
pub fn save_keybindings(keybindings: &[KeyBinding]) -> Result<(), String> {
    let path = keybindings_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(keybindings).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}

/// Reset keybindings to default
pub fn reset_keybindings() -> Result<Vec<KeyBinding>, String> {
    let defaults = default_keybindings();
    save_keybindings(&defaults)?;
    Ok(defaults)
}

/// Update a single keybinding
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
