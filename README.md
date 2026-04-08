# MarkPure

WYSIWYG Markdown 桌面编辑器。

使用 Rust (wry + tao) 构建原生桌面壳，Svelte 5 + Tiptap (ProseMirror) 构建 WYSIWYG 编辑器前端，不依赖 Tauri 或 Electron。

## 功能特性

- **WYSIWYG 编辑** — 所见即所得的 Markdown 编辑体验
- **Typora 风格即时渲染** — 光标附近显示 Markdown 语法标记，远离时隐藏（增量更新，高性能）
- **多标签页** — 同时打开多个文档，支持脏状态追踪
- **文件树管理** — 打开文件夹作为工作区，浏览、搜索、创建、重命名、删除文件
- **文档大纲** — 直接从 ProseMirror 文档模型提取标题（零 IPC 开销）
- **代码块** — CodeMirror 6 嵌入编辑，支持 14+ 种语言语法高亮
- **数学公式** — KaTeX 渲染行内和块级 LaTeX 公式
- **搜索替换** — 支持正则、大小写敏感、全词匹配
- **源码模式** — 切换到 CodeMirror 原始 Markdown 编辑
- **快速插入** — `@` 触发命令面板，快速插入标题、代码块、表格等
- **多主题** — 浅色、VS Code Dark、Atom One Dark 三种主题
- **导出** — 支持导出为 HTML（独立文档）和 PDF
- **CJK 支持** — CJK 字符感知的词数统计
- **自动编码检测** — 支持读取 UTF-8、GBK、Shift_JIS、Big5 等编码的文件
- **最近文件** — 自动记录最近打开的文件
- **标签页持久化** — 关闭后恢复上次的标签页状态
- **Rust 文档注册表** — 文档模型下沉到 Rust，统计和搜索直接在 rope 上计算，无需全文 IPC 传输

## 架构概览

```
┌──────────────────────────────────────────┐
│            Rust 桌面壳 (src-rust/)        │
│  ┌─────────────────────────────────────┐ │
│  │   Svelte 5 前端 (src/)              │ │
│  │   ┌───────────────────────────────┐ │ │
│  │   │  Tiptap WYSIWYG 编辑器       │ │ │
│  │   │  + CodeMirror 代码块          │ │ │
│  │   │  + KaTeX 数学公式             │ │ │
│  │   │  + 即时渲染插件               │ │ │
│  │   └───────────────────────────────┘ │ │
│  │   自定义 IPC JSON 协议              │ │
│  └─────────────────────────────────────┘ │
│  wry (WebView) + tao (窗口管理)          │
│  rust-embed (嵌入前端资源)               │
│  文档注册表 (HashMap<tab_id, Document>)  │
└──────────────────────────────────────────┘
         │
    ┌────┴────┬──────────┬──────────┐
    │ mt-core │  mt-fs   │mt-markdown│ mt-export
    │ 文档/配置│ 文件I/O  │ MD 解析   │ HTML/PDF
    │ (ropey  │          │(pulldown- │ (printpdf)
    │ +regex) │          │  cmark)   │
    └─────────┴──────────┴──────────┘
```

前端通过自定义 IPC 协议与 Rust 通信：`ipc.postMessage()` 发送请求，`window.__mt_dispatch()` 接收响应。

Rust 端持有文档的 rope 文本副本（文档注册表），统计和搜索等计算直接在 Rust 端完成，无需全文序列化。

## 目录结构

```
MarkMe/
├── src/                    # Svelte 5 + TypeScript 前端
│   ├── App.svelte          # 主应用组件
│   ├── app.css             # 全局样式 + 主题变量 + 编辑器样式
│   ├── main.ts             # 入口
│   └── lib/
│       ├── editor.ts       # Tiptap 编辑器工厂
│       ├── commands.ts     # IPC 命令封装 + 类型定义
│       ├── components/     # Svelte 组件
│       │   ├── SideBar.svelte        # 侧边栏容器
│       │   ├── WorkSpace.svelte      # 文件树浏览器
│       │   ├── Outline.svelte        # 文档大纲（前端直接提取）
│       │   ├── SearchBar.svelte      # 搜索替换栏
│       │   ├── SourceEditor.svelte   # 源码模式编辑器
│       │   └── QuickInsertPopup.svelte # @ 快速插入弹窗
│       ├── extensions/     # Tiptap 扩展
│       │   ├── code-block-cm-extension.ts  # CodeMirror 代码块
│       │   ├── math-extension.ts           # KaTeX 数学公式
│       │   ├── instant-render-extension.ts # 即时渲染
│       │   ├── search-extension.ts         # 搜索
│       │   ├── quick-insert-extension.ts   # @ 快速插入
│       │   ├── quick-insert-config.ts      # 快速插入配置
│       │   └── cm-theme.ts                 # CodeMirror 主题
│       ├── plugins/        # ProseMirror 插件
│       │   ├── instant-render.ts   # 即时渲染核心（增量装饰更新）
│       │   └── search.ts          # 搜索核心
│       └── nodeviews/      # ProseMirror NodeView
│           └── code-block-view.ts  # CodeMirror 代码块视图
├── src-rust/               # Rust 桌面壳
│   └── src/main.rs         # WebView 创建、IPC 处理、命令分发、文档注册表
├── crates/                 # Rust 库 crate
│   ├── mt-core/            # Document (ropey+regex)、AppConfig、TabState、Error、ThemeId
│   ├── mt-fs/              # 异步文件 I/O + 编码检测 + 目录扫描 + 文件监视
│   ├── mt-markdown/        # Markdown 解析 + HTML 转换 + 标题提取
│   └── mt-export/          # HTML/PDF 导出
├── build.sh                # 构建脚本 (npm build → cargo build)
└── index.html              # SPA 入口
```

