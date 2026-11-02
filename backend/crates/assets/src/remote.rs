//! 图片远程上传（Remote 模式）与 SSRF 防护。
//!
//! 上传以 multipart POST 发送 `image` 字段，期望服务器返回
//! JSON `{ "url": "..." }`（或裸 http URL）。

use crate::{detect_image_format_from_bytes, extension_from_mime, generate_timestamp};
use serde::{Deserialize, Serialize};
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};

/// 远程上传结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteUploadResult {
    pub url: String,
    pub success: bool,
    pub error: Option<String>,
}

/// 判断 IP 是否为私有 / 内部地址（未指定、环回、私网、
/// 链路本地、CGNAT、测试网段及多播 / 保留地址）。
fn is_disallowed_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            o[0] == 0
                || o[0] == 10
                || o[0] == 127
                || (o[0] == 169 && o[1] == 254)
                || (o[0] == 172 && (16..=31).contains(&o[1]))
                || (o[0] == 192 && o[1] == 168)
                || (o[0] == 100 && (64..=127).contains(&o[1]))
                || (o[0] == 198 && (18..=19).contains(&o[1]))
                || o[0] >= 224
        }
        IpAddr::V6(v6) => {
            // IPv4-mapped（::ffff:a.b.c.d）/ compat 地址按内嵌 IPv4 判断
            if let Some(mapped) = v6.to_ipv4() {
                return is_disallowed_ip(IpAddr::V4(mapped));
            }
            v6.is_unspecified()
                || v6.is_loopback()
                || (v6.segments()[0] & 0xFE00) == 0xFC00 // fc00::/7 唯一本地
                || (v6.segments()[0] & 0xFFC0) == 0xFE80 // fe80::/10 链路本地
        }
    }
}

/// 校验上传 URL 是否安全可用（防 SSRF）。
///
/// 除字符串级检查外，对 IP 字面量做精确的网段判定——`url` crate 会把
/// `2130706433`、`0x7f000001` 这类十进制 / 十六进制 / 短写 IPv4 规范化
/// 成点分十进制，纯字符串前缀匹配可被这类写法绕过。对主机名则做 DNS
/// 解析，只要**任意一个**解析出的地址属于内部地址即拒绝。
///
/// 已知局限：校验发生在发起请求之前，无法防御 DNS rebinding
/// （解析后 IP 被替换）；如需更强保证需引入固定解析结果的代理层。
fn validate_upload_url(url: &str) -> std::result::Result<(), String> {
    let parsed = url::Url::parse(url).map_err(|e| format!("invalid URL: {}", e))?;

    match parsed.scheme() {
        "http" | "https" => {}
        _ => return Err(format!("unsupported URL scheme: {}", parsed.scheme())),
    }

    let host = parsed.host_str().ok_or("upload URL has no host")?;
    let host_lower = host.to_lowercase();

    if host_lower == "localhost"
        || host_lower.ends_with(".internal")
        || host_lower.ends_with(".local")
    {
        return Err("upload URL points to an internal/private address".into());
    }

    // IP 字面量（含规范化后的简写形式）：直接精确判定
    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_disallowed_ip(ip) {
            return Err("upload URL points to an internal/private address".into());
        }
        return Ok(());
    }

    // 主机名：解析 DNS，逐一检查所有解析出的地址
    //（端口仅用于构造待解析字符串，实际不影响 IP 判定结果）
    let addrs: Vec<SocketAddr> = format!("{}:{}", host, parsed.port().unwrap_or(80))
        .to_socket_addrs()
        .map_err(|e| format!("failed to resolve upload host: {}", e))?
        .collect();
    for addr in addrs {
        if is_disallowed_ip(addr.ip()) {
            return Err("upload URL resolves to an internal/private address".into());
        }
    }

    Ok(())
}

