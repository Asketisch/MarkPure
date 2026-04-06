# MarkText-RS

WYSIWYG Markdown 桌面编辑器，灵感来自 [MarkText](https://github.com/marktext/marktext)。

使用 Rust (wry + tao) 构建原生桌面壳，Svelte 5 + Tiptap (ProseMirror) 构建 WYSIWYG 编辑器前端，不依赖 Tauri 或 Electron。

## 功能特性

- **WYSIWYG 编辑** — 所见即所得的 Markdown 编辑体验
- **多标签页** — 同时打开多个文档，支持脏状态追踪
- **文件树管理** — 打开文件夹作为工作区，浏览、搜索、创建、重命名、删除文件
- **文档大纲** — 从 Markdown 标题自动提取并展示文档结构
- **多主题** — 浅色、VS Code Dark、Atom One Dark 三种主题
- **导出** — 支持导出为 HTML（独立文档）和 PDF
- **CJK 支持** — CJK 字符感知的词数统计
- **自动编码检测** — 支持读取 UTF-8、GBK、Shift_JIS、Big5 等编码的文件
- **最近文件** — 自动记录最近打开的文件
- **标签页持久化** — 关闭后恢复上次的标签页状态

## 架构概览

```
┌──────────────────────────────────────────┐
│            Rust 桌面壳 (src-rust/)        │
│  ┌─────────────────────────────────────┐ │
│  │   Svelte 5 前端 (src/)              │ │
│  │   ┌───────────────────────────────┐ │ │
│  │   │  Tiptap WYSIWYG 编辑器       │ │ │
│  │   └───────────────────────────────┘ │ │
│  │   自定义 IPC JSON 协议              │ │
│  └─────────────────────────────────────┘ │
│  wry (WebView) + tao (窗口管理)          │
│  rust-embed (嵌入前端资源)               │
└──────────────────────────────────────────┘
         │
    ┌────┴────┬──────────┬──────────┐
    │ mt-core │  mt-fs   │mt-markdown│ mt-export
    │ 文档/配置│ 文件I/O  │ MD 解析   │ HTML/PDF
    └─────────┴──────────┴──────────┘
```

前端通过自定义 IPC 协议与 Rust 通信：`ipc.postMessage()` 发送请求，`window.__mt_dispatch()` 接收响应。

## 目录结构

```
mark-web/
├── src/                    # Svelte 5 + TypeScript 前端
│   ├── App.svelte          # 主应用组件
│   ├── app.css             # 全局样式 + 主题变量 + 编辑器样式
│   ├── main.ts             # 入口
│   └── lib/
│       ├── editor.ts       # Tiptap 编辑器工厂
│       ├── commands.ts     # IPC 命令封装 + 类型定义
│       └── components/
│           ├── SideBar.svelte     # 侧边栏容器（文件树/大纲切换）
│           ├── WorkSpace.svelte   # 文件树浏览器
│           └── Outline.svelte     # 文档大纲
├── src-rust/               # Rust 桌面壳
│   └── src/main.rs         # WebView 创建、IPC 处理、命令分发
├── crates/                 # Rust 库 crate
│   ├── mt-core/            # Document (ropey)、AppConfig、TabState、Error、ThemeId
│   ├── mt-fs/              # 异步文件 I/O + 编码检测 + 目录扫描 + 文件监视
│   ├── mt-markdown/        # Markdown 解析 + HTML 转换 + 标题提取
│   └── mt-export/          # HTML/PDF 导出
└── docs/
    └── plan.md             # 实现计划
```

## 技术栈

| 层 | 技术 | 版本 |
|---|---|---|
| 桌面壳 | wry + tao | 0.46 + 0.34（原生 WebView，无 Electron/Tauri） |
| 前端框架 | Svelte | 5.x (runes: `$state`/`$effect`/`$props`) |
| 构建工具 | Vite | 8.x |
| WYSIWYG 编辑器 | Tiptap (ProseMirror) | 3.22.x |
| Markdown 转换 | @tiptap/markdown | — |
| 后端语言 | Rust | 2021 edition |
| 文本缓冲区 | ropey | 1.6 |
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
# 构建前端
npm run build

# 构建 Rust 后端（会嵌入 dist/ 中的前端资源）
cargo build --release

# 运行
./target/release/marktext
```

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
| 2 | Rust IPC 命令（20+ 命令） | ✅ 完成 |
| 3 | 前端组件（文件树、侧边栏、大纲、App 集成） | ✅ 完成 |
| 4 | 标签页撕离多窗口 | 🔧 部分实现 |

## 已知限制

- PDF 导出使用硬编码的 macOS 字体路径（`/System/Library/Fonts/Helvetica.ttc`），跨平台需修复
- `svelte-i18n` 已声明为依赖但尚未集成
- 大纲点击导航功能未实现
- 6 个主题定义中仅 3 个有前端 CSS 实现（Light、Dark、OneDark）

## 最近优化

- **持久化 tokio Runtime**：所有 IPC 命令共享同一个 Runtime 实例，避免重复创建销毁
- **文件监视事件推送**：前端通过 `poll_file_changes` 轮询获取文件变更并自动刷新
- **导出功能**：菜单栏新增 HTML/PDF 导出按钮，调用 Rust 导出能力
- **完整配置管理**：`set_config` 支持所有字段（theme、language、editor、workspace）
- **Markdown 渲染修复**：修复 `contentType` 缺失导致的表格/任务列表等不渲染问题
- **表格 CSS 补全**：添加 tableWrapper、单元格选中、列调整手柄样式
- **主题适配**：高亮色和表格选中色随主题切换

## 许可证

MIT
