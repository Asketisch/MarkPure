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