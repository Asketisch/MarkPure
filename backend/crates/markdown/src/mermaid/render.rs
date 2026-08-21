//! Mermaid 渲染管线——启动 `mmdc`，在进程级 LRU 中缓存 SVG/PNG
//! 结果，并向 crate 其余部分暴露带缓存与不带缓存的入口。
//!
//! 从 `mermaid.rs` 中抽取，使 `Command::new("mmdc")` + 临时文件
//! 操作与按格式的缓存集中在单个文件中，而不是与校验、建议和解析
//! 逻辑交织在一起。
//!
//! 此处有两个缓存：
//! - `SVG_CACHE`：以图表源码为键 → `MermaidResult`
//!   （供编辑器实时预览与 HTML 导出使用）。
//! - `PNG_CACHE`：以图表源码为键 → 原始 PNG 字节
//!   （供 PDF 与 DOCX 导出管线使用）。
//!
//! 我们刻意*不*把「mmdc 未安装」的回退结果存入 `SVG_CACHE`——
//! 理由见 `render_mermaid_to_svg_cached`。

use lru::LruCache;
use std::num::NonZeroUsize;
use std::process::Command;
use std::sync::Mutex;

use super::validate::validate_mermaid;

/// LRU 缓存中最多保留的图表数。对典型文档而言 64 绰绰有余；
/// 该缓存为进程级，因此比按文档缓存使用更小的数字。
pub(super) const CACHE_CAPACITY: usize = 64;

/// SVG 渲染结果的进程级 LRU 缓存。缓存键是原始图表源码；
/// 值是 `MermaidResult`（携带 SVG 字符串、可选错误消息与有效性标志）。
pub(super) static SVG_CACHE: once_cell::sync::Lazy<Mutex<LruCache<String, MermaidResult>>> =
    once_cell::sync::Lazy::new(|| {
        Mutex::new(LruCache::new(NonZeroUsize::new(CACHE_CAPACITY).unwrap()))
    });

/// PNG 渲染结果的进程级 LRU 缓存（原始字节载荷）。
pub(super) static PNG_CACHE: once_cell::sync::Lazy<Mutex<LruCache<String, Vec<u8>>>> =
    once_cell::sync::Lazy::new(|| {
        Mutex::new(LruCache::new(NonZeroUsize::new(CACHE_CAPACITY).unwrap()))
    });

/// 重导出结果类型，使调用方可用 `use mermaid::render::*`
/// 而无需深入父模块。
pub(super) use super::types::MermaidResult;

