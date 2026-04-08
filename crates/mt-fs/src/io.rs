use chardetng::EncodingDetector;
use encoding_rs::Encoding;
use mt_core::document::{Document, Encoding as DocEncoding};
use mt_core::error::{Error, Result};
use std::path::{Path, PathBuf};
use tokio::io::AsyncReadExt;

/// Read a file with automatic encoding detection
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
        encoding_to_doc(&encoding),
    ))
}

/// Write a document to a file
pub async fn write_file(document: &Document, path: &Path) -> Result<()> {
    let content = document.text();
    let encoding = document.encoding();
    let encoding_label = encoding.label();

    let encoded = if encoding_label.starts_with("UTF-8") {
        content.as_bytes().to_vec()
    } else {
        let enc = Encoding::for_label(encoding_label.as_bytes())
            .ok_or_else(|| Error::Encoding(format!("Unknown encoding: {}", encoding_label)))?;
        let (encoded, _encoding_used, _had_errors) = enc.encode(&content);
        encoded.into_owned()
    };

    tokio::fs::write(path, encoded).await.map_err(Error::Io)
}

/// Detect encoding and decode bytes to String
fn detect_and_decode(raw: &[u8]) -> Result<(String, &'static Encoding)> {
    let mut detector = EncodingDetector::new();
    detector.feed(raw, true);
    let encoding = detector.guess(None, true);

    let (text, _encoding_used, _had_errors) = encoding.decode(raw);
    Ok((text.into_owned(), encoding))
}

/// Convert encoding_rs Encoding to our DocEncoding
fn encoding_to_doc(enc: &'static Encoding) -> DocEncoding {
    match enc.name() {
        "UTF-8" => DocEncoding::Utf8,
        "GBK" | "gb18030" => DocEncoding::Gbk,
        "Shift_JIS" | "EUC-JP" | "ISO-2022-JP" => DocEncoding::ShiftJis,
        "Big5" | "EUC-TW" => DocEncoding::Big5,
        other => DocEncoding::Other(other.to_string()),
    }
}

// CRUD operations

/// Create a new empty file
pub async fn create_file(path: &Path) -> Result<()> {
    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            tokio::fs::create_dir_all(parent).await.map_err(Error::Io)?;
        }
    }
    tokio::fs::write(path, "").await.map_err(Error::Io)
}

/// Create a new directory
pub async fn create_directory(path: &Path) -> Result<()> {
    tokio::fs::create_dir_all(path).await.map_err(Error::Io)
}

/// Delete a file or directory
pub async fn delete_file(path: &Path) -> Result<()> {
    if path.is_dir() {
        tokio::fs::remove_dir_all(path).await.map_err(Error::Io)
    } else {
        tokio::fs::remove_file(path).await.map_err(Error::Io)
    }
}

/// Rename a file or directory
/// Returns the new path
pub async fn rename_file(old_path: &Path, new_name: &str) -> Result<PathBuf> {
    let new_path = old_path.parent().map(|p| p.join(new_name)).ok_or_else(|| {
        Error::Io(std::io::Error::new(std::io::ErrorKind::InvalidInput, "invalid path"))
    })?;

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
}
