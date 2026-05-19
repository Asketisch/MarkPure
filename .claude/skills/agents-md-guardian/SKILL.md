---
name: agents-md-guardian
description: Use when source files or directories are created, deleted, renamed, moved, or when public functions/exports are added or removed. Maintains hierarchical AGENTS.md navigation files. Do NOT use for content-only edits that don't change file structure or public API.
---

# AGENTS.md 层级维护

## 概述

维护三级 AGENTS.md 导航体系，为 AI 代理提供代码链路图。每层只索引直接子项，叶子级需列出文件的主要函数及功能。

## 何时触发

| 操作 | 动作 |
|------|------|
| 新建源文件 | 在所在目录 AGENTS.md 添加文件条目（含主要函数） |
| 删除源文件 | 从所在目录 AGENTS.md 移除该文件条目 |
| 重命名源文件 | 更新文件名和说明 |
| 新增/删除/重命名 pub 函数或导出 | 更新对应文件条目的函数列表 |
| 新建目录（含源文件） | 创建该目录 AGENTS.md + 在父级添加导航条目 |
| 删除目录 | 删除该目录 AGENTS.md + 从父级移除导航条目 |
| 重命名目录 | 更新标题 + 更新父级链接 |
| 纯内容修改（不改文件名/公开 API） | **不触发** |

**沿链上溯**：变更后检查父级 AGENTS.md 是否需要同步更新（直到根）。

## 三级格式

### 根级（项目根目录）

```markdown
# AGENTS.md — {项目名} 项目导航

## 概述

本文档是项目代码结构的导航入口，按层级引导 AI 理解代码。

更多信息请阅读 [CLAUDE.md](./CLAUDE.md)。

---

## 一级导航

| 目录 | 说明 |
|------|------|
| [`{path}/`](./{path}/AGENTS.md) | {一句话说明} |
```

### 导航级（含子目录的中间目录）

```markdown
# AGENTS.md — {目录名} {功能描述}

## 一级导航

| 目录 | 说明 |
|------|------|
| [`{subdir}/`](./{subdir}/AGENTS.md) | {一句话说明} |
```

### 叶子级（只含源文件的目录）

```markdown
# AGENTS.md — {目录路径} {功能描述}

## 文件

### `{filename}` — {文件功能一句话}

- `{funcName}({params})` — {功能描述}
- `{StructName}` — {结构体/类型说明}
```

## 叶子级函数索引规则

1. **只列公开 API**：Rust 列 `pub fn`/`pub struct`；TypeScript 列 `export` 的函数/类/类型；Svelte 列组件 props 和关键方法
2. **每文件 ≤10 个条目**：超出时只列最重要的，末尾加 `- ...（其余 N 个内部函数）`
3. **描述极简**：每条 ≤ 20 个汉字（或 40 英文字符）
4. **参数简写**：只写参数名，不写类型（如 `read_file(path)` 而非 `read_file(path: &str)`）
5. **struct/enum 作为条目**：重要数据结构也要列出（如 `FileEntry` — 目录项结构体）

## 混合目录处理

如果目录同时包含子目录（有 AGENTS.md）和源文件：

```markdown
# AGENTS.md — {目录} {功能}

## 子目录

| 目录 | 说明 |
|------|------|
| [`{subdir}/`](./{subdir}/AGENTS.md) | {说明} |

## 文件

### `{filename}` — {功能}

- `{func}()` — {说明}
```

## 不纳入的目录

- `node_modules/`、`target/`、`dist/`（构建产物）
- `.git/`、`.claude/`（工具配置）
- `resources/`、`public/`（静态资源）
- 只有 `mod.rs` 或 `index.ts` 重导出的 `src/` 子目录（父级已覆盖）

## 反模式

- 说明超过 20 个汉字 — 截断，AGENTS.md 是索引不是文档
- 列出私有/内部函数 — 只列公开 API
- 跨级索引（根级直接列文件） — 每层只索引直接子项
- 忘记上溯更新父级 — 新建目录必须在父级添加链接
- 为空目录或只有配置文件的目录创建 AGENTS.md — 没有源码不需要索引
