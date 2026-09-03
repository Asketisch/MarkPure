use chardetng::EncodingDetector;
use encoding_rs::Encoding;
use mt_core::document::{Document, Encoding as DocEncoding};
use mt_core::error::{Error, Result};
use std::path::{Path, PathBuf};
use tokio::io::AsyncReadExt;

/// 校验文件名是否包含路径穿越成分。
/// 拒绝包含 `..`、路径分隔符或空字节的名称。
pub fn validate_file_name(name: &str) -> std::result::Result<(), String> {
    if name.is_empty() {
        return Err("file name is empty".into());
    }
    if name.contains("..") {
        return Err(format!("invalid file name: '{}' contains '..'", name));
    }
    if name.contains('/') || name.contains('\\') {
        return Err(format!("invalid file name: '{}' contains path separator", name));
    }
    if name.contains('\0') {
        return Err("invalid file name: contains null byte".into());
    }
    Ok(())
}

/// 读取文件并自动检测编码
pub async fn read_file(path: &Path) -> Result<Document> {
    let mut file = tokio::fs::File::open(path).await.map_err(Error::Io)?;
    let mut raw_bytes = Vec::new();
    file.read_to_end(&mut raw_bytes)
        .await
        .map_err(Error::Io)?;

    let (text, encoding) = detect_and_decode(&raw_bytes)?;
    let path_buf = path.to_path_buf();
    Ok(Document::from_content(
        &text,
        Some(path_buf),
        encoding_to_doc(encoding),
    ))
}

/// 将文档写入文件
pub async fn write_file(document: &Document, path: &Path) -> Result<()> {
    let content = document.text();
    let encoding = document.encoding();
    let encoding_label = encoding.label();

    let encoded = if encoding_label.starts_with("UTF-8") {
        content.as_bytes().to_vec()
    } else {
        let enc = Encoding::for_label(encoding_label.as_bytes())
            .ok_or_else(|| Error::Encoding(format!("Unknown encoding: {}", encoding_label)))?;
        let (encoded, _encoding_used, had_errors) = enc.encode(&content);
        // 目标编码表示不了的字符（如 GBK 文档中的 emoji / 生僻字）
        // 会被默认替换为 `?`——静默写入等于丢数据。宁可让保存失败，
        // 由用户改用 UTF-8 保存，也不在磁盘上留下残缺文档。
        if had_errors {
            return Err(Error::Encoding(format!(
                "Document contains characters that {encoding_label} cannot represent; saving would lose content — save as UTF-8 instead",
            )));
        }
        encoded.into_owned()
    };

    // 原子写：`tokio::fs::write` 先截断再写，中途失败/断电会把
    // 用户文档截成半截。临时文件 + rename 与 tabs/config 的保存
    // 策略一致。编码产物是原始字节，用字节版本。
    mt_core::atomic::atomic_write_bytes(path, &encoded).map_err(Error::Io)
}

/// 检测编码并将字节解码为字符串
fn detect_and_decode(raw: &[u8]) -> Result<(String, &'static Encoding)> {
    let mut detector = EncodingDetector::new();
    detector.feed(raw, true);
    let encoding = detector.guess(None, true);

    let (text, _encoding_used, _had_errors) = encoding.decode(raw);
    let mut text = text.into_owned();

    // 若存在 UTF-8 BOM（0xEF 0xBB 0xBF）则将其去除
    if text.starts_with('\u{feff}') {
        text = text[3..].to_string();
    }

    Ok((text, encoding))
}

/// 将 encoding_rs 的编码转换为项目内部的 DocEncoding
fn encoding_to_doc(enc: &'static Encoding) -> DocEncoding {
    match enc.name() {
        "UTF-8" => DocEncoding::Utf8,
        "GBK" | "gb18030" => DocEncoding::Gbk,
        "Shift_JIS" | "EUC-JP" | "ISO-2022-JP" => DocEncoding::ShiftJis,
        "Big5" | "EUC-TW" => DocEncoding::Big5,
        other => DocEncoding::Other(other.to_string()),
    }
}