/// 临时文件名的进程内序号。慢速命令在各自专用 OS 线程上并发运行
/// （两个文档同时导出、或同一图表的 SVG/PNG 缓存同时 miss），
/// 固定文件名会让两个 mmdc 进程互相覆盖对方的输入/输出文件。
/// pid + 单调序号保证进程内与跨进程都不碰撞。
static TMP_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// 分配一对唯一的临时输入/输出路径（`out_ext` 为 `svg` 或 `png`）。
fn unique_tmp_paths(out_ext: &str) -> (std::path::PathBuf, std::path::PathBuf) {
    let seq = TMP_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let tmp_dir = std::env::temp_dir().join(format!("markpure-mmd-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&tmp_dir);
    (
        tmp_dir.join(format!("diagram-{seq}.mmd")),
        tmp_dir.join(format!("diagram-{seq}.{out_ext}")),
    )
}

/// 若已安装 `mmdc` CLI 且用户未通过 `MMDC_DISABLED` 环境变量显式
/// 禁用，返回 `true`。测试中遵守该环境变量，使我们无需真正调用
/// CLI 即可强制走回退路径。
pub(super) fn mmdc_available() -> bool {
    if std::env::var_os("MMDC_DISABLED").is_some() {
        return false;
    }
    // `which` 不是一个 crate 依赖；我们自行对少数常见安装位置做 PATH 查找。
    // 无需穷举——若 mmdc 在其他 PATH 上，真正的 Command 启动会成功。
    let candidates: &[&str] = if cfg!(target_os = "windows") {
        &["mmdc.cmd", "mmdc.exe", "mmdc"]
    } else {
        &["mmdc"]
    };
    if let Ok(paths) = std::env::var("PATH") {
        let sep = if cfg!(target_os = "windows") { ';' } else { ':' };
        for dir in paths.split(sep) {
            for cand in candidates {
                let p = std::path::Path::new(dir).join(cand);
                if p.exists() {
                    return true;
                }
            }
        }
    }
    // 兜底：尝试不指定路径启动；若成功，说明 mmdc 在 PATH 上
    Command::new("mmdc").arg("--version").output().is_ok()
}

/// 内部（不带缓存）实现：调用 `mmdc` 生成 SVG。
/// 这是真正 shell 到 Mermaid CLI 的函数。
///
/// `mmdc` 不读 stdin；它需要一个真实的输入文件。我们把图表写入临时
/// 文件，让 `mmdc` 指向它，再读取 SVG 输出。若 `mmdc` 未安装
///（PATH 中无该可执行文件），我们优雅地回退到仅校验，使调用方
/// 仍能展示原始代码块。
pub(super) fn render_mermaid_to_svg_inner(code: &str) -> MermaidResult {
    // 先校验
    if !validate_mermaid(code) {
        return MermaidResult {
            svg: None,
            error: Some("Invalid Mermaid syntax".to_string()),
            is_valid: false,
        };
    }

    if !mmdc_available() {
        return MermaidResult {
            svg: None,
            error: Some(
                "Mermaid CLI (mmdc) not available. Install with: npm install -g @mermaid-js/mermaid-cli"
                    .to_string(),
            ),
            is_valid: true,
        };
    }

    let (in_path, out_path) = unique_tmp_paths("svg");

    if let Err(e) = std::fs::write(&in_path, code) {
        return MermaidResult {
            svg: None,
            error: Some(format!("failed to write temp input: {}", e)),
            is_valid: false,
        };
    }

    let result = Command::new("mmdc")
        .args([
            "-i",
            in_path.to_string_lossy().as_ref(),
            "-o",
            out_path.to_string_lossy().as_ref(),
            "-q",
        ])
        .output();

    let _ = std::fs::remove_file(&in_path);

    match result {
        Ok(output) if output.status.success() => match std::fs::read_to_string(&out_path) {
            Ok(svg) => {
                let _ = std::fs::remove_file(&out_path);
                MermaidResult {
                    svg: Some(svg),
                    error: None,
                    is_valid: true,
                }
            }
            Err(e) => {
                let _ = std::fs::remove_file(&out_path);
                MermaidResult {
                    svg: None,
                    error: Some(format!("mmdc succeeded but output unreadable: {}", e)),
                    is_valid: false,
                }
            }
        },
        Ok(output) => {
            let _ = std::fs::remove_file(&out_path);
            let error = String::from_utf8_lossy(&output.stderr).to_string();
            MermaidResult {
                svg: None,
                error: Some(if error.is_empty() {
                    "mmdc failed (no stderr)".into()
                } else {
                    error
                }),
                is_valid: false,
            }
        }
        Err(_) => {
            // CLI 未安装。我们刻意将其视为软失败（is_valid: true），
            // 使编辑器能展示原始 mermaid 源码而非一条错误——安装 mmdc
            // 是*用户的选择*，而非代码缺陷。
            MermaidResult {
                svg: None,
                error: Some(
                    "Mermaid CLI (mmdc) not available. Install with: npm install -g @mermaid-js/mermaid-cli"
                        .to_string(),
                ),
                is_valid: true,
            }
        }
    }
}

/// 带缓存的 SVG 渲染。相同源码返回相同 `MermaidResult`，无需再次
/// 调用 `mmdc`。供 HTML 导出管线与编辑器的实时渲染 IPC 使用。
///
/// 我们只缓存成功渲染（`svg.is_some()`）与校验失败（`is_valid == false`）
/// 的结果。「mmdc 未安装」的回退结果刻意*不*缓存：若用户应用运行后
/// 安装了 `mmdc`，否则每个缓存的「不可用」条目都会在进程剩余生命周期内
/// 钉死该失败。对该特定 `MermaidResult` 形态跳过缓存，意味着下次调用
/// 会重新检查 `mmdc_available()` 并在不重启的情况下恢复。
pub fn render_mermaid_to_svg_cached(code: &str) -> MermaidResult {
    if let Ok(mut cache) = SVG_CACHE.lock() {
        if let Some(cached) = cache.get(code) {
            // 对「软回退」结果形态跳过缓存。渲染器以 `is_valid: true`
            // 且无 SVG 标记它，这是 mmdc 不可用路径独有的特征。
            if cached.svg.is_some() || !cached.is_valid {
                return cached.clone();
            }
        }
    }

    let result = render_mermaid_to_svg_inner(code);

    if result.svg.is_some() || !result.is_valid {
        if let Ok(mut cache) = SVG_CACHE.lock() {
            cache.put(code.to_string(), result.clone());
        }
    }

    result
}

/// 内部（不带缓存）实现：通过 `-e png`（扩展名）标志调用 `mmdc` 生成 PNG。
pub(super) fn render_mermaid_to_png_inner(code: &str) -> Result<Vec<u8>, String> {
    if !validate_mermaid(code) {
        return Err("Invalid Mermaid syntax".to_string());
    }

    if !mmdc_available() {
        return Err(
            "Mermaid CLI (mmdc) not available. Install with: npm install -g @mermaid-js/mermaid-cli"
                .to_string(),
        );
    }

    let (in_path, out_path) = unique_tmp_paths("png");

    if let Err(e) = std::fs::write(&in_path, code) {
        return Err(format!("failed to write temp input: {}", e));
    }

    let result = Command::new("mmdc")
        .args([
            "-i",
            in_path.to_string_lossy().as_ref(),
            "-o",
            out_path.to_string_lossy().as_ref(),
            "-e",
            "png",
            "-q",
        ])
        .output();

    let _ = std::fs::remove_file(&in_path);

    match result {
        Ok(output) if output.status.success() => match std::fs::read(&out_path) {
            Ok(bytes) => {
                let _ = std::fs::remove_file(&out_path);
                Ok(bytes)
            }
            Err(e) => {
                let _ = std::fs::remove_file(&out_path);
                Err(format!("mmdc succeeded but output unreadable: {}", e))
            }
        },
        Ok(output) => {
            let _ = std::fs::remove_file(&out_path);
            let error = String::from_utf8_lossy(&output.stderr).to_string();
            Err(if error.is_empty() {
                "mmdc failed (no stderr)".into()
            } else {
                error
            })
        }
        Err(_) => Err(
            "Mermaid CLI (mmdc) not available. Install with: npm install -g @mermaid-js/mermaid-cli"
                .to_string(),
        ),
    }
}

/// 带缓存的 PNG 渲染。返回适合嵌入 PDF 与 DOCX 的 PNG 字节。
/// 供 PDF 与 DOCX 导出管线使用。
pub fn render_mermaid_to_png_cached(code: &str) -> Result<Vec<u8>, String> {
    if let Ok(mut cache) = PNG_CACHE.lock() {
        if let Some(cached) = cache.get(code) {
            return Ok(cached.clone());
        }
    }

    let bytes = render_mermaid_to_png_inner(code)?;

    if let Ok(mut cache) = PNG_CACHE.lock() {
        cache.put(code.to_string(), bytes.clone());
    }

    Ok(bytes)
}

/// 编辑器 IPC（`cmd_render_mermaid`）使用的向后兼容入口。
/// 委托给带缓存的 SVG 变体，使编辑器与导出共享同一 LRU。
pub fn render_mermaid_with_cli(code: &str) -> MermaidResult {
    render_mermaid_to_svg_cached(code)
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_render_mermaid_unavailable_returns_soft_error() {
        // 不触碰宿主真实的 `mmdc` 安装即强制回退路径。
        std::env::set_var("MMDC_DISABLED", "1");
        let result = render_mermaid_to_svg_cached("graph TD\n    A --> B");
        // 软失败：代码有效但 mmdc 缺失。
        assert!(result.svg.is_none());
        assert!(result.is_valid);
        assert!(result.error.is_some());
        std::env::remove_var("MMDC_DISABLED");
    }

    #[test]
    fn test_render_mermaid_invalid_syntax_is_hard_error() {
        std::env::set_var("MMDC_DISABLED", "1");
        // 括号不平衡 → validate_mermaid 返回 false →
        // 渲染器须呈现硬错误，而非软「mmdc 缺失」路径。
        let result = render_mermaid_to_svg_cached("graph TD\n    A[ --> B");
        assert!(result.svg.is_none());
        assert!(!result.is_valid);
        assert!(result.error.is_some());
        std::env::remove_var("MMDC_DISABLED");
    }

    #[test]
    fn test_render_mermaid_png_unavailable_returns_error() {
        std::env::set_var("MMDC_DISABLED", "1");
        let result = render_mermaid_to_png_cached("graph TD\n    A --> B");
        assert!(result.is_err());
        std::env::remove_var("MMDC_DISABLED");
    }
}
