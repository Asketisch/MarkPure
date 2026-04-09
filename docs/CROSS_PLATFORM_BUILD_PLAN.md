# MarkMe 跨平台构建方案

## Context

MarkMe 当前仅能在 macOS (Apple Silicon) 上构建和运行。项目底层技术栈 (wry/tao) 本身支持三大平台，但缺少 CI/CD、打包配置和部分代码兼容性修复。本方案将使项目支持 6 个目标平台的自动化构建和发布。

### 目标平台

| 平台 | 架构 | Rust Target | CI Runner |
|------|------|-------------|-----------|
| macOS | aarch64 | `aarch64-apple-darwin` | `macos-14` (native) |
| macOS | x86_64 | `x86_64-apple-darwin` | `macos-14` (cross) |
| Windows | x86_64 | `x86_64-pc-windows-msvc` | `windows-latest` (native) |
| Windows | aarch64 | `aarch64-pc-windows-msvc` | `windows-latest` (cross) |
| Linux | x86_64 | `x86_64-unknown-linux-gnu` | `ubuntu-latest` (native) |
| Linux | aarch64 | `aarch64-unknown-linux-gnu` | `ubuntu-24.04-arm` (native) |

---

## Phase 1: 代码兼容性修复

### 1.1 修复 PDF 字体路径

**文件:** `crates/mt-export/src/pdf.rs` (行 130-155)

**问题:**
- macOS: regular 和 bold 都用同一个 `Helvetica.ttc`，bold 实际不生效
- Linux: 只检查 regular 文件是否存在，未检查 bold 文件

**修复:**
- macOS: bold 改用 `/System/Library/Fonts/Supplemental/Helvetica Bold.ttc`，不存在时降级为 regular
- Linux: 候选路径检查时同时验证 regular 和 bold 都存在

### 1.2 统一 dirs.rs 的 cfg 风格（可选）

**文件:** `crates/mt-core/src/dirs.rs`

`config_dir()` 用运行时 `cfg!()`，`home_dir()` 用编译时 `#[cfg()]`。功能正确但风格不一致。可选统一为 `#[cfg()]`。

---

## Phase 2: 构建脚本改进

### 2.1 创建 `justfile`（项目根目录）

使用 `just` 作为跨平台任务运行器，替代 bash-only 的 `build.sh`：

```just
set windows-shell := ["powershell", "-NoLogo", "-Command"]

profile := "debug"

build:
    npm ci
    npx vite build
    # force rust-embed recompile
    touch src-rust/src/main.rs
    cargo build {{ if profile == "release" { "--release" } else { "" } }}

run: build
    cargo run {{ if profile == "release" { "--release" } else { "" } }}

clean:
    rm -rf dist
    cargo clean
```

### 2.2 创建 `build.ps1`（Windows 开发者用）

PowerShell 版本的构建脚本，处理 `.exe` 后缀等 Windows 特有逻辑。

### 2.3 保留 `build.sh`

现有脚本在 macOS/Linux 上工作正常，保持不变。

---

## Phase 3: GitHub Actions CI/CD

**新文件:** `.github/workflows/build.yml`

### Job 1: `test`（3 个 OS 并行）

在 macOS/Windows/Ubuntu 上运行：
- `npm ci && npm run check`
- `cargo test --workspace`
- `cargo fmt --all -- --check`
- `cargo clippy --workspace -- -D warnings`

Linux 需安装: `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev`

### Job 2: `build`（6 目标 matrix）

依赖 `test` job，对每个目标平台：
1. 安装 Rust + 对应 target
2. 安装 Node 22，`npm ci && npx vite build`
3. `cargo build --release --target $TARGET`
4. 上传 artifact

**关键设计决策:**
- macOS x86_64: 在 ARM runner 上交叉编译（Rosetta + LLVM 原生支持）
- Windows aarch64: MSVC 原生支持交叉编译
- Linux aarch64: 使用 GitHub 原生 ARM runner（避免 cross 编译 webkit2gtk 的复杂性）

### Job 3: `package`（仅 tag 触发）

下载 build artifacts，运行各平台打包脚本，生成安装包。

### Job 4: `release`（仅 tag 触发）

使用 `softprops/action-gh-release` 创建 Release 并附加所有安装包。

---

## Phase 4: 应用打包

### 4.1 图标资源

**新目录:** `assets/icons/`
- `icon.svg` — 源矢量图
- `icon.icns` — macOS
- `icon.ico` — Windows
- `icon.png` — Linux (512x512)

### 4.2 macOS: .app + .dmg

**新文件:** `packaging/macos/Info.plist`, `packaging/macos/package.sh`

构建 `MarkMe.app` bundle 结构 → 用 `hdiutil` 生成 `.dmg`。暂不做代码签名。

### 4.3 Windows: NSIS 安装包

**新文件:** `packaging/windows/installer.nsi`, `packaging/windows/package.ps1`

安装到 Program Files，创建开始菜单快捷方式，注册卸载程序。CI 中用 `choco install nsis` 安装。

### 4.4 Linux: AppImage + .deb

**新文件:**
- `packaging/linux/markme.desktop` — FreeDesktop 桌面文件
- `packaging/linux/package-appimage.sh` — 构建 AppImage
- `packaging/linux/package-deb.sh` — 构建 .deb（Depends: libwebkit2gtk-4.1-0, libgtk-3-0）

---

## Phase 5: 平台测试

在 `crates/mt-export/src/pdf.rs` 添加字体路径存在性测试：
```rust
#[test]
fn test_font_paths_exist() {
    let (regular, bold) = get_font_paths().expect("should resolve");
    assert!(regular.exists());
    assert!(bold.exists());
}
```

在 `crates/mt-core/src/dirs.rs` 添加目录解析测试。

---

## 实施顺序

| 步骤 | 任务 | 涉及文件 |
|------|------|----------|
| 1 | 修复 pdf.rs 字体路径 | `crates/mt-export/src/pdf.rs` |
| 2 | 创建 justfile + build.ps1 | `justfile`, `build.ps1` |
| 3 | 创建图标资源目录（占位） | `assets/icons/` |
| 4 | 创建 CI test job | `.github/workflows/build.yml` |
| 5 | 创建 CI build matrix (6 targets) | `.github/workflows/build.yml` |
| 6 | 创建打包脚本 | `packaging/**` |
| 7 | 创建 CI package + release jobs | `.github/workflows/build.yml` |
| 8 | 添加平台测试 | `crates/mt-export/src/pdf.rs`, `crates/mt-core/src/dirs.rs` |
| 9 | 添加 Linux 构建依赖文档 | `README.md` 或 `docs/BUILDING.md` |

## 验证方式

1. 本地：`cargo test --workspace` 确认字体和目录测试通过
2. CI：推送到 GitHub，验证 6 个目标的 build job 全部通过
3. 发布：打 `v*` tag，验证 Release 中生成所有平台的安装包
4. 手动：在各平台下载安装包，验证能正常启动和导出 PDF

## 风险项

- **Linux ARM + webkit2gtk**: 如果 `ubuntu-24.04-arm` runner 不可用，需用 `cross` + 自定义 Docker 镜像，复杂度高
- **Windows ARM**: 无法在 CI 上实际运行测试，标记为 "experimental"
- **macOS .ttc 字体**: printpdf 可能无法正确提取 collection 中的 face，备选方案是内嵌开源字体
