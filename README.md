# MarkPure

<div align="center">

[![CI](https://github.com/Demon1019/MarkPure/actions/workflows/ci.yml/badge.svg)](https://github.com/Demon1019/MarkPure/actions/workflows/ci.yml)
[![Release](https://github.com/Demon1019/MarkPure/actions/workflows/release.yml/badge.svg)](https://github.com/Demon1019/MarkPure/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Rust](https://img.shields.io/badge/backend-Rust-orange.svg)](https://www.rust-lang.org/)

[English](./README.en.md) | 简体中文

</div>

<p align="center">
  <b>所见即所得的 Markdown 编辑器，但文件始终是纯 Markdown。</b><br>
  <sub>Rust 原生外壳 + Svelte 5 前端 · 内置 Vim 模式与多光标 · 单文件便携运行，无需账号、无需插件</sub>
</p>

---

## 为什么是另一个 Markdown 编辑器

Markdown 编辑器大致分三类：纯文本 + 预览（VS Code）、纯所见即所得（Typora）、笔记库式（Obsidian）。

MarkPure 走的是第四条路：**所见即所得的写作体验 + 文件夹就是你的知识库 + 编辑器本身只是个没有包袱的本地程序**。

| | MarkPure | Obsidian | Typora | VS Code + Markdown |
|---|---|---|---|---|
| 文件格式 | 纯 `.md`，读写无损 | 纯 `.md`，读写无损 | 纯 `.md`，读写无损 | 纯 `.md` |
| 所见即所得 | ✅ | ✅ | ✅ | ❌（预览窗格） |
| 内置 Vim 模式 | ✅ 完整模式机 | ❌ 需社区插件 | ❌ | ⚠️ 仅编辑体验 |
| 多光标 / 列选择 | ✅ 自研 | ❌ | ❌ | ✅（纯文本侧） |
| 分支式撤销树 | ✅ | ❌ | ❌ | ❌ |
| 工作区全文搜索 | ✅ 内置 | ✅ | ❌ | ⚠️ 需扩展 |
| 反链 / 标签面板 | ✅ 内置 | ✅ | ❌ | ❌ |
| 运行架构 | 系统 WebView（无 Electron） | Electron | Electron | Electron |
| 安装体积 | 单文件约 15 MB | 约 100 MB 量级 | 约 100 MB 量级 | 约 100 MB 量级 |
| 账号 / 同步 | 完全不需要 | 同步需账号 | 不需要 | 不需要 |
| 中日文体验 | ✅ 见下 | 一般 | 一般 | 一般 |

> 对比的是各项目的通用形态与社区共识，具体能力以各自最新版本为准。

### 相比之下，MarkPure 的几个特别之处

**① 写的时候是所见即所得，存的时候是纯 Markdown**

不是「Markdown 编辑器套一个富文本外壳」，而是**双向无损**：你看到的就是文件里的，加粗就是 `**加粗**`，插入的表格就是 GFM 表格。仓库里有专门的回归测试（`validate-file-format.ts`）把**前端真正写出的字节**喂给**后端真正的处理器**再逐字节校验——前端漏传编码、后端不认这个编码，都会当场失败。

**② Vim 模式是自研的完整模式机，不是按键映射表**

`Cmd+.` 切换，6 种模式（NORMAL / INSERT / VISUAL / V-LINE / V-BLOCK / REPLACE）、约 18 个 motion、3 类 operator（`d` / `c` / `y`）、10 余种 text object、4 个 ex 命令（`:w` `:q` `:wq` `:e`），支持 count 前缀（`3d`、`ciw`）。Vim 的 `Ctrl-V` 视觉块直接复用列选择的矩形计算。

社区里现成的方案（如 `prosemirror-vim`）自 2018 年后就没再维护，跟当前的 ProseMirror / Tiptap 版本并不兼容，所以这块是重写了一遍。59 项专门测试覆盖。

**③ 多光标与列选择是同一套引擎**

`Alt+Click` 加光标、`Cmd+D` 选中下个匹配、`Alt+拖拽` 拖出矩形选区——列选完成后直接展开成 N 个 range cursor，与多光标共用同一套输入 fan-out、装饰绘制和撤销链路。表格单元格、代码块、虚拟化隐藏的块会自动跳过，不会把光标塞进不该去的地方。

**④ 撤销是树，不是线性栈**

改错一次之后，回到旧状态再改，会长出分支而不是覆盖历史。右侧面板可以直接查看和跳转各个分支。

**⑤ 中文不是「顺便支持一下」**

- 词数统计按 CJK 字符感知，中文不会被算成一个词
- 打开文件时自动检测编码：UTF-8 / UTF-8 BOM / GBK / Big5 / Shift_JIS 等，存回时用原编码
- macOS 上走系统级 `NSSpellChecker`，中文和英文都能查拼写（Windows / Linux 目前仅英文）
- 界面语言：简体中文 / English / 日本語
- PDF 导出嵌入 CJK 字体子集，中文不会变成空白

**⑥ 不打包 Chromium**

用 wry + tao 直接驱动系统 WebView（macOS 的 WKWebView、Windows 的 WebView2、Linux 的 WebKitGTK）。整个程序是一个约 15 MB 的单文件二进制，解压即用；内存占用只跟系统 WebView 有关，而不是像 Electron 应用那样额外背一个 Chromium。

**⑦ 不需要账号，不上传你的笔记**

文件就是硬盘上的 `.md`，配置放在系统标准的应用配置目录（macOS `~/Library/Application Support/markpure`、Windows `%APPDATA%\markpure`、Linux `~/.config/markpure`）。唯一会联网的地方是你**主动配置**的图片上传器（粘贴图片后传到你的图床），不配就完全不联网。

**⑧ 一个文件夹就是一个工作区**

打开目录就能用：文件树、全文搜索（支持正则）、标签面板（`#tag` 聚合）、反链面板、TOC、大纲、多根工作区、工作区自定义 CSS（`.markpure/styles/*.css`）都在内置里，不用装插件。

---

## 功能特性

### 编辑

| 功能 | 说明 |
|---|---|
| **所见即所得 + 源码模式** | 四种视图状态机：源码 / WYSIWYG / 拆分 / 预览，同步滚动与选区对应 |
| **即时渲染** | 光标附近显示 Markdown 语法标记，远离时自动隐藏 |
| **多光标编辑** | `Alt+Click` 加光标、`Cmd+D` 选下个匹配、`Cmd+Shift+L` 全选匹配；输入 / Backspace / 粘贴自动 fan-out |
| **列选择** | `Alt+拖拽` 拖出矩形选区，展开为 N 个 range cursor，表格 / 代码块自动跳过 |
| **Vim 模式** | 6 模式 × 18 motion × 3 operator × 10+ text object × 4 ex 命令，持久化到配置 |
| **分支式撤销树** | 撤销历史是树不是栈，可视化浏览并跳转任意分支 |
| **Slash Command / 快速插入** | `/` 与 `@` 唤起块插入菜单，21 个预置块类型（标题、代码块、表格、公式、列表、脚注、目录、Mermaid……） |
| **图片工具栏** | 宽度预设 / 对齐 / alt 文本 / 删除，尺寸持久化进 Markdown 扩展语法 |
| **数学公式** | KaTeX 渲染行内与块级 LaTeX |
| **Mermaid 图** | 代码块内即时渲染流程图 |
| **Wiki 链接** | `[[` 触发文件补全，`[[` 链接与反链面板联动 |
| **脚注 / 上标 / 下标** | 内联脚注引用、GFM 上标下标 |
| **路径补全** | `Cmd+P` 模糊匹配工作区文件 |
| **搜索替换** | 正则、大小写敏感、全词匹配 |
| **拼写检查** | macOS 系统级检查（中文 + 英文），右键菜单给出候选词 |
| **禅模式 / 分屏** | `F11` 全屏专注；分屏可拖拽调整比例 |

### 文档与工作区

| 功能 | 说明 |
|---|---|
| **文件树** | 深度 15 层，实时刷新，支持创建 / 重命名 / 删除 |
| **工作区全文搜索** | 跨文件正则搜索，命中处可直接跳转 |
| **标签面板** | 聚合所有 `#tag`，支持 `/` 分层（`#project/foo`） |
| **反链面板** | 列出所有链接到当前文档的地方 |
| **大纲 / TOC** | 从文档模型直接提取标题，可一键插入动态 TOC |
| **多根工作区** | 同时挂多个根目录，跨根搜索与书签 |
| **文件监视** | 外部修改当前文件时询问「重新加载 / 保留我的修改 / 比较差异」 |
| **自动保存** | 可配置间隔，编辑停顿后防抖触发 |
| **工作区 CSS** | `.markpure/styles/*.css` 自动加载并热重载，优先级高于用户主题 |
| **模板片段** | 用户配置目录下的 `snippets/*.md`，支持 `{{date}}` `{{time}}` `{{uuid}}` |
| **自定义主题** | JSON 主题导入 / 导出，7 个内置主题 |

### 导出

| 格式 | 说明 |
|---|---|
| **HTML** | 保留主题样式与图片扩展语法 |
| **PDF** | 真实排版，字体子集化嵌入，支持页眉页脚与页码 |
| **Word** | 表格、列表、代码块、图片完整保留 |
| **PNG** | 当前文档导出为长图，主题跟随编辑器 |

> 完整功能清单（含每项的触发方式、关键文件与已知限制）见 **[docs/FEATURES.md](./docs/FEATURES.md)**。

---

## 下载安装

从 [Releases](https://github.com/Asketisch/MarkPure/releases) 下载对应平台的便携包，解压即用：

| 平台 | 包 | 说明 |
|------|-----|------|
| macOS (Apple Silicon) | `MarkPure-v*-macos-arm64.zip` | 解压后拖入「应用程序」。未做公证，首次打开需右键 → 打开 |
| macOS (Intel) | `MarkPure-v*-macos-x64.zip` | 同上 |
| Windows | `MarkPure-v*-windows-x64.zip` | 解压后双击 `markpure.exe`；需 WebView2 运行时（Win10/11 默认自带） |
| Linux (x64) | `MarkPure-v*-linux-x64.tar.gz` | 需系统 webkit2gtk-4.1，安装命令见包内 `README.txt` |
| Linux (ARM64) | `MarkPure-v*-linux-arm64.tar.gz` | 同上（树莓派 4+/ARM 服务器等） |

每个 Release 附 `SHA256SUMS.txt`，可用于校验下载完整性。

也可以从源码构建，见[快速开始](#快速开始)。

---

## 快速开始

### 前置依赖

[Node.js](https://nodejs.org/) 与 [Rust](https://www.rust-lang.org/tools/install)。Linux 额外需要 webkit2gtk / gtk 的开发包：

```bash
# Debian / Ubuntu
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev pkg-config
# Fedora
sudo dnf install webkit2gtk4.1-devel gtk3-devel
```

### 安装与开发

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

---

## 快捷键

| 快捷键 | 操作 |
|---|---|
| `Cmd/Ctrl + N` / `O` / `S` | 新建 / 打开 / 保存 |
| `Cmd/Ctrl + Shift + S` | 另存为 |
| `Cmd/Ctrl + W` | 关闭标签页 |
| `Cmd/Ctrl + Z` / `Shift + Z` | 撤销 / 重做 |
| `Cmd/Ctrl + F` / `H` | 查找 / 查找替换 |
| `Cmd/Ctrl + P` | 快速切换文件 |
| `Cmd/Ctrl + Shift + F` | 工作区全文搜索 |
| `Cmd/Ctrl + B` / `I` | 加粗 / 斜体 |
| `Cmd/Ctrl + /` | 切换源码模式 |
| `Cmd/Ctrl + Shift + T` | 切换主题 |
| `Cmd/Ctrl + .` | 开关 Vim 模式 |
| `F11` / `Cmd/Ctrl + Shift + Z` | 禅模式 |
| `Alt + Click` | 添加多光标 |
| `Cmd/Ctrl + D` | 选中下个匹配并加入多光标 |
| `Alt + 拖拽` | 列选择（矩形选区） |
| `Esc` | 清空多光标 / 退出 Vim 视觉模式 |

完整快捷键（含快速插入、代码块、Vim 详细键位）见应用内设置面板。

---

## 架构

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

### 技术栈

| 层 | 技术 |
|---|---|
| 桌面壳 | wry 0.46 + tao 0.34（系统 WebView，非 Electron） |
| 前端框架 | Svelte 5（runes）+ TypeScript |
| 构建工具 | Vite 8 |
| 编辑器内核 | Tiptap 3（ProseMirror） |
| 代码块 | CodeMirror 6（14+ 语言） |
| 公式 / 图表 | KaTeX 0.16 / Mermaid |
| 后端 | Rust 2021（ropey 文本缓冲、regex 搜索、pulldown-cmark 解析） |
| 文件监视 / 编码检测 | notify 8 / chardetng + encoding_rs |
| 导出 | printpdf 0.7 / docx-rs / html-to-image |

---

## 开发

```bash
npm run check                       # 前端类型检查（svelte-check + tsc）
cargo test --workspace              # Rust 单元测试
python3 scripts/test_backend.py     # 后端 IPC 全量测试（经 mt_harness 驱动真实处理器）
npm run test:markdown               # Markdown 往返与归一化回归
npm run test:frontend               # 前端验证脚本（需 Chrome 的部分在无 Chrome 时自动跳过）
./scripts/check-file-size.sh        # 文件行数预算
```

CI 在每次 push 与 PR 上跑类型检查、Linux 全量测试，以及 macOS / Windows 的平台编译验证。

### 发布新版本

```bash
# 1. 同步版本号到 Cargo.toml / 关于页 / Info.plist / Cargo.lock
./scripts/sync-version.sh 0.2.0

# 2. 提交版本变更
git commit -am "chore(release): v0.2.0"

# 3. 打 tag 并推送——CI 自动构建四平台产物并创建 Release
git tag v0.2.0
git push origin main v0.2.0
```

---

## 已知限制

- PDF 导出依赖系统字体：拉丁文需 DejaVu / Liberation，中文需文泉驿 / Noto CJK（缺失时 PDF 中文为空白，不报错）
- PNG 导出依赖编辑器实例存在（离屏 DOM 快照），空文档或无 ProseMirror 时跳过
- 拼写检查的中文仅 macOS 可用（Windows / Linux 目前只查英文）
- PlantUML / Draw.io 目前只插入代码块，不做即时渲染
- 发布产物未做代码签名与公证：macOS 首次打开需右键 → 打开，Windows 可能出现 SmartScreen 提示
- 部分主题只有 CSS 实现

---

## 许可证

[MIT](./LICENSE)
