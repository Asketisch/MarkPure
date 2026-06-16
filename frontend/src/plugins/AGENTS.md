# AGENTS.md — plugins/ ProseMirror 插件

## 目录

| 文件 | 说明 |
|------|------|
| `instant-render.ts` | Typora 风格即时渲染 |
| `search.ts` | 搜索高亮 + 位置映射 |
| `multi-cursor.ts` | ~~Alt+Click 多光标编辑（已重构为目录）~~ |
| `multi-cursor/` | 真正多光标编辑（COMPETITOR_TODO P0-3）：Alt+Click 加光标、Cmd+D 加下个匹配、Cmd+Shift+L 全选、Cmd+U 撤销、Esc 清空 |

### `multi-cursor/` 子目录结构

| 文件 | 行数 | 说明 |
|------|------|------|
| `types.ts` | ~80 | `Cursor` / `MultiCursorState` / `MultiCursorMeta` 类型 + `MAX_CURSORS=64` + `multiCursorPluginKey` 单例 |
| `state.ts` | ~150 | 纯函数 reducer：`addCursorToList` / `normalize` / `applyMultiCursorMeta`（set/clear/preserve/undoLast 四种 meta） |
| `find-occurrence.ts` | ~110 | 复用 `select-same-word` 的位置空间搜索：`findNextOccurrence` / `findNextForCursors` / `findAllOccurrences` |
| `decorations.ts` | ~75 | 次光标 `DecorationSet` 构造（widget 竖线 + range 选区高亮 + 闪烁 class 切换） |
| `input-handler.ts` | ~165 | `handleTextInput` / `handleMultiCursorKeyDown` fan-out + 1s 闪烁 timer |
| `commands.ts` | ~180 | Tiptap command 实现：`addCursor` / `selectNextMatch` / `selectAllMatches` / `undoLastCursor` / `clearMultiCursors` / `currentNeedle` |
| `index.ts` | ~80 | `createMultiCursorPlugin` 入口（Plugin 工厂 + handleDOMEvents.mousedown） |
| `rect-types.ts` | ~60 | **P2-3** 列选择类型：`Rect` / `ViewportPoint` / `ColumnSelectState` / `ColumnSelectMeta` + `columnSelectPluginKey` 单例 + `DRAG_THRESHOLD_PX=3` |
| `column-select.ts` | ~370 | **P2-3** Alt+Drag 列选择插件：`createColumnSelectPlugin`（必须先于 multi-cursor 注册）+ 拖动状态机 + `flattenRectToCursors` 纯几何算法 + `isInsideAtomicBlock` 表格/代码块拒绝 + `estimateLineHeight` + overlay 绘制 |
| `spellcheck.ts` | 拼写检查（红波浪线 Decoration + 500ms 防抖 + IPC） |
| `virtualization/` | 顶层块虚拟化（COMPETITOR_TODO P2-6） |
| `virtualization/types.ts` | TopBlockMeta / VirtualizationConfig 共享类型 |
| `virtualization/height-estimator.ts` | 节点类型 → 像素估算 + DOM 实测 |
| `virtualization/enumerate.ts` | 顶层块枚举 + offsetTop 累计 |