## 技术栈

| 层 | 技术 | 版本 |
|---|---|---|
| 桌面壳 | wry + tao | 0.46 + 0.34（原生 WebView，无 Electron/Tauri） |
| 前端框架 | Svelte | 5.x (runes: `$state`/`$effect`/`$props`) |
| 构建工具 | Vite | 8.x |
| WYSIWYG 编辑器 | Tiptap (ProseMirror) | 3.22.x |
| 代码块编辑器 | CodeMirror | 6.x (14+ 语言) |
| 数学公式 | KaTeX | 0.16 |
| Markdown 转换 | @tiptap/markdown | — |
| 后端语言 | Rust | 2021 edition |
| 文本缓冲区 | ropey | 1.6 |
| 正则搜索 | regex | 1.x |
| Markdown 解析 | pulldown-cmark | 0.12 (SIMD) |
| 文件监视 | notify | 8.x |
| 编码检测 | chardetng + encoding_rs | — |
| 原生对话框 | rfd | 0.15 |
| PDF 导出 | printpdf | 0.7 |
| 前端嵌入 | rust-embed | 8.x |

## 开发

需要安装 [Node.js](https://nodejs.org/)、[Rust](https://www.rust-lang.org/tools/install)。

```bash
# 安装前端依赖
npm install

# 终端 1：启动前端开发服务器（热重载）
npm run dev

# 终端 2：启动 Rust 后端（连接前端开发服务器）
cargo run -- --dev
```

## 构建

```bash
# 一键构建（前端 + Rust）
./build.sh

# 或分步执行：
npm run build          # 构建前端
cargo build --release  # 构建 Rust 后端（嵌入 dist/）

# 运行
./target/release/markpure
```

## macOS App 打包

构建 macOS `.app` 应用程序包：

```bash
# 一键打包（构建 + 打包 + ad-hoc 签名）
./bundle-macos.sh

# 跳过代码签名
SIGN=0 ./bundle-macos.sh

# 运行
open target/MarkPure.app
```

首次打包前生成应用图标（之后无需重复）：

```bash
./macos/gen-icns.sh
```

打包后的应用位于 `target/MarkPure.app`。

## 其他命令

```bash
# 前端类型检查
npm run check

# Rust 编译检查
cargo check --workspace

# Rust 测试
cargo test --workspace
```

## 当前状态

| 阶段 | 内容 | 状态 |
|------|------|------|
| 1 | Rust 基础设施（目录扫描、文件监视、文件 CRUD、Tab 状态） | ✅ 完成 |
| 2 | Rust IPC 命令（25+ 命令，含文档注册表） | ✅ 完成 |
| 3 | 前端组件（文件树、侧边栏、大纲、搜索、源码模式、快速插入） | ✅ 完成 |
| 4 | 性能优化（即时渲染增量更新、文档模型下沉 Rust、大纲零 IPC） | ✅ 完成 |
| 5 | 标签页撕离多窗口 | 🔧 部分实现 |

## 已知限制

- PDF 导出使用硬编码的 macOS 字体路径（`/System/Library/Fonts/Helvetica.ttc`），跨平台需修复
- `svelte-i18n` 已声明为依赖但尚未集成
- 6 个主题定义中仅 3 个有前端 CSS 实现（Light、Dark、OneDark）

## 性能优化

- **即时渲染增量更新**：光标移动时仅更新受影响的顶层块节点的装饰，而非全文档遍历
- **文档模型下沉 Rust**：Rust 端维护文档的 rope 副本（`HashMap<tab_id, Document>`），统计/搜索直接在 Rust 端计算，无需 IPC 全文传输
- **大纲零 IPC**：直接从 ProseMirror 文档模型提取标题，不再序列化到 Rust
- **搜索优化**：使用 `doc.textBetween()` 替代逐字符遍历构建位置映射
- **持久化 tokio Runtime**：所有 IPC 命令共享同一个 Runtime 实例
- **rust-embed**：前端资源编译嵌入二进制，无运行时磁盘读取

## 许可证

MIT
