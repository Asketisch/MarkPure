# MarkPure 架构与开发指南

> 项目简介见 [README.md](../README.md)；功能清单见 [FEATURES.md](./FEATURES.md)。

## 1. 架构

```
┌─────────────────────────────────────────────────────┐
│              Rust 桌面壳 (backend/)                  │
│  ┌───────────────────────────────────────────────┐ │
│  │          Svelte 5 前端 (frontend/src/)         │ │
│  │  ┌─────────────────────────────────────────┐  │ │
│  │  │  Tiptap WYSIWYG 编辑器                  │  │ │
│  │  │  + CodeMirror 6 代码块                   │  │ │
│  │  │  + KaTeX 数学公式 / Mermaid 图           │  │ │
│  │  │  + 即时渲染 / 多光标 / 列选 / Vim 插件    │  │ │
│  │  └─────────────────────────────────────────┘  │ │
│  │  自定义 IPC JSON 协议                          │ │
│  └───────────────────────────────────────────────┘ │
│  wry (系统 WebView) + tao (窗口管理)                 │
│  rust-embed (编译期嵌入前端资源)                    │
│  Document 注册表 (HashMap<doc_id, Document>)          │
└─────────────────────────────────────────────────────┘
              │
┌─────────────┼─────────────┬─────────────┬──────────┐
│  core-lib   │    fs       │  markdown   │  export    │
│  文档/配置  │  文件 I/O    │  MD 解析    │ HTML/PDF   │
│  (ropey)    │  编码检测    │ (pulldown)  │  Word/PNG  │
└─────────────┴─────────────┴─────────────┴──────────┘
```

**前端只负责渲染与交互，一切功能性操作都通过 IPC 交给 Rust 后端执行。** Rust 侧持有文档的 rope 文本副本，统计、搜索、导出等计算都在 Rust 侧完成，不需要把全文序列化来回传。

### 技术栈

| 层 | 技术 |
|---|---|
| 桌面壳 | wry 0.46 + tao 0.34（系统 WebView，非 Electron） |
| 前端框架 | Svelte 5（runes）+ TypeScript，Vite 8 构建 |
| 编辑器内核 | Tiptap 3（ProseMirror） |
| 代码块 | CodeMirror 6（14+ 语言） |
| 公式 / 图表 | KaTeX 0.16 / Mermaid |
| 后端 | Rust 2021（ropey 文本缓冲、regex 搜索、pulldown-cmark 解析） |
| 文件监视 / 编码检测 | notify 8 / chardetng + encoding_rs |
| 导出 | printpdf 0.7 / docx-rs / html-to-image |

### 目录结构

```
MarkPure/
├── frontend/src/                # Svelte 5 + TypeScript 前端
│   ├── app/                    # 主应用（菜单栏 / 标签栏 / 工具栏 / 状态栏）
│   ├── editor/                 # Tiptap 编辑器封装与 IPC 命令
│   ├── components/             # 通用 UI / 布局 / 工作区面板
│   ├── features/               # 设置、搜索、快速插入、大纲、命令面板
│   ├── extensions/             # Tiptap 扩展（含大文档虚拟化）
│   ├── plugins/                # ProseMirror 插件（多光标、列选、Vim、撤销树）
│   ├── nodeviews/              # 代码块 / Mermaid / TOC 的 NodeView
│   └── stores/                 # Svelte 5 runes 状态
├── backend/
│   ├── apps/desktop/           # 桌面应用入口（窗口、WebView、IPC 分发）
│   └── crates/                 # core-lib / fs / markdown / export / search /
│                               # bookmark / assets / spellcheck
├── scripts/                    # 构建、打包、版本同步脚本
├── resources/icons/            # 应用图标
└── distribution/               # 分发包配置（Info.plist、desktop 文件）
```

## 2. 下载安装

