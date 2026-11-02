use std::path::Path;

/// 把 `content` 原子地写入 `path`：先写同目录下的临时文件，
/// 再用 `rename` 替换目标。
///
/// 直接 `fs::write` 是原地截断写入——进程写到一半崩溃（断电、
/// kill）会把 tabs.json / config.json / keymap.json / theme.json
/// 等配置留在截断或半新半旧的状态，下次启动解析失败，用户丢失
/// 全部配置。同文件系统内的 `rename` 是原子的：目标要么是完整的
/// 旧内容，要么是完整的新内容。
///
/// 临时文件以 `.{文件名}.tmp` 命名，避免与真实配置互相覆盖；
/// 写入或重命名失败时会清理临时文件，不在配置目录留垃圾。
/// [`atomic_write`] 的字节版本——文档保存的编码产物是原始字节
///（GBK 等非 UTF-8 编码），同样需要"临时文件 + rename"的原子性，
/// 避免截断后写失败把用户文档变成半截文件。
pub fn atomic_write_bytes(path: &Path, content: &[u8]) -> std::io::Result<()> {
    let file_name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("file");
    let tmp = path.with_file_name(format!(".{file_name}.tmp"));
    std::fs::write(&tmp, content)?;
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(())
}

pub fn atomic_write(path: &Path, content: &str) -> std::io::Result<()> {
    let file_name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("file");
    let tmp = path.with_file_name(format!(".{file_name}.tmp"));
    std::fs::write(&tmp, content)?;
    if let Err(e) = std::fs::rename(&tmp, path) {
        // 重命名失败（如跨设备）时把临时文件清掉再上报，
        // 避免每次启动都在配置目录里堆积 .tmp。
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_replaces_existing_and_leaves_no_tmp() {
        let dir = std::env::temp_dir().join("markpure-atomic-test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.json");

        atomic_write(&path, "v1").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "v1");

        atomic_write(&path, "v2").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "v2");
        assert!(!path.with_file_name(".config.json.tmp").exists());

        std::fs::remove_dir_all(&dir).ok();
    }
}
