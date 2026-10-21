# AGENTS.md — MarkPure 项目导航

## 概述

本文档是项目代码结构的导航入口，按层级引导 AI 理解代码。

**核心原则**：前端仅负责渲染和 UI 交互，所有功能性操作必须通过 IPC 委托给 Rust 后端执行。

更多信息请阅读 [CLAUDE.md](./CLAUDE.md)。

---

## 一级导航

| 目录 | 说明 |
|------|------|
| [`frontend/src/`](./frontend/src/AGENTS.md) | Svelte 5 前端 |
| [`backend/apps/desktop/`](./backend/apps/desktop/AGENTS.md) | Rust 桌面应用 |
| [`backend/crates/`](./backend/crates/AGENTS.md) | Rust 工具库 |

---

## 测试

| 命令 | 覆盖范围 |
|------|----------|
| `python3 scripts/test_backend.py` | 全部后端 IPC 命令（经 `mt_harness` 驱动真实处理器） |
| `npx tsx scripts/validate-markdown-roundtrip.ts` | 显示层的 Markdown 往返 + 全仓库文档语料扫描 |
| `npx tsx scripts/validate-markdown-normalize.ts` | 列表续行缩进归一化 |
| `npx tsx scripts/validate-file-format.ts` | 保存时的存储格式保真（真实前端 → 真实 Rust handler） |
| `npx tsx scripts/validate-layout.ts` | 显示层布局（无头 Chrome + CDP 几何断言） |
| `npx tsx scripts/validate-interactions.ts` | 显示层面板类交互（真实按键 / 鼠标事件） |
| `npx tsx scripts/validate-editing.ts` | 显示层编辑类交互（拖拽 / 下拉 / 勾选 / 补全） |
| `npx tsx scripts/validate-features.ts` | 显示层功能链路（命令面板 / 书签 / 搜索 / 拼写） |
| `npx tsx scripts/validate-fuzz.ts` | Markdown 解析 / 序列化的随机化回归 |
| `npx tsx scripts/validate-file-watch.ts` | 文件监视链路（外部修改 → 刷新 / 询问） |
| `cargo test --workspace` | Rust 单元测试 |
| `npm run check` | 前端类型检查 |
| `npm test` | 以上全部（前端 15 个既有验证脚本也包含在内） |

浏览器端回归：用 `npx vite preview --port 4173` 起**生产构建**（附带
`/__ipc` 桥，把浏览器 IPC 转发到 `mt_harness`），即可在浏览器里驱动
真实后端。

`scripts/validate-file-format.ts` 值得特别一提：它 import 的是仓库里
**真正的**前端命令模块（用 `window.ipc` 桩截获载荷），再把捕获到的
载荷**原样**喂给 `mt_harness` 的真实 handler，最后检查磁盘字节。
这样「前端传的格式」与「后端写盘的格式」在同一条链路上被验证——
前端漏传 `encoding`、或后端不认这个编码，都会立刻失败。

`scripts/validate-layout.ts` 补的是另一类盲区：**显示层布局**。
`1568ffc` 那次组件拆分丢了包裹编辑器视图的 `.editor-panel` 列容器，
`.main-area`（flex row）于是把标签栏 / 工具栏 / 编辑区 / 状态栏
排成了一行——编辑器被挤成一条缝。后端 IPC 测试与纯函数测试都抓不到
这类问题，手测又容易用窄视口而错过。该脚本用无头 Chrome（CDP）
打开生产构建，在 1280 / 1900 / 2560 三个视口下断言 DOM 结构与几何，
并额外覆盖：

- **大纲面板位置**——必须在编辑器**右侧**（它在 DOM 里先于编辑器渲染，
  靠 `order` 规则纠正）
- **禅模式**——chrome 全部不可见，编辑区宽度 = 820px 阅读宽度且居中
- **分屏视图**——两个面板都在，且宽度都 ≥ 容器的 20%
- **富内容**（宽表格 / 代码块 / 图片 / 任务列表 / 公式）——每种块
  真的渲染出来了，且**没有把布局撑破**：编辑区宽度仍等于编辑器面板
  宽度，页面不出现横向滚动条（宽表格只应在编辑区内部滚动）

没有 Chrome 时它会跳过而不是失败。

> 断言选择器随 Tiptap 版本变化：v3 的任务列表渲染成
> `<ul data-type="taskList"><li data-checked="false">`，
> **不是**老版本的 `li[data-type="taskItem"]`。

`scripts/validate-interactions.ts` 覆盖**交互**——静态 DOM 与纯函数测试
都测不到的部分。它用 CDP 派发真实按键与鼠标事件，断言查找替换、
快速插入、命令面板、工作区搜索、另存为、撤销/重做、大纲跳转、
表格列宽拖拽柄、图片缩放柄、代码块语言选择器。

`scripts/validate-editing.ts` 覆盖**直接操作文档内容**的交互：表格列宽
拖拽、图片缩放拖拽、代码块语言切换、任务列表勾选、链接自动补全。

`scripts/validate-features.ts` 覆盖**跨组件的完整链路**：命令面板执行
命令 → 书签面板打开、书签增删、工作区搜索出结果并导航、拼写检查标记
与右键菜单、图片宽度「拖拽 → 保存 → 重新打开」端到端保持。

两个脚本和 `scripts/lib/browser-harness.ts` 共用一套设施：生产构建 →
preview 服务（带 IPC 桥）→ 无头 Chrome。共用部分抽在 `lib/` 下，
不要在两个脚本里各写一份 CDP 客户端。

> 快捷键断言要用**大写**字母（`pressKey('P', ['Meta','Shift'])`）：
> 按住 Shift 时真实浏览器的 `KeyboardEvent.key` 是大写，
> 应用侧必须 `e.key.toLowerCase()` 才能匹配到。

