# MarkPure

WYSIWYG Markdown 桌面编辑器。

使用 Rust (wry + tao) 构建原生桌面壳，Svelte 5 + Tiptap (ProseMirror) 构建 WYSIWYG 编辑器前端。

## 功能特性

| 功能 | 说明 |
|------|------|
| **所见即所得** | WYSIWYG Markdown 编辑体验 |
| **即时渲染** | 光标附近显示 Markdown 语法标记，远离时隐藏 |
| **多光标编辑** | Alt+Click 加光标、Cmd+D 选下个匹配、Cmd+Shift+L 全选匹配、Cmd+U 撤销、Esc 清空；输入/Backspace/粘贴自动 fan-out |
| **列选择** | Alt+Drag 拖出矩形选区，自动展开为 N 个 range cursors；表格 / 代码块 / 虚拟化块自动跳过，64 行上限 |
| **Vim 模式** | `Cmd+.` 切换 NORMAL/INSERT/VISUAL/V-LINE/V-BLOCK 六种模式；motions（hjkl/wb/e/0$/^/gg/G/f/F/t/T/{char}/{}/( )/%）、operators（d/c/y + dd/cc/yy + x/r/J/>>/<<）、text objects（iw/aw/ip/ap/i"/a"/i(/a(/i{/a{）、ex 命令（`:w` `:q` `:wq` `:e`）；V/Ctrl-V 复用列选择 plugin；状态栏 mode 芯片 + count/operator 暂存区；持久化到 `AppConfig.vim_mode` |
| **多标签页** | 同时打开多个文档，支持脏状态追踪 |
| **文件树管理** | 打开文件夹作为工作区，浏览、搜索、创建、重命名、删除文件 |
| **文档大纲** | 直接从 ProseMirror 文档模型提取标题（零 IPC 开销） |
| **代码块** | CodeMirror 6 嵌入编辑，支持 14+ 种语言语法高亮 |
| **数学公式** | KaTeX 渲染行内和块级 LaTeX 公式 |
| **搜索替换** | 支持正则、大小写敏感、全词匹配 |
| **源码模式** | 切换到 CodeMirror 原始 Markdown 编辑 |
| **快速插入** | `@` 触发命令面板，快速插入标题、代码块、表格等 |
| **多主题** | 浅色、深色、One Dark 等 6 种主题 |
| **导出** | 支持导出为 HTML、PDF、Word 和 PNG（图片） |
| **CJK 支持** | CJK 字符感知的词数统计 |
| **自动编码检测** | 支持读取 UTF-8、GBK、Shift_JIS、Big5 等编码的文件 |
| **最近文件** | 自动记录最近打开的文件 |
| **标签页持久化** | 关闭后恢复上次的标签页状态 |
| **书签管理** | 添加、编辑、删除书签 |
| **拼写检查** | 英文 + macOS CJK（NSSpellChecker；Win/Linux 仅英文） |
| **Workspace 搜索** | 工作区全文搜索，支持正则和大小写敏感 |
| **大文档虚拟化** | 顶层块视口虚拟化（>200 块自动启用），`content-visibility: auto` 跳过 off-screen 块的 layout/paint |
| **完整功能清单** | 见 [docs/FEATURES.md](./docs/FEATURES.md)，含 24+ 项详细说明 |

## 快速开始

### 安装依赖

需要安装 [Node.js](https://nodejs.org/) 和 [Rust](https://www.rust-lang.org/tools/install)。

```bash
npm install
```

### 开发模式

两个终端并行运行：

```bash
# 终端 1：启动前端开发服务器（热重载）
cd frontend && npm run dev

# 终端 2：启动 Rust 后端（连接前端开发服务器）
cd backend && cargo run -- --dev
```

访问 http://localhost:5173 即可。

### 构建

```bash
# 一键构建（前端 + Rust）
./scripts/build.sh

# 运行
./target/release/markpure
```

### macOS App 打包

```bash
./scripts/bundle-macos.sh
open target/MarkPure.app
```

## 架构概览

```
┌─────────────────────────────────────────────────────┐
│              Rust 桌面壳 (backend/)                  │
│  ┌───────────────────────────────────────────────┐ │
│  │          Svelte 5 前端 (frontend/src/)         │ │
│  │  ┌─────────────────────────────────────────┐  │ │
│  │  │  Tiptap WYSIWYG 编辑器                  │  │ │
│  │  │  + CodeMirror 6 代码块                   │  │ │
│  │  │  + KaTeX 数学公式                        │  │ │
│  │  │  + 即时渲染插件                          │  │ │
│  │  └─────────────────────────────────────────┘  │ │
│  │  自定义 IPC JSON 协议                          │ │
│  └───────────────────────────────────────────────┘ │
│  wry (WebView) + tao (窗口管理)                       │
│  rust-embed (嵌入前端资源)                           │
│  Document 注册表 (HashMap<doc_id, Document>)          │
└─────────────────────────────────────────────────────┘
              │
┌─────────────┼─────────────┬─────────────┬──────────┐
│  core-lib   │    fs       │  markdown   │  export    │
│  文档/配置  │  文件 I/O    │  MD 解析    │ HTML/PDF   │
│  (ropey)    │  编码检测    │ (pulldown)  │  Word/PNG  │
└─────────────┴─────────────┴─────────────┴──────────┘
```

前端通过自定义 IPC 协议与 Rust 通信：`ipc.postMessage()` 发送请求，`window.__mt_dispatch()` 接收响应。

Rust 端持有文档的 rope 文本副本（文档注册表），统计和搜索等计算直接在 Rust 端完成，无需全文序列化。

## 目录结构

```
MarkPure/
├── frontend/                     # Svelte 5 + TypeScript 前端
│   └── src/
│       ├── app/                 # 主应用组件
│       │   ├── App.svelte       # 主应用：菜单栏、标签栏、工具栏、编辑器、状态栏
│       │   ├── main.ts          # 入口
│       │   └── app.css          # 全局样式 + 主题变量 + 编辑器样式
│       ├── editor/              # Tiptap 编辑器封装
│       │   ├── editor.ts        # 编辑器工厂
│       │   ├── commands.ts      # IPC 命令封装
│       │   └── types.ts         # 类型定义
│       ├── components/          # Svelte 组件（15+ 个）
│       │   ├── ui/              # 通用 UI（Dialog、ColorPicker、ContextMenu 等）
│       │   ├── layout/          # 布局组件
│       │   └── workspace/       # 工作区组件（WorkSpace、Outline、SearchBar 等）
│       ├── features/            # 功能模块
│       │   ├── settings/        # 设置/主题编辑
│       │   ├── search/          # 工作区搜索
│       │   ├── quick-insert/    # 快速插入
│       │   └── outline/        # 大纲面板
│       ├── extensions/         # Tiptap 扩展（17 个，含大文档虚拟化）
│       ├── plugins/            # ProseMirror 插件（5+ 个，含虚拟化与多光标实现）
│       ├── nodeviews/          # ProseMirror NodeView（代码块）
│       ├── stores/             # Svelte 5 runes 状态管理
│       └── i18n/               # 国际化
├── backend/                      # Rust 后端（wry + tao）
│   ├── apps/desktop/            # 桌面应用入口
│   │   └── src/main.rs         # WebView 创建、IPC 处理、文档注册表
│   └── crates/                  # Rust 库 crate
│       ├── core-lib/           # Document、AppConfig、TabState、Theme、i18n、keymap
│       ├── fs/                 # 异步文件 I/O + 编码检测 + 目录扫描 + 文件监视
│       ├── markdown/           # Markdown 解析 + HTML 转换 + 标题提取 + Wiki 链接
│       ├── export/             # HTML/PDF/Word/PNG 导出
│       ├── search/             # 工作区全文搜索
│       ├── bookmark/          # 书签 CRUD
│       ├── assets/            # 图片粘贴处理 + SSRF 防护
│       └── spellcheck/        # 英文拼写检查
├── scripts/                     # 构建脚本
├── resources/                   # 应用资源（图标等）
└── distribution/                # 分发包配置
```

## 技术栈

| 层 | 技术 | 版本 |
|---|---|---|
| 桌面壳 | wry + tao | 0.46 + 0.34 |
| 前端框架 | Svelte | 5.x (runes) |
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
| PDF 导出 | printpdf | 0.7 |
| Word 导出 | docx-rs + zip | 0.4 + 2.x |
| PNG 导出 | html-to-image (前端) + image 0.25 (后端校验) | ^1.11 |
| 前端嵌入 | rust-embed | 8.x |

## 键盘快捷键

### 通用

| 快捷键 | 操作 |
|--------|------|
| `Cmd/Ctrl + N` | 新建文件 |
| `Cmd/Ctrl + O` | 打开文件 |
| `Cmd/Ctrl + S` | 保存 |
| `Cmd/Ctrl + Shift + S` | 另存为 |
| `Cmd/Ctrl + W` | 关闭标签页 |
| `Cmd/Ctrl + Z` | 撤销 |
| `Cmd/Ctrl + Shift + Z` | 重做 |
| `Cmd/Ctrl + F` | 查找 |
| `Cmd/Ctrl + H` | 查找并替换 |
| `Cmd/Ctrl + B` | 切换侧边栏 / 加粗 |
| `Cmd/Ctrl + I` | 斜体 |
| `Cmd/Ctrl + Shift + X` | 删除线 |
| `` Cmd/Ctrl + ` `` | 行内代码 |
| `Cmd/Ctrl + Shift + T` | 切换主题 |
| `Cmd/Ctrl + /` | 切换源码模式 |
| `Cmd/Ctrl + Shift + F` | 工作区搜索 |

### 快速插入

| 快捷键 | 插入 |
|--------|------|
| `Cmd/Ctrl + 0` | 段落 |
| `Cmd/Ctrl + 1-6` | 标题 1-6 |
| `Alt + Cmd + -` | 分隔线 |
| `Alt + Cmd + C` | 代码块 |
| `Alt + Cmd + Q` | 引用 |
| `Shift + Cmd + T` | 表格 |
| `Alt + Cmd + M` | 数学公式块 |
| `Alt + Cmd + U` | 无序列表 |
| `Alt + Cmd + O` | 有序列表 |
| `Alt + Cmd + X` | 任务列表 |

### 代码块

| 快捷键 | 操作 |
|--------|------|
| `↓` | 退出代码块（向下） |
| `↑` | 退出代码块（向上） |
| `Backspace`（空代码块） | 删除代码块 |
| `Alt + 点击` | 添加光标 |

### 多光标编辑

| 快捷键 | 操作 |
|--------|------|
| `Alt + 点击` | 添加次光标 |
| `Alt + Shift + 点击` | 添加 range 次光标（按主光标位置作 anchor） |
| `Cmd/Ctrl + D` | 选下个匹配并加入多光标 |
| `Cmd/Ctrl + Shift + L` | 全选所有匹配加入多光标 |
| `Cmd/Ctrl + U` | 撤销最后一次光标添加 |
| `Esc` | 清空所有次光标（保留主光标） |

> 多光标状态下输入字符、Backspace、Delete、单行粘贴会自动 fan-out 到所有光标位置。表格 cell / CodeBlock / 只读视图不响应 Alt+Click。状态栏右下角显示「多光标 (N)」指示器。

### 列选择（Column Selection）

| 快捷键 | 操作 |
|--------|------|
| `Alt + 拖拽` | 拖出矩形选区,松开后展开为 N 个 range cursors |
| `Esc` | 中途取消拖动 / 清空已生成的列选 |
| 命令面板 「Add Column Selection」 | 键盘可访问入口:把当前选区向下扩展 3 行作演示 |

> 列选完成后立即与多光标共用 fan-out 链路:输入 / Backspace / Delete / 单行粘贴自动作用于每一行;Cmd+U 可撤销整个列选。表格 / 代码块 / 虚拟化隐藏块的行自动跳过,矩形高度若覆盖超过 64 行则静默截断并 console.warn。拖动中状态栏显示「列选」chip。

### Vim 模式（Cmd+. 切换）

| 快捷键 | 操作 |
|--------|------|
| `Cmd/Ctrl + .` | 全局开关 Vim 模式（持久化到 `AppConfig.vim_mode`） |
| `i` / `a` / `o` / `I` / `A` / `O` | 进入 INSERT 模式 |
| `v` / `V` / `Ctrl-V` | 进入可视模式（字符 / 行 / 块） |
| `Esc` / `Ctrl-C` | 退出 INSERT/VISUAL 回到 NORMAL |
| `h j k l` / `w b e` / `0 $ ^` / `gg G` / `f F t T {char}` / `{ } ( )` `%` `H M L` | motions |
| `d c y` + motion / text-object | operator + motion（`dw` 删单词,`ciw` 改内词,`di(` 删括号内） |
| `dd` / `cc` / `yy` | linewise operator（删/改/拷贝整行） |
| `x` / `r{char}` / `J` / `>>` / `<<` | 独立操作 |
| `:` `w` Enter | `:w` 保存 |
| `:` `q` Enter | `:q` 关闭（脏时拒绝） |
| `:` `w` `q` Enter | `:wq` 保存并关闭 |
| `:` `e` Enter | `:e` 从盘重载 |

> 状态栏右下角显示「NORMAL/INSERT/VISUAL/V-LINE/V-BLOCK」芯片 + count/operator 暂存区（如 `NORMAL│3d`）。V/Ctrl-V 直接复用 P2-3 列选择 plugin 的矩形计算，Vim 的 visual-block 可立即用 `A` 进入多光标追加输入。IME 合成期间所有键 pass-through；Alt+Click 在 NORMAL 模式被吞掉，在 INSERT 模式仍可用（P0-3 多光标）。

## 最近更新

- **P2-7 Vim 模式（Cmd+. 切换）** — 自研 mode FSM 落地（`prosemirror-vim` 2018 后未维护且不兼容 PM 17 / Tiptap 3）。`frontend/src/plugins/vim/` 新增 11 文件 ~2500 LOC（types/state/key-parser/motions/operators/text-objects/ex-commands/visual/commands/decorations/index）+ `frontend/src/extensions/editing/vim-extension.ts`（~100 LOC Tiptap 包装）+ 集成 8 处（editor.ts 注册 + App.svelte $state/onTransaction/setVimExContext + StatusBar.svelte mode 芯片 + commandRegistry + keymap.rs `CmdOrCtrl+.` + config.rs `vim_mode: bool` + i18n 三语各 +10 key）。6 种 mode × 18 motions × 3 operators × 10+ text objects × 4 ex 命令（`:w`/`:q`/`:wq`/`:e`）；V/Ctrl-V 直接 dispatch 到 P2-3 列选择 plugin 复用矩形计算与多光标 fan-out；状态栏 mode 芯片 + count/operator 暂存区（`NORMAL│3d`）；IME 合成 pass-through；yank 寄存器 V1 填充不读（V2）。`npx tsx scripts/validate-vim.ts` 59/59 通过 + 多光标 15/15 + 列选 20/20 + 撤销树 36/36 全部无回归。详见 [docs/FEATURES.md](./docs/FEATURES.md)
- **P2-3 列选择（Column Selection）** — 自研 Alt+Drag 矩形选区落地。`frontend/src/plugins/multi-cursor/column-select.ts`（~370 行）+ `rect-types.ts`(~60 行)新增 2 文件,集成 6 处(editor.ts 插件注册 + App.svelte 派发 + StatusBar chip + app.css overlay + commandRegistry + 2 个 i18n key × 3 语言)。矩形按线高扫描展开为 N 个 range cursors,直接复用 P0-3 多光标的 fan-out / 装饰 / 撤销链路,零新增编辑代码。表格 / 代码块 / 虚拟化块跳过,3px 阈值下降级为单点 Alt+Click,64 行上限。`npx tsx scripts/validate-column-select.ts` 20/20 通过,多光标 15/15 无回归,cargo 110/110 通过。详见 [docs/FEATURES.md](./docs/FEATURES.md)
- **P0-3 真正多光标编辑（Multi-Cursor）** — 自研多光标 plugin 7 文件落地（`frontend/src/plugins/multi-cursor/`）。Alt+Click 加光标、Cmd+D 选下个匹配、Cmd+Shift+L 全选匹配、Cmd+U 撤销、Esc 清空；输入/Backspace/单行粘贴自动 fan-out；状态栏显示「多光标 (N)」；4 处键位注册 + 4 条 i18n key（en/zh-CN/ja）；15/15 单元测试通过。详见 [docs/FEATURES.md](./docs/FEATURES.md)
- **多根工作区 (P2-4)** — 工作区支持多根目录，根切换 pill、跨根搜索/书签、Tab 持久化含 root_id；命令 `file.set_active_workspace_root`
- **文档化整改** — 23+ 项已实现功能从 COMPETITOR_TODO.md 下沉到 [docs/FEATURES.md](./docs/FEATURES.md)，README 与实现状态完全对齐
- **P1-8 PNG 图片导出** — File ▸ Export ▸ PNG 一键导出当前文档为 PNG 长图，主题跟随编辑器，KaTeX/Mermaid/代码高亮/workspace 图片自动保留。零 Rust 新渲染依赖，复用 `image 0.25` 校验字节流
- **P2-6 顶层块虚拟化** — 文档 >200 顶层块时自动启用视口虚拟化，浏览器原生 `content-visibility: auto` 跳过 off-screen 块，1k 块文档预期首屏 < 200ms、滚动 FPS > 50
- **拖拽 bugfix** — 修复文件拖拽相关问题
- **文件重命名/渲染 bug 修复** — 修复文件操作和渲染问题
- **Git 文件状态色值处理** — 目录树显示 Git 状态颜色
- **更新文件 bug 修复** — 改善文件更新逻辑
- **粘贴 bug 修复** — 修复图片粘贴问题
- **目录结构调整** — 优化项目结构
- **渲染方案调整** — 优化即时渲染性能

## 其他命令

```bash
# 前端类型检查
cd frontend && npm run check

# Rust 编译检查
cargo check --workspace

# Rust 测试
cargo test --workspace
```

## 已知限制

- PDF 导出使用硬编码的 macOS 字体路径，跨平台需修复
- PNG 导出依赖编辑器实例存在（离屏 DOM 快照），空文档/无 ProseMirror 时跳过
- 部分主题仅有 CSS 实现（完整 6 主题支持进行中）

## 许可证

MIT