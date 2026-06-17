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
| `undo-tree/` | **P0-8** 分支式撤销树（COMPETITOR_TODO P0-8）：与 PM history 并行运行，docJson 快照 + 父子指针 + `currentId` 指针 + 50 节点 LRU 上限 |
| `virtualization/` | 顶层块虚拟化（COMPETITOR_TODO P2-6） |
| `virtualization/types.ts` | TopBlockMeta / VirtualizationConfig 共享类型 |
| `virtualization/height-estimator.ts` | 节点类型 → 像素估算 + DOM 实测 |
| `virtualization/enumerate.ts` | 顶层块枚举 + offsetTop 累计 |

### `undo-tree/` 子目录结构（P0-8）

| 文件 | 行数 | 说明 |
|------|------|------|
| `types.ts` | ~70 | `BranchNode` / `UndoTreeState` / `UndoTreeMeta`（append/switch/prune/label/collapse 五种 meta）+ `undoTreePluginKey` 单例 + `MAX_NODES_DEFAULT=50` + `THROTTLE_MS=1000` |
| `state.ts` | ~290 | 纯函数 reducer：`initState` / `applyAppend`（含 1s 节流 + chain 语义）/ `applySwitch`（含路径截断）/ `applyPrune`（拒绝 root/current/ancestor）/ `applyLabel` / `applyCollapse` + `gcLRU`（仅剪除非 current 叶） |
| `tree-utils.ts` | ~150 | 树遍历工具：`getNode` / `getParent` / `getChildren` / `isAncestor` / `walkToRoot` / `findLCA` / `getPathTo` / `collectSubtree` / `nodeTextPreview` |
| `commands.ts` | ~115 | Tiptap 命令：`undoToBranch` / `labelBranch` / `pruneBranch` / `collapseSubtree` / `goToParent` / `goToChild`（全部走 `tr.setMeta(undoTreePluginKey, ...)`） |
| `decorations.ts` | ~20 | 装饰占位（面板驱动 DOM，装饰保留给未来的"编辑点 gutter 标记"用） |
| `index.ts` | ~85 | 公开导出 + `createUndoTreePlugin` 入口（Plugin 工厂 + `apply` reducer 按 meta.type 分发 + 默认 `append` 捕获 docChanged） |
