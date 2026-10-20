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
///
/// 环境变量 `MARKPURE_CONFIG_DIR` 优先于平台默认路径。它让测试
/// harness 能把配置隔离到临时目录（测试不应污染用户的真实设置），
/// 也方便做「便携版」安装——把配置放在程序目录旁边。
pub fn app_config_dir() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("MARKPURE_CONFIG_DIR") {
        if !dir.trim().is_empty() {
            return Some(PathBuf::from(dir));
        }
    }
    config_dir().map(|d| d.join("markpure"))
}
