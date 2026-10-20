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
| `cargo test --workspace` | Rust 单元测试 |
| `npm run check` | 前端类型检查 |
| `npm test` | 以上全部（前端 10 个既有验证脚本也包含在内） |

浏览器端回归：用 `npx vite preview --port 4173` 起**生产构建**（附带
`/__ipc` 桥，把浏览器 IPC 转发到 `mt_harness`），即可在浏览器里驱动
真实后端。

`scripts/validate-file-format.ts` 值得特别一提：它 import 的是仓库里
**真正的**前端命令模块（用 `window.ipc` 桩截获载荷），再把捕获到的
载荷**原样**喂给 `mt_harness` 的真实 handler，最后检查磁盘字节。
这样「前端传的格式」与「后端写盘的格式」在同一条链路上被验证——
前端漏传 `encoding`、或后端不认这个编码，都会立刻失败。

`scripts/validate-markdown-roundtrip.ts` 里的**语料扫描**值得特别
一提：它把仓库里所有 `.md` 逐个解析、用真实 schema 校验、再往返一遍。
这类扫描能一次性抓出「某个块级语法没有 markdown 钩子」「节点没
有声明 `group`」「列表续行缩进被弄坏」等单条用例想不到的问题。

