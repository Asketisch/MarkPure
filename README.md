# MarkPure

<div align="center">

[![CI](https://github.com/Demon1019/MarkPure/actions/workflows/ci.yml/badge.svg)](https://github.com/Demon1019/MarkPure/actions/workflows/ci.yml)
[![Release](https://github.com/Demon1019/MarkPure/actions/workflows/release.yml/badge.svg)](https://github.com/Demon1019/MarkPure/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Rust](https://img.shields.io/badge/backend-Rust-orange.svg)](https://www.rust-lang.org/)

[English](./README.en.md) | 简体中文

</div>

<p align="center">
  <b>所见即所得的 Markdown 编辑器，但文件始终是纯 Markdown。</b><br>
  <sub>Rust 原生外壳 + Svelte 5 前端 · 内置 Vim 模式与多光标 · 单文件便携运行</sub>
</p>

## 简介

MarkPure 是一个纯本地、无账号、无插件的 Markdown 编辑器：写作时所见即所得，保存时始终是标准纯文本 `.md`。
一个文件夹就是一个工作区，开箱即用。

## 功能

- **编辑**：所见即所得 / 源码双视图、多光标、列选择、自研 Vim 模式、分支式撤销树、公式与 Mermaid、Wiki 链接与反链
- **工作区**：文件树、全文搜索、标签面板、大纲、多根工作区、文件监视、自动保存
- **导出**：HTML / PDF / Word / PNG
- **中日文**：CJK 感知的词数统计、多编码自动检测、系统级拼写检查、PDF 导出嵌入 CJK 字体

详细功能说明见 [docs/FEATURE-GUIDE.md](./docs/FEATURE-GUIDE.md)，逐项实现细节见 [docs/FEATURES.md](./docs/FEATURES.md)。

## 特点

- **纯 Markdown 无损**：所见即所得与纯文本双向无损，存出来就是文件里的内容
- **Vim 模式自研**：完整模式机（6 模式 / 18 motion / 3 类 operator / 10+ text object），不是按键映射表
- **多光标与列选共用引擎**：`Alt+拖拽` 矩形选区直接展开为多光标，表格代码块自动跳过
- **撤销是树**：改错后回到旧状态再改，会长出分支而不是覆盖历史
- **不打包 Chromium**：系统 WebView 驱动，约 15 MB 单文件，解压即用
- **完全本地**：笔记不上云，唯一联网是你主动配置的图片上传器

## 下载

从 [Releases](https://github.com/Asketisch/MarkPure/releases) 下载对应平台的便携包，解压即用。
构建与开发说明见 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)。

## 许可证

[MIT](./LICENSE)
