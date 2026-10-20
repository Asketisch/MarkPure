# AGENTS.md — extensions/blocks/ 块级扩展

## 目录

| 文件 | 说明 |
|------|------|
| `code-block-cm-extension.ts` | CodeMirror 6 代码块节点（语言包按需加载） |
| `frontmatter-extension.ts` | YAML frontmatter 块（`---…---` 往返） |
| `math-extension.ts` | KaTeX 数学公式（块级 `$$…$$` / 行内 `$…$`，KaTeX 按需加载） |
| `drop-handler-extension.ts` | 拖拽文件/图片处理 |
| `paste-handler-extension.ts` | 智能粘贴处理 |
| `quick-insert-extension.ts` | `@` / `/` 快速插入触发 |
| `cm-theme.ts` | CodeMirror 主题 |

## Markdown 往返钩子

凡是**块级语法**（代码围栏、frontmatter 围栏、`$$…$$`）都必须自带
`markdownTokenizer` + `parseMarkdown` + `renderMarkdown`。`@tiptap/markdown`
靠扩展上的这些钩子来认领 marked 的 token——没有钩子的语法会被**静默
丢弃**（打开时看不到，保存时原文就没了）。

块级与行级 tokenizer 必须成对：只有行级 `$…$` 而没有块级 `$$…$$` 时，
marked 会把 `$$…$$` 当段落，行级正则匹配不上便在同一位置反复重试，
最终抛 “Infinite loop on byte” 或把页面卡死。

## 节点必须在 `block` / `inline` 组里

**自定义块级节点必须声明 `group: 'block'`**（行内则是 `group: 'inline'`）。
漏掉它不会立刻报错——节点照样能渲染——但它**无法作为文档的直接子
节点**，于是**任何包含该语法的文档都是非法文档**，ProseMirror 会在
每次事务里抛：

```
Called contentMatchAt on a node with invalid content
```

这类问题只有用真实 schema 校验解析结果才能发现（见
`scripts/validate-markdown-roundtrip.ts` 里的 `assertValidDocument`），
纯文本往返测试是看不出来的。

## 节点视图的 DOM 会被 ProseMirror 解析

节点视图自己往 DOM 里写内容（公式渲染、代码高亮）时，必须
`ignoreMutation: () => true`，否则 ProseMirror 的 DOM 变更处理器会
拿这段 DOM 重新解析——对叶子节点来说那必然是非法内容。

## 行内 `code` 标记

项目内用的是**放宽版**（`frontend/src/editor/editor.ts` 的 `CODE_MARK`），
两处偏离上游默认值，都是为了不丢内容：

- `excludes: ''` —— 上游默认排斥一切其它标记，于是
  `` [`code`](url) `` 会产生 `link,code` 这种非法标记组合，
  **整篇文档变成非法文档**。
- 序列化时按内容决定分隔符：内容**中间**含反引号就用**双反引号**
  包裹（上游固定用单反引号，会把 `a ` b` 这类内容写坏）。渲染时
  拿不到真实文字（序列化器传的是占位符），所以这个判断是在
  **解析时**记进标记属性的。

  已知限制：marked 的行内代码正则要求内容**首尾都不是反引号**，
  因此内容以反引号开头/结尾的代码段（`` `a` `` 这种写法）marked
  本身就解析不了——那是上游的限制，不在��里修。

## marked 的全局实例会被反复注册

`@tiptap/markdown` 的 MarkdownManager 构造时会把各扩展的 tokenizer
注册到 **marked 的全局实例**上。每打开一个文件就新建一个编辑器，
全局实例上的扩展就多一份，解析越来越慢（实测 154KB 文档：
第 1 个编辑器 143ms → 第 6 个 736ms）。

`createEditor` 里在创建编辑器**之前**会调用 `resetMarkedExtensions()`
清空这些数组，详见该函数注释。