// 文件的增删改查操作

/// 创建新的空文件。若文件已存在则报错——绝不能截断已有内容。
pub async fn create_file(path: &Path) -> Result<()> {
    // 确保父目录存在
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            tokio::fs::create_dir_all(parent).await.map_err(Error::Io)?;
        }
    }
    // `create_new(true)` 保证文件不存在才创建；`tokio::fs::write`
    // 会静默截断已存在的文件，把用户内容清零。
    tokio::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .await
        .map(|_| ())
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::AlreadyExists {
                Error::Other(format!("file already exists: {}", path.display()))
            } else {
                Error::Io(e)
            }
        })
}

/// 创建新目录
pub async fn create_directory(path: &Path) -> Result<()> {
    tokio::fs::create_dir_all(path).await.map_err(Error::Io)
}

/// 删除文件或目录
pub async fn delete_file(path: &Path) -> Result<()> {
    if path.is_dir() {
        tokio::fs::remove_dir_all(path).await.map_err(Error::Io)
    } else {
        tokio::fs::remove_file(path).await.map_err(Error::Io)
    }
}

/// 重命名文件或目录
/// 返回新的路径
pub async fn rename_file(old_path: &Path, new_name: &str) -> Result<PathBuf> {
    validate_file_name(new_name).map_err(Error::Other)?;

    let new_path = old_path.parent().map(|p| p.join(new_name)).ok_or_else(|| {
        Error::Io(std::io::Error::new(std::io::ErrorKind::InvalidInput, "invalid path"))
    })?;

    // 校验解析后的路径仍位于同一个父目录之内
    let parent = old_path.parent().ok_or_else(|| {
        Error::Io(std::io::Error::new(std::io::ErrorKind::InvalidInput, "invalid path"))
    })?;
    if !new_path.starts_with(parent) {
        return Err(Error::Other("rename escapes parent directory".into()));
    }

    // POSIX rename 会静默替换已存在的目标——把 `a.md` 改名为已有
    // 的 `b.md` 等于无提示销毁 `b.md`。目标存在时显式报错。
    if new_path.exists() {
        return Err(Error::Other(format!(
            "target already exists: {}",
            new_path.display()
        )));
    }

    tokio::fs::rename(old_path, &new_path).await.map_err(Error::Io)?;
    Ok(new_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_read_utf8_file() {
        let content = "# Hello World\n\nThis is a test.\n";
        let dir = std::env::temp_dir().join("markpure-test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test_utf8.md");
        std::fs::write(&path, content.as_bytes()).unwrap();

        let doc = read_file(&path).await.unwrap();
        assert_eq!(doc.text_normalized(), content);
        assert_eq!(doc.file_name(), "test_utf8.md");
        assert!(!doc.is_dirty());
    }

    #[tokio::test]
    async fn test_write_and_read_roundtrip() {
        let dir = std::env::temp_dir().join("markpure-test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test_roundtrip.md");

        let mut doc = Document::from_content(
            "# Test\n\nHello world\n",
            None,
            DocEncoding::Utf8,
        );
        doc.set_path(path.clone());

        write_file(&doc, &path).await.unwrap();
        let loaded = read_file(&path).await.unwrap();
        assert_eq!(loaded.text_normalized(), doc.text_normalized());
    }

    #[tokio::test]
    async fn test_write_rejects_unencodable_chars() {
        // GBK 无法表示 emoji——旧实现静默写成 `?`（数据丢失）。
        // 现在必须报错且不落盘。
        let dir = std::env::temp_dir().join("markpure-test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test_unencodable.md");
        std::fs::remove_file(&path).ok();

        let doc = Document::from_content("你好 🎉", None, DocEncoding::Gbk);
        let res = write_file(&doc, &path).await;
        assert!(res.is_err());
        assert!(!path.exists());
    }
}
