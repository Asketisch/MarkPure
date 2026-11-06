# MarkPure

<div align="center">

[![CI](https://github.com/Demon1019/MarkPure/actions/workflows/ci.yml/badge.svg)](https://github.com/Demon1019/MarkPure/actions/workflows/ci.yml)
[![Release](https://github.com/Demon1019/MarkPure/actions/workflows/release.yml/badge.svg)](https://github.com/Demon1019/MarkPure/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Rust](https://img.shields.io/badge/backend-Rust-orange.svg)](https://www.rust-lang.org/)

English | [简体中文](./README.md)

</div>

<p align="center">
  <b>A WYSIWYG Markdown editor whose files stay plain Markdown.</b><br>
  <sub>Native Rust shell + Svelte 5 frontend · Built-in Vim mode and multi-cursor · Single portable binary</sub>
</p>

## Overview

MarkPure is a fully local, account-free, plugin-free Markdown editor: it looks WYSIWYG while you write, but always saves as standard plain-text `.md`. A folder is your workspace — open it and start writing.

## Features

- **Editing**: WYSIWYG / source dual view, multi-cursor, column selection, in-house Vim mode, branching undo tree, math & Mermaid, wiki links and backlinks
- **Workspace**: file tree, full-text search, tag panel, outline, multi-root workspaces, file watching, auto-save
- **Export**: HTML / PDF / Word / PNG
- **CJK**: CJK-aware word count, multi-encoding auto-detection, system-level spell check, PDF export with embedded CJK fonts

See [docs/FEATURE-GUIDE.md](./docs/FEATURE-GUIDE.md) for detailed feature descriptions and [docs/FEATURES.md](./docs/FEATURES.md) for per-feature implementation details.

## Highlights

- **Lossless pure Markdown**: WYSIWYG both ways — what you see is exactly what is in the file
- **Hand-written Vim mode**: a full state machine (6 modes / 18 motions / 3 operator families / 10+ text objects), not a keymap table
- **Shared multi-cursor & column engine**: an `Alt+drag` rectangle expands straight into multi-cursors; tables and code blocks are skipped
- **Undo is a tree**: stepping back and editing again grows a branch instead of overwriting history
- **No bundled Chromium**: system WebView, ~15 MB single binary, unzip and run
- **Fully local**: notes never leave your machine; the only network access is the image uploader you configure yourself

## Download

Grab the portable build for your platform from [Releases](https://github.com/Asketisch/MarkPure/releases) — unzip and run.
For build and development instructions, see [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## License

[MIT](./LICENSE)