/// 上传图片到远程服务器（Remote 模式）。
/// 服务器应接受 multipart POST（字段 `image`）并返回
/// JSON `{ "url": "..." }`。
pub fn upload_image_remote(
    base64_data: &str,
    upload_url: &str,
    api_key: Option<&str>,
) -> RemoteUploadResult {
    // 校验上传 URL，防止 SSRF
    if let Err(e) = validate_upload_url(upload_url) {
        return RemoteUploadResult {
            url: String::new(),
            success: false,
            error: Some(e),
        };
    }

    // 若存在 data URL 前缀则移除
    let data = if base64_data.contains(',') {
        base64_data.split(',').nth(1).unwrap_or(base64_data)
    } else {
        base64_data
    };

    // 解码 base64
    let decoded = match base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        data,
    ) {
        Ok(d) => d,
        Err(_) => {
            return RemoteUploadResult {
                url: String::new(),
                success: false,
                error: Some("Invalid base64 data".to_string()),
            };
        }
    };

    // 检测 MIME 类型
    let mime = detect_image_format_from_bytes(&decoded).unwrap_or("image/png");
    let ext = extension_from_mime(mime);
    let filename = format!("image_{}.{}", generate_timestamp(), ext);

    // 构造 multipart 请求
    let boundary = format!("----MarkPureBoundary{}", generate_timestamp());

    let mut body = Vec::new();

    // MIME part 头
    body.extend_from_slice(
        format!(
            "--{}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{}\"\r\nContent-Type: {}\r\n\r\n",
            boundary, filename, mime
        )
        .as_bytes(),
    );
    body.extend_from_slice(&decoded);
    body.extend_from_slice(format!("\r\n--{}--\r\n", boundary).as_bytes());

    // 发送请求（ureq 3.x API）。ureq 3 的默认超时几乎全为 None——
    // 挂死的服务器会无限阻塞慢速 IPC 线程，这里显式设 30s 上限。
    // 重定向必须禁用：`validate_upload_url` 只校验初始 URL，若允许
    // 跟随 302，公网服务器一跳即可把请求转进 127.0.0.1 / 云元数据
    // 地址，全部 SSRF 防护形同虚设。
    let mut request = ureq::post(upload_url)
        .config()
        .timeout_per_call(Some(std::time::Duration::from_secs(30)))
        .max_redirects(0)
        .build()
        .header(
            "Content-Type",
            &format!("multipart/form-data; boundary={}", boundary),
        );

    if let Some(key) = api_key {
        request = request.header("Authorization", &format!("Bearer {}", key));
    }

    match request.send(&body) {
        Ok(response) => {
            // 上传响应只需包含 URL / 短 JSON。显式限制为 64KB
            // （ureq 默认上限 10MB 对这个用途过于宽裕）——坏的服务器
            // 不应能撑大进程内存。
            let mut resp_body = response.into_body();
            let body_text = resp_body
                .with_config()
                .limit(64 * 1024)
                .read_to_string()
                .unwrap_or_default();

            // 尝试从 JSON 响应中提取 URL
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body_text) {
                if let Some(url) = json.get("url").and_then(|v| v.as_str()) {
                    return RemoteUploadResult {
                        url: url.to_string(),
                        success: true,
                        error: None,
                    };
                }
                // 尝试常见的替代字段名
                for field in &["link", "image_url", "data", "src"] {
                    if let Some(url) = json.get(*field).and_then(|v| v.as_str()) {
                        return RemoteUploadResult {
                            url: url.to_string(),
                            success: true,
                            error: None,
                        };
                    }
                }
            }

            // 无法解析 JSON 时，把响应体当作 URL
            let trimmed = body_text.trim().to_string();
            if trimmed.starts_with("http") {
                RemoteUploadResult {
                    url: trimmed,
                    success: true,
                    error: None,
                }
            } else {
                // 截取错误摘要；200 字节处可能落在多字节字符中间，
                // 回退到最近的字符边界再切片，避免越界 panic。
                let mut end = 200usize.min(body_text.len());
                while end > 0 && !body_text.is_char_boundary(end) {
                    end -= 1;
                }
                RemoteUploadResult {
                    url: String::new(),
                    success: false,
                    error: Some(format!(
                        "Could not extract URL from response: {}",
                        &body_text[..end]
                    )),
                }
            }
        }
        Err(e) => RemoteUploadResult {
            url: String::new(),
            success: false,
            error: Some(format!("Upload failed: {}", e)),
        },
    }
}