从 [Releases](https://github.com/Asketisch/MarkPure/releases) 下载对应平台的便携包，解压即用：

| 平台 | 包 | 说明 |
|------|-----|------|
| macOS (Apple Silicon) | `MarkPure-v*-macos-arm64.zip` | 解压后拖入「应用程序」。未做公证，首次打开需右键 → 打开 |
| macOS (Intel) | `MarkPure-v*-macos-x64.zip` | 同上 |
| Windows | `MarkPure-v*-windows-x64.zip` | 解压后进入 `MarkPure-windows/` 目录，双击 `markpure.exe`；需 WebView2 运行时（Win10/11 默认自带） |
| Linux (x64) | `MarkPure-v*-linux-x64.tar.gz` | 需系统 webkit2gtk-4.1，安装命令见包内 `README.txt` |
| Linux (ARM64) | `MarkPure-v*-linux-arm64.tar.gz` | 同上（树莓派 4+/ARM 服务器等） |

每个 Release 附 `SHA256SUMS.txt`，可用于校验下载完整性。

## 3. 构建

### 前置依赖

[Node.js](https://nodejs.org/) 与 [Rust](https://www.rust-lang.org/tools/install)。Linux 额外需要 webkit2gtk / gtk 的开发包：

```bash
# Debian / Ubuntu
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev pkg-config
# Fedora
sudo dnf install webkit2gtk4.1-devel gtk3-devel
```

### 开发运行

以下命令均在**仓库根目录**执行（npm 工程在根目录，`frontend/` 下没有独立的 package.json）。

```bash
npm install

# 终端 1：启动前端开发服务器（热重载）
npm run dev

# 终端 2：启动 Rust 后端（连接前端开发服务器）
cargo run -- --dev
```

访问 http://localhost:5173 即可。

### 构建与打包

```bash
# 一键构建（前端 + Rust）
./scripts/build.sh              # debug
./scripts/build.sh release      # release，产物在 target/release/markpure

# 各平台打包
./scripts/bundle-macos.sh       # → target/MarkPure.app（含 ad-hoc 签名）
./scripts/bundle-windows.sh     # → target/MarkPure-windows/
./scripts/bundle-linux.sh       # → target/MarkPure-linux/
```

三个打包脚本都支持 `SKIP_BUILD=1`（跳过构建，直接打包已有二进制）与 `TARGET_DIR=`（指定 cargo target 子目录，交叉编译时用），CI 的发布流程正是这样调用的。

> 前端产物经 rust-embed 在**编译期**嵌入二进制，因此改动前端后必须重新 `cargo build`——`build.sh` 已经处理好这个顺序。

## 4. 开发测试

```bash
npm run check                       # 前端类型检查（svelte-check + tsc）
cargo test --workspace              # Rust 单元测试
python3 scripts/test_backend.py     # 后端 IPC 全量测试（经 mt_harness 驱动真实处理器）
npm run test:markdown               # Markdown 往返与归一化回归
npm run test:frontend               # 前端验证脚本（需 Chrome 的部分在无 Chrome 时自动跳过）
./scripts/check-file-size.sh        # 文件行数预算
```

CI 在每次 push 与 PR 上跑类型检查、Linux 全量测试，以及 macOS / Windows 的平台编译验证。

## 5. 发布新版本

```bash
# 1. 同步版本号到 Cargo.toml / 关于页 / Info.plist / Cargo.lock
./scripts/sync-version.sh 0.2.0

# 2. 提交版本变更
git commit -am "chore(release): v0.2.0"

# 3. 打 tag 并推送——CI 自动构建四平台产物并创建 Release
git tag v0.2.0
git push origin main v0.2.0
```

## 6. 已知限制

- PDF 导出依赖系统字体：拉丁文需 DejaVu / Liberation，中文需文泉驿 / Noto CJK（缺失时 PDF 中文为空白，不报错）
- PNG 导出依赖编辑器实例存在（离屏 DOM 快照），空文档或无 ProseMirror 时跳过
- 拼写检查的中文仅 macOS 可用（Windows / Linux 目前只查英文）
- PlantUML / Draw.io 目前只插入代码块，不做即时渲染
- 发布产物未做代码签名与公证：macOS 首次打开需右键 → 打开，Windows 可能出现 SmartScreen 提示
- 部分主题只有 CSS 实现
