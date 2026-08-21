use std::path::PathBuf;

/// 获取平台对应的配置目录。
///
/// - macOS：`~/Library/Application Support`
/// - Windows：`%APPDATA%`
/// - Linux：`$XDG_CONFIG_HOME` 或 `~/.config`
pub fn config_dir() -> Option<PathBuf> {
    if cfg!(target_os = "macos") {
        home_dir().map(|h| h.join("Library").join("Application Support"))
    } else if cfg!(target_os = "windows") {
        std::env::var("APPDATA").ok().map(PathBuf::from)
    } else {
        std::env::var("XDG_CONFIG_HOME")
            .ok()
            .map(PathBuf::from)
            .or_else(|| home_dir().map(|h| h.join(".config")))
    }
}

/// 获取用户的主目录。
///
/// - macOS/Linux：`$HOME`
/// - Windows：`%USERPROFILE%` 或 `%HOMEDRIVE%%HOMEPATH%`
pub fn home_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var("USERPROFILE")
            .ok()
            .map(PathBuf::from)
            .or_else(|| {
                let drive = std::env::var("HOMEDRIVE").ok()?;
                let path = std::env::var("HOMEPATH").ok()?;
                Some(PathBuf::from(format!("{}{}", drive, path)))
            })
    }

    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("HOME").ok().map(PathBuf::from)
    }
}

/// 获取应用配置目录（`markpure`）。
pub fn app_config_dir() -> Option<PathBuf> {
    config_dir().map(|d| d.join("markpure"))
}
