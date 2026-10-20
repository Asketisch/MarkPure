use chardetng::EncodingDetector;
use encoding_rs::Encoding;
use mt_core::document::{Document, Encoding as DocEncoding, LineEnding};
use mt_core::error::{Error, Result};
use std::path::{Path, PathBuf};
use tokio::io::AsyncReadExt;

/// UTF-8 BOM 的字节序列。
const UTF8_BOM: [u8; 3] = [0xEF, 0xBB, 0xBF];

/// 文件的存储格式：编码 + 行尾风格。
///
/// 前端传给 Rust 的内容永远是 UTF-8 + LF（ProseMirror 内部规范化）。
/// 若保存时不参考目标文件，打开 GBK / CRLF / 带 BOM 的文档保存后
/// 会被静默改写——用户看到的是"我明明没动编码，文件怎么变样了"。
/// 磁盘上的文件才是它自己格式的事实来源，因此保存前必须探测。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileFormat {
    pub encoding: DocEncoding,
    pub line_ending: LineEnding,
}

impl Default for FileFormat {
    fn default() -> Self {
        Self {
            encoding: DocEncoding::Utf8,
            line_ending: LineEnding::Lf,
        }
    }
}

impl FileFormat {
    /// 由编码标签与行尾标签构造（IPC 传参用）。
    pub fn from_labels(encoding: Option<&str>, line_ending: Option<&str>) -> Self {
        Self {
            encoding: encoding.map(DocEncoding::from_label).unwrap_or(DocEncoding::Utf8),
            line_ending: line_ending.map(LineEnding::from_label).unwrap_or(LineEnding::Lf),
        }
    }
}

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
    let line_ending = LineEnding::detect(&text);
    Ok(Document::from_content_with_format(
        &text,
        Some(path_buf),
        encoding,
        line_ending,
    ))
}

/// 探测已存在文件的存储格式（编码 + 行尾）。
///
/// 文件不存在或读不出来时返回 `None`——调用方据此回退到默认格式
/// （UTF-8 + LF），而不是把"读不到"当成错误：保存一个新文件时
/// 目标路径本来就不存在。
///
/// 这里读**整个**文件而不是只读头部：编码特征（GBK / Big5 /
/// Shift_JIS 的多字节序列）可能出现在文件的任意位置，只读前缀会
/// 把后面的中文误判成 UTF-8。代价是保存时多读一次文件——与打开
/// 该文件的代价同量级，而保存是低频操作。
pub async fn detect_format(path: &Path) -> Option<FileFormat> {
    let raw = tokio::fs::read(path).await.ok()?;
    Some(detect_format_from_bytes(&raw))
}

/// 从原始字节探测存储格式（同步版本，供测试与纯函数调用）。
pub fn detect_format_from_bytes(raw: &[u8]) -> FileFormat {
    let (text, encoding) = detect_and_decode(raw).unwrap_or_else(|_| {
        // 解码失败（理论上不会发生——`decode` 总是给出替换字符而非错误）
        // 时退回到纯 ASCII 假设。
        (
            String::from_utf8_lossy(raw).into_owned(),
            DocEncoding::Utf8,
        )
    });
    let line_ending = LineEnding::detect(&text);
    FileFormat {
        encoding,
        line_ending,
    }
}