`scripts/validate-markdown-roundtrip.ts` 里的**语料扫描**值得特别
一提：它把仓库里所有 `.md` 逐个解析、用真实 schema 校验、再往返一遍。
这类扫描能一次性抓出「某个块级语法没有 markdown 钩子」「节点没
有声明 `group`」「列表续行缩进被弄坏」等单条用例想不到的问题。

---

## 真实桌面应用测试

浏览器 harness 覆盖的是**前端逻辑**，绕开了整个原生壳：原生菜单、
原生文件对话框、事件循环驱动的文件监视、`mt://` 协议、真实剪贴板……
这些路径在浏览器里根本不存在。WKWebView 的 AX 树是空的，AppleScript
读不到控件，所以只能靠**截图 + 坐标点击**驱动。

`scripts/app_drive.py` 就是干这个的：

```bash
python3 scripts/app_drive.py launch          # 启动应用（隔离配置目录 + 测试工作区）
python3 scripts/app_drive.py probe           # 打印窗口几何
python3 scripts/app_drive.py shot out.png    # 截图
python3 scripts/app_drive.py click 640 400 d # 点击（d = 截图显示坐标）
python3 scripts/app_drive.py key cmd+shift+p # 按键
python3 scripts/app_drive.py text "中文"      # 粘贴文字（走剪贴板，中文可靠）
```

坐标有两种：`d` 表示坐标取自**截图**（显示宽度 2000），脚本会按屏幕
逻辑宽度换算成逻辑点；不带 `d` 则直接是逻辑点。

点击必须**先移动再按下再抬起**（带真实间隔）——三个事件在同一瞬间投递
时，AppKit 的按钮不响应（事件时间戳相同会被当成零时长的点击）。

这套办法抓到的缺陷，浏览器 harness 一个都测不到：

- **文件监视事件是 JSON 字符串，前端却当数组用** —— 已打开的文档在外部
  被修改后**永不刷新**、也不弹「文件已外部修改」提示。浏览器桥传的是
  真数组，因此掩盖了它。
- **⌘P 快速切换器无限循环** —— `loadFiles()` 读的 `loading` 成了
  `$effect` 的依赖，「加载完成 → 置 false → effect 重跑 → 再次加载」
  自我循环。面板永远停在「加载中…」，应用持续占用 **54% CPU**。
- **菜单里直接显示内部命令 ID**（`cmd.file.add_workspace_root`）——
  翻译表里缺 key。
- **原生保存面板停留超 30 秒被误报为「导出失败」**—— IPC 默认超时比
  用户在面板上停留的时间短。
- **配置里写 CSS class 名（`theme = "theme-dark"`）会让整份配置作废** ——
  `ThemeId` 的 serde 只认枚举名，而文档与 `cmd_set_config` 都以 CSS
  class 名为准。用户照文档手改配置 → TOML 解析失败 → **工作区根、
  最近文件、界面语言全部回退默认值**，界面上却毫无提示。
- **配置损坏时用户看不到任何提示** —— 只有 stderr 一行。现在启动会弹
  「Configuration Problem」对话框，说明原文件保留在
  `config.toml.broken`。

### 真实应用测试的三个坑

按坐标点击时容易把「应用没反应」误判成缺陷，实际是测试方法的问题：

1. **编辑器失焦**：从命令面板/菜单触发编辑命令时，编辑器已经失焦，
   ProseMirror 撤销的会是**选区变化**而不是文本编辑——看起来像
   「撤销无效」，其实是撤销了一步看不见的东西。
2. **输入法**：系统是中文输入法时，敲字母会进拼音组字状态（候选框
   弹出），字母根本没进文档。**用剪贴板粘贴**代替按键输入。
3. **窗口遮挡**：别的应用盖在 MarkPure 上面时，点击会落到别人身上。
   `app_drive.py` 的 `click` 会先 `activate()` 置前台；但 `shot` 不能
   这么做——失焦会关掉自绘菜单（下拉、弹出层），所以 `shot` 默认不
   置前台，需要时用 `shot <path> front`。

---

## 导出保真度

`scripts/test_backend.py::TestExportFidelity` 端到端验证 HTML / Word /
PDF 三种导出的**内容**保真度——不只是「文件生成了」。它抓出过的缺陷：

| 缺陷 | 根因 |
|------|------|
| HTML 导出的图片 alt 全丢，alt 文本跑到图片外面 | 渲染管线**逐事件**调用 `push_html`，writer 状态被反复重置（必须成段渲染） |
| HTML 导出的图片丢失 `{width=300}` 扩展语法 | pulldown-cmark 不认识自研语法，需渲染后正则还原 |
| HTML 导出的脚注定义出现两遍 | 定义位置内联输出一次，文末 section 又输出一次 |
| Word 导出的表格降级成段落 | `word.rs` 是手写行级解析器，不支持表格 |
| **PDF 导出丢掉全部中文** | 拉丁字体（Helvetica）不含 CJK 字形，中文渲染成空白 |

PDF 文本用 `scripts/lib/pdf_extract.py` 提取——PDF 里的文字是 CID 编码，
必须靠字体自带的 `ToUnicode` CMap 才能还原成可读文本。这个提取器同时
用来断言**码位正确**：CJK 字体里「一」和康熙部首「⼀」共用同一个字形，
PDF 的 `ToUnicode` 只能选一个码位，选错就有 30% 的常用汉字复制出来变成
兼容码位（`pdf/font_file.rs` 的稳定性检查会跳过这类字体）。

细节见 [`backend/crates/export/AGENTS.md`](./backend/crates/export/AGENTS.md)。

