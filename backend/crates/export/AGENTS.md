# AGENTS.md — export/ 导出功能

## 目录

| 文件 | 说明 |
|------|------|
| `html.rs` | export_html（接受 `theme_css: Option<&str>`） |
| `pdf/mod.rs` | PDF 导出门面（`export_pdf`），公开 API 入口 |
| `pdf/orchestration.rs` | 行级调度器 + 字体/页面布局（最大的文件，~470 行） |
| `pdf/images.rs` | 内联图片提取 + 字节加载 |
| `pdf/table.rs` | Markdown 表格解析与渲染（`is_table_row` / `render_table_row` 等） |
| `pdf/strip.rs` | Markdown → plain text 剥离 + 脚注引用替换 |
| `pdf/fonts.rs` | 平台字体路径解析（拉丁 + CJK 候选与筛选） |
| `pdf/font_file.rs` | 字体文件解析：度量、字形反向映射、码位稳定性检查 |
| `pdf/text.rs` | 混排文本渲染：按脚本切段，中文用 CJK 字体绘制 |
| `pdf/wrap.rs` | CJK 感知的 `wrap_text` 换行 |
| `png.rs` | export_png_save（P1-8，前端 html-to-image 字节流校验+写盘） |
| `word.rs` | export_word (DOCX, zip) |

PDF 拆分的动机：原 `pdf.rs` 是 775 行的单体，包含编排（页面布局、字体、
行级 dispatch）和三类特性（图片、表格、Markdown 剥离）混在一起。拆分后
每类特性的变更局限在一个 80-150 行的子模块中，编排文件保持可读。

## PDF 字体与 CJK 支持

拉丁字体（macOS Helvetica / Windows Arial / Linux DejaVu）**不含 CJK
字形**。用它们渲染中文只会得到空白——这是曾经 PDF 导出「整篇中文消失」
的根因。现在的做法：

1. **按脚本切段**（`pdf/text.rs`）：一行文本拆成 CJK 段与拉丁段，段之间
   按各字体的**实际步进宽度**累加横坐标，因此中英混排不会重叠或留缝。
2. **CJK 字体按需加载**：只有文档含 CJK 字符时才加载（`FontSet::load`
   的 `needs_cjk` 参数），避免为一个用不上的字体付出解析与嵌入代价。
3. **字体子集化**（printpdf 的 `font_subsetting` 特性）：只嵌入文档真正
   用到的字形。没有它，一个 PDF 会带上整个字体文件——Helvetica 就让每个
   PDF 变成 4.8 MB，CJK 字体更是超过 20 MB。开启后同一份文档约 30-90 KB。
4. **码位稳定性筛选**（`pdf/font_file.rs` + `pdf/fonts.rs`）：CJK 字体里
   「一」和康熙部首「⼀」共用同一个字形，PDF 的 `ToUnicode` 只能选一个
   码位。实测 STHeiti / Hiragino 有 **30% 的常用汉字**被写成兼容码位
   （复制出来变成「⼀」，搜索也匹配不上）。因此加载 CJK 字体前先按
   `printpdf` 的同一套算法算出反向映射，检查常用汉字是否原样保留；
   不合格的候选直接跳过，换下一个（Arial Unicode 合格）。

平台 CJK 字体候选见 `pdf/fonts.rs::cjk_font_candidates`。

## 导出还原度测试

`scripts/test_backend.py::TestExportFidelity` 端到端验证三种导出的内容
保真度（HTML 结构 / 图片 alt 与宽度 / 表格 / 脚注 / 中文，Word 真表格 /
标题 / 代码块 / 中文，PDF 文本与码位）。PDF 文本用
`scripts/lib/pdf_extract.py` 提取——PDF 里的文字是 CID 编码，必须靠字体
自带的 `ToUnicode` CMap 才能还原成可读文本。