/// 将文档写入文件
pub async fn write_file(document: &Document, path: &Path) -> Result<()> {
    let content = document.text();
    let encoding = document.encoding();

    let encoded: Vec<u8> = if encoding.is_utf8() {
        let mut bytes = content.as_bytes().to_vec();
        if encoding == DocEncoding::Utf8Bom {
            // 带 BOM 的文件必须把 BOM 写回去，否则保存一次就永久
            // 丢掉 BOM（某些 Windows 工具靠 BOM 判断编码）。
            let mut with_bom = Vec::with_capacity(UTF8_BOM.len() + bytes.len());
            with_bom.extend_from_slice(&UTF8_BOM);
            with_bom.append(&mut bytes);
            with_bom
        } else {
            bytes
        }
    } else {
        let encoding_label = encoding.label();
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

    tokio::fs::write(path, encoded).await.map_err(Error::Io)
}

/// 检测编码并将字节解码为字符串
///
/// 返回解码后的文本与项目内部的编码标记。UTF-8 BOM 会从文本里
/// 去掉，但编码标记为 `Utf8Bom`——写回时需要还原 BOM。
fn detect_and_decode(raw: &[u8]) -> Result<(String, DocEncoding)> {
    let mut detector = EncodingDetector::new();
    detector.feed(raw, true);
    let encoding = detector.guess(None, true);

    // `encoding_rs::decode()` 会自动剥掉前导 BOM，但我们要知道
    // BOM 是否存在（写回时需要还原），因此从**原始字节**判断。
    let (text, _encoding_used, _had_errors) = encoding.decode(raw);
    let mut text = text.into_owned();
    let mut doc_encoding = encoding_to_doc(encoding);

    // 少数情况下 `decode` 不会剥（如非 UTF-8/UTF-16 编码），手动兜底。
    if text.starts_with('\u{feff}') {
        text = text[3..].to_string();
    }
    if raw.starts_with(&UTF8_BOM) && doc_encoding == DocEncoding::Utf8 {
        doc_encoding = DocEncoding::Utf8Bom;
    }

    Ok((text, doc_encoding))
}

/// 将 encoding_rs 的编码转换为项目内部的 DocEncoding
///
/// 只映射**完全等价**的编码。`EUC-JP` 与 `Shift_JIS`、`EUC-TW` 与
/// `Big5` 并不等价——早期版本把它们混为一谈，导致 EUC-JP 文件
/// 保存后变成 Shift_JIS（乱码）。其余编码走 `Other`，由
/// `encoding_rs` 按原始名称写回。
fn encoding_to_doc(enc: &'static Encoding) -> DocEncoding {
    match enc.name() {
        "UTF-8" => DocEncoding::Utf8,
        "GBK" => DocEncoding::Gbk,
        "Shift_JIS" => DocEncoding::ShiftJis,
        "Big5" => DocEncoding::Big5,
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

    // ---------- 存储格式保真（编码 / 行尾 / BOM） ----------

    fn tmp_path(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join("markpure-test");
        std::fs::create_dir_all(&dir).unwrap();
        dir.join(name)
    }

    #[test]
    fn detect_format_recognises_utf8_bom_and_crlf() {
        let mut raw = UTF8_BOM.to_vec();
        raw.extend_from_slice(b"# Title\r\n\r\nbody\r\n");
        let fmt = detect_format_from_bytes(&raw);
        assert_eq!(fmt.encoding, DocEncoding::Utf8Bom);
        assert_eq!(fmt.line_ending, LineEnding::Crlf);
    }

    #[test]
    fn detect_format_recognises_plain_utf8_lf() {
        let fmt = detect_format_from_bytes(b"# Title\n\nbody\n");
        assert_eq!(fmt.encoding, DocEncoding::Utf8);
        assert_eq!(fmt.line_ending, LineEnding::Lf);
    }

    #[tokio::test]
    async fn bom_is_preserved_across_read_write() {
        let path = tmp_path("test_bom.md");
        let mut raw = UTF8_BOM.to_vec();
        raw.extend_from_slice("# 标题\n\n正文\n".as_bytes());
        std::fs::write(&path, &raw).unwrap();

        let doc = read_file(&path).await.unwrap();
        assert_eq!(doc.encoding(), DocEncoding::Utf8Bom);
        // BOM 不应出现在正文里
        assert_eq!(doc.text_normalized(), "# 标题\n\n正文\n");

        write_file(&doc, &path).await.unwrap();
        let after = std::fs::read(&path).unwrap();
        assert!(after.starts_with(&UTF8_BOM), "BOM must survive a save");
        assert_eq!(after, raw, "save must be byte-identical");
    }

    #[tokio::test]
    async fn crlf_is_preserved_across_read_write() {
        let path = tmp_path("test_crlf.md");
        let raw = b"# Title\r\n\r\nbody\r\n";
        std::fs::write(&path, raw).unwrap();

        let doc = read_file(&path).await.unwrap();
        assert_eq!(doc.line_ending(), LineEnding::Crlf);
        assert_eq!(doc.text_normalized(), "# Title\n\nbody\n");

        write_file(&doc, &path).await.unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), raw, "CRLF must survive a save");
    }

    #[tokio::test]
    async fn gbk_roundtrip_keeps_bytes() {
        let path = tmp_path("test_gbk.md");
        // "中文标题\n" 的 GBK 字节
        let raw: Vec<u8> = vec![0xD6, 0xD0, 0xCE, 0xC4, 0xB1, 0xEA, 0xCC, 0xE2, 0x0A];
        std::fs::write(&path, &raw).unwrap();

        let doc = read_file(&path).await.unwrap();
        assert_eq!(doc.encoding(), DocEncoding::Gbk);
        assert_eq!(doc.text_normalized(), "中文标题\n");

        write_file(&doc, &path).await.unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), raw, "GBK bytes must survive");
    }

    #[tokio::test]
    async fn detect_format_returns_none_for_missing_file() {
        let path = tmp_path("test_missing_never_created.md");
        std::fs::remove_file(&path).ok();
        assert!(detect_format(&path).await.is_none());
    }

    #[test]
    fn euc_jp_is_not_mislabelled_as_shift_jis() {
        // EUC-JP 与 Shift_JIS 不等价。早期版本把它们混为一谈，
        // EUC-JP 文件保存后会变成 Shift_JIS（乱码）。
        let euc_jp = encoding_rs::EUC_JP;
        assert_eq!(euc_jp.name(), "EUC-JP");
        // `encoding_to_doc` 是私有的，但可以通过 `detect_and_decode`
        // 间接验证：EUC-JP 必须落在 `Other` 分支里。
        let (text, enc) = detect_and_decode(&[0xA4, 0xA2, 0xA4, 0xA4]).unwrap();
        assert!(matches!(enc, DocEncoding::Other(ref s) if s == "EUC-JP"));
        assert!(!text.is_empty());
    }
}
