# AGENTS.md — extensions/editing/ 编辑增强

## 目录

| 文件 | 说明 |
|------|------|
| `auto-close-extension.ts` | 自动闭合括号/引号 |
| `tag-extension.ts` | #tag 语法支持 |
| `wikilink-extension.ts` | [[wikilink]] 语法支持 |
| `search-extension.ts` | 搜索高亮 |
| `select-same-word-extension.ts` | 选择同一单词（Mod-d 调 `selectNextMatch`，Mod-Shift-L 调 `selectAllMatches`，P0-3 集成多光标） |
| `undo-tree-extension.ts` | **P0-8** 真正的分支式撤销树（替代原 247 行 snapshot 桩）：Tiptap `Extension.create` 包装 `createUndoTreePlugin`，新增 6 个命令（`undoToBranch` / `labelBranch` / `pruneBranch` / `collapseSubtree` / `goToParent` / `goToChild`），通过 `tr.setMeta(undoTreePluginKey, ...)` 派发到 `frontend/src/plugins/undo-tree/state.ts` 的 reducer |
| `spellcheck-extension.ts` | 拼写检查 Tiptap 包装（recheckSpelling 命令） |
