# AGENTS.md — plugins/ ProseMirror 插件

## 目录

| 文件 | 说明 |
|------|------|
| `instant-render.ts` | Typora 风格即时渲染 |
| `search.ts` | 搜索高亮 + 位置映射 |
| `multi-cursor.ts` | Alt+Click 多光标编辑 |
| `spellcheck.ts` | 拼写检查（红波浪线 Decoration + 500ms 防抖 + IPC） |
| `virtualization/` | 顶层块虚拟化（COMPETITOR_TODO P2-6） |
| `virtualization/types.ts` | TopBlockMeta / VirtualizationConfig 共享类型 |
| `virtualization/height-estimator.ts` | 节点类型 → 像素估算 + DOM 实测 |
| `virtualization/enumerate.ts` | 顶层块枚举 + offsetTop 累计 |
