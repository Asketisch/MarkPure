# AGENTS.md — ProseMirror 插件

ProseMirror 插件实现编辑器的核心行为逻辑（状态管理 + 装饰计算），对应的 Tiptap 扩展（`extensions/` 目录）仅负责注册。

## instant-render.ts — Typora 风格即时渲染

光标附近显示 Markdown 语法标记（`**`、`*`、`` ` ``、`~~`、`==`、`#`、`>`），远离时隐藏。

### 状态结构

```typescript
interface InstantRenderState {
  enabled: boolean           // 开关
  cursorPos: number          // 当前光标位置
  decorations: DecorationSet // 缓存的装饰集
}
```

### 性能关键：增量装饰更新

装饰集缓存在插件 state 中（不在 `props.decorations` 中重算），更新策略：

| 事件 | 行为 |
|------|------|
| 光标移动（无文档变更） | 增量更新：`findAffectedRange` 找到旧/新光标所在的顶层块 → 仅对这些块重新计算装饰 |
| 文档变更 | 全量重建：`computeSyntaxDecorations(doc, cursorPos)` |
| 开关切换 | 全量重建或清空 |

核心函数：
- `findAffectedRange(doc, cursorPos)` — 找到包含光标的顶层块节点范围 `{from, to}`
- `decorateNode(node, pos, cursorPos, decorations)` — 为单个节点生成装饰
- `isNearCursor(from, to, cursorPos, threshold=2)` — 判断位置是否在光标附近

### 支持的语法标记

| 节点/标记 | 装饰类型 | 近处 class | 远处 class |
|----------|---------|-----------|-----------|
| heading | Node decoration | `mw-heading-show-prefix` | `mw-heading-hide-prefix` |
| blockquote | Node decoration | `mw-blockquote-show-prefix` | `mw-blockquote-hide-prefix` |
| bold / italic / strike / code / highlight | Widget decoration (前后缀) | `mw-syntax-visible` | `mw-syntax-hidden` |

### 导出

- `createInstantRenderPlugin()` — 创建插件实例
- `toggleInstantRender(view)` — 切换开关
- `instantRenderPluginKey` — 插件 key

## search.ts — 搜索替换

全文搜索高亮 + 当前匹配高亮 + 替换功能。

### 状态结构

```typescript
interface SearchState {
  query: string
  caseSensitive: boolean
  wholeWord: boolean
  useRegex: boolean
  matches: Array<{ from: number; to: number }>  // 文档位置
  currentIndex: number
  decorations: DecorationSet
}
```

### 搜索流程

1. `updateSearch(view, query, options)` 触发 `setQuery` meta
2. `getDocText(doc)` 使用 `doc.textBetween()` 提取纯文本 + 构建位置映射（`posMap: number[]`，文本索引→文档位置）
3. `findMatches()` 用 regex 在纯文本上搜索，通过 posMap 映射回文档位置
4. `buildDecorations()` 为每个匹配创建 inline decoration

### 文档变更处理

文档变更时（`tr.docChanged && prev.query`），自动重新执行搜索以刷新匹配位置。

### 导出

- `createSearchPlugin()` — 创建插件实例
- `updateSearch(view, query, options)` — 设置搜索词
- `findNext(view)` / `findPrev(view)` — 跳转到下一个/上一个匹配
- `replaceMatch(view, replacement)` — 替换当前匹配
- `replaceAll(view, replacement)` — 替换所有（从后往前，避免位置偏移）
- `clearSearch(view)` — 清除搜索
- `getSearchState(view)` — 获取当前搜索状态
- `searchPluginKey` — 插件 key
