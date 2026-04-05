use serde::{Deserialize, Serialize};

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
        KeyBinding {
            id: "view.theme_cycle".into(),
            label: "Cycle Theme".into(),
            accelerator: Some("CmdOrCtrl+Shift+T".into()),
        },
    ]
}
