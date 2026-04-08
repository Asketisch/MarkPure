use std::path::PathBuf;

/// Get the platform-specific configuration directory.
///
/// - macOS: `~/Library/Application Support`
/// - Windows: `%APPDATA%`
/// - Linux: `$XDG_CONFIG_HOME` or `~/.config`
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

/// Get the user's home directory.
///
/// - macOS/Linux: `$HOME`
/// - Windows: `%USERPROFILE%` or `%HOMEDRIVE%%HOMEPATH%`
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

/// Get the application config directory (`markpure`).
pub fn app_config_dir() -> Option<PathBuf> {
    config_dir().map(|d| d.join("markpure"))
}
