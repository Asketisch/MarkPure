# AGENTS.md — assets/ 图片资源管理

## 目录

| 文件 | 说明 |
|------|------|
| `lib.rs` | 图片核心：`save_pasted_image` / `image_to_base64` / `detect_image_format` / `extension_from_mime`，公共类型（`Error`、`SavedImage`、`ImagePasteMode`）与全部 `pub use` 再导出 |
| `remote.rs` | 远程上传（Remote 模式）：`upload_image_remote`、`RemoteUploadResult`、SSRF 防护（`validate_upload_url` / `is_disallowed_ip`，含 IP 字面量精确网段判定 + 主机名 DNS 解析检查） |
| `file_info.rs` | 文件信息与外部修改跟踪：`FileInfo` / `get_file_info` / `is_file_readonly`、`track_file` / `is_file_modified` / `untrack_file`（会话级内存跟踪表 `TRACKED_FILES`，锁中毒可恢复） |

## 注意事项

- 公共 API 一律从 crate 根（`lib.rs`）导出，消费方直接 `assets::xxx` 使用
- `validate_upload_url` 的 DNS 检查存在 TOCTOU 局限（无法防御 DNS rebinding），详见 `remote.rs` 模块注释
