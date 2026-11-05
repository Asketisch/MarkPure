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
  <sub>Native Rust shell + Svelte 5 frontend · Built-in Vim mode and multi-cursor · Single portable binary, no account, no plugins</sub>
</p>

---

## Why yet another Markdown editor

Markdown editors tend to fall into three camps: plain text plus a preview pane (VS Code), fully WYSIWYG (Typora), and note-vault style (Obsidian).

MarkPure takes a different path: **a WYSIWYG writing experience + a folder as your knowledge base + an editor that is just a lightweight local program.**

| | MarkPure | Obsidian | Typora | VS Code + Markdown |
|---|---|---|---|---|
| File format | Plain `.md`, lossless | Plain `.md`, lossless | Plain `.md`, lossless | Plain `.md` |
| WYSIWYG | ✅ | ✅ | ✅ | ❌ (preview pane) |
| Built-in Vim mode | ✅ full state machine | ❌ community plugin | ❌ | ⚠️ editing only |
| Multi-cursor / column select | ✅ in-house | ❌ | ❌ | ✅ (plain-text side) |
| Branching undo tree | ✅ | ❌ | ❌ | ❌ |
| Workspace full-text search | ✅ built-in | ✅ | ❌ | ⚠️ extensions |
| Backlinks / tag panel | ✅ built-in | ✅ | ❌ | ❌ |
| Runtime | System WebView (no Electron) | Electron | Electron | Electron |
| Install size | ~15 MB single file | ~100 MB range | ~100 MB range | ~100 MB range |
| Account / sync | Not needed | Account needed for sync | Not needed | Not needed |
| CJK experience | ✅ see below | Fair | Fair | Fair |

> This compares the general shape of each project and community consensus; check each project's latest release for exact capabilities.

### What makes MarkPure different

**① WYSIWYG while you write, plain Markdown when you save**

This is not "a rich-text shell around a Markdown editor" — it is **lossless in both directions**: what you see *is* what is in the file. Bold is `**bold**`, a table is a GFM table. The repository ships a dedicated regression test (`validate-file-format.ts`) that feeds the **bytes the frontend really writes** into **the handler the backend really runs**, then verifies them byte for byte — a missing `encoding` field on the frontend or an unrecognized encoding on the backend fails immediately.

**② The Vim mode is a hand-written state machine, not a keymap table**

`Cmd+.` toggles it. Six modes (NORMAL / INSERT / VISUAL / V-LINE / V-BLOCK / REPLACE), ~18 motions, three operator families (`d` / `c` / `y`), 10+ text objects, four ex commands (`:w` `:q` `:wq` `:e`), and count prefixes (`3d`, `ciw`). Vim's `Ctrl-V` visual block reuses the column-selection rectangle math directly.

Existing community solutions (such as `prosemirror-vim`) have not been maintained since 2018 and are not compatible with current ProseMirror / Tiptap, so this was rewritten from scratch — 59 dedicated tests.

**③ Multi-cursor and column selection share one engine**

`Alt+Click` adds a cursor, `Cmd+D` selects the next match, `Alt+drag` paints a rectangle. A column selection expands into N range cursors that feed straight into the same input fan-out, decoration rendering, and undo path as multi-cursor. Table cells, code blocks, and virtualized off-screen blocks are skipped automatically, so cursors never land where they should not.

**④ Undo is a tree, not a linear stack**

Change something, step back, and change it again — that grows a branch instead of overwriting history. A side panel lets you inspect and jump to any branch.

**⑤ Chinese and Japanese are first-class, not "bolted on"**

- Word count is CJK-aware; Chinese characters are not counted as one word
- Encoding is detected on open: UTF-8 / UTF-8 BOM / GBK / Big5 / Shift_JIS, and the original encoding is used on save
- On macOS, spelling goes through the system `NSSpellChecker` — Chinese and English both work (Windows and Linux currently cover English only)
- Interface languages: English / 简体中文 / 日本語
- PDF export embeds CJK font subsets, so Chinese does not turn into blank boxes

**⑥ No bundled Chromium**

wry + tao drive the system WebView directly (WKWebView on macOS, WebView2 on Windows, WebKitGTK on Linux). The whole program is a ~15 MB single binary you can unzip and run; memory usage tracks the system WebView rather than dragging along a separate Chromium process as Electron apps do.

**⑦ No account, no uploading your notes**

Your files are `.md` files on disk and settings live in the platform's standard app config directory (macOS `~/Library/Application Support/markpure`, Windows `%APPDATA%\markpure`, Linux `~/.config/markpure`). The only network access is an image uploader **you configure yourself** (paste an image, it goes to your own image host). Without one, the app never touches the network.

**⑧ A folder is a workspace**

Open a directory and everything is already there: file tree, full-text search (with regex), tag panel (`#tag` aggregation), backlinks, TOC, outline, multi-root workspaces, and per-workspace CSS (`.markpure/styles/*.css`) — no plugins to install.

---

## Features

### Editing

| Feature | Notes |
|---|---|
| **WYSIWYG + source mode** | Four view modes — source / WYSIWYG / split / preview — with synced scrolling and selection |
| **Live syntax hints** | Markdown markers appear near the cursor and fade when you move away |
| **Multi-cursor** | `Alt+Click`, `Cmd+D` for next match, `Cmd+Shift+L` for all matches; typing / Backspace / paste fan out to every cursor |
| **Column selection** | `Alt+drag` paints a rectangle that expands into N range cursors; tables and code blocks are skipped |
| **Vim mode** | 6 modes × 18 motions × 3 operators × 10+ text objects × 4 ex commands, persisted in config |
| **Branching undo tree** | Undo history is a tree, with a panel to browse and jump between branches |
| **Slash command / quick insert** | `/` and `@` open the block insert menu with 21 preset block types (headings, code blocks, tables, math, lists, footnotes, TOC, Mermaid, …) |
| **Image toolbar** | Width presets, alignment, alt text, delete — persisted into a Markdown extension syntax |
| **Math** | KaTeX renders inline and block LaTeX |
| **Mermaid diagrams** | Rendered live inside code blocks |
| **Wiki links** | `[[` triggers file completion, and links feed the backlinks panel |
| **Footnotes / super / sub** | Inline footnote references, GFM superscript and subscript |
| **Path completion** | `Cmd+P` fuzzy-matches files in the workspace |
| **Find and replace** | Regex, case sensitivity, whole-word matching |
| **Spell check** | System-level checker on macOS (Chinese + English) with a right-click candidate menu |
| **Zen mode / split view** | `F11` for distraction-free writing; resizable split |

### Documents and workspace

| Feature | Notes |
|---|---|
| **File tree** | 15 levels deep, live refresh, create / rename / delete |
| **Workspace full-text search** | Cross-file regex search with jump-to-hit |
| **Tag panel** | Aggregates every `#tag`, with `/` nesting (`#project/foo`) |
| **Backlinks panel** | Lists every document linking to the current one |
| **Outline / TOC** | Headings extracted straight from the document model; one click inserts a live TOC |
| **Multi-root workspace** | Mount several roots at once, with cross-root search and bookmarks |
| **File watching** | External edits prompt "reload / keep my changes / compare" |
| **Auto-save** | Configurable interval, debounced after you stop typing |
| **Workspace CSS** | `.markpure/styles/*.css` loads automatically and hot-reloads, overriding user themes |
| **Snippets** | `snippets/*.md` in the user config directory, with `{{date}}` `{{time}}` `{{uuid}}` |
| **Custom themes** | Import / export JSON themes alongside 7 built-ins |

### Export

| Format | Notes |
|---|---|
| **HTML** | Keeps theme styling and image extension syntax |
| **PDF** | Real page layout, embedded font subsets, headers/footers and page numbers |
| **Word** | Tables, lists, code blocks, and images survive the round trip |
| **PNG** | Export the current document as a long image, following the editor theme |

> The complete feature list — with triggers, key files, and known limitations for every entry — is in **[docs/FEATURES.md](./docs/FEATURES.md)**.

---

## Download

Grab the portable build for your platform from [Releases](https://github.com/Asketisch/MarkPure/releases), unzip, and run:

| Platform | Package | Notes |
|---|---|---|
| macOS (Apple Silicon) | `MarkPure-v*-macos-arm64.zip` | Drag into Applications. Not notarized — right-click → Open on first launch |
| macOS (Intel) | `MarkPure-v*-macos-x64.zip` | Same as above |
| Windows | `MarkPure-v*-windows-x64.zip` | Run `markpure.exe`; needs the WebView2 runtime (bundled with Win10/11) |
| Linux (x64) | `MarkPure-v*-linux-x64.tar.gz` | Needs system webkit2gtk-4.1 — see `README.txt` inside the archive |
| Linux (ARM64) | `MarkPure-v*-linux-arm64.tar.gz` | Same as above (Raspberry Pi 4+, ARM servers, …) |

Each release ships a `SHA256SUMS.txt` for verifying download integrity.

Or build from source — see [Getting started](#getting-started).

---

## Getting started

### Prerequisites

[Node.js](https://nodejs.org/) and [Rust](https://www.rust-lang.org/tools/install). On Linux you also need the webkit2gtk / gtk development packages:

```bash
# Debian / Ubuntu
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev pkg-config
# Fedora
sudo dnf install webkit2gtk4.1-devel gtk3-devel
```

### Install and develop

All commands run from the **repository root** (the npm project lives at the root; `frontend/` has no package.json of its own).

```bash
npm install

# Terminal 1: frontend dev server with hot reload
npm run dev

# Terminal 2: Rust backend, pointed at the dev server
cargo run -- --dev
```

Then open http://localhost:5173.

### Build and package

```bash
# One-shot build (frontend + Rust)
./scripts/build.sh              # debug
./scripts/build.sh release      # release, output at target/release/markpure

# Per-platform packaging
./scripts/bundle-macos.sh       # → target/MarkPure.app (ad-hoc signed)
./scripts/bundle-windows.sh     # → target/MarkPure-windows/
./scripts/bundle-linux.sh       # → target/MarkPure-linux/
```

All three bundling scripts accept `SKIP_BUILD=1` (bundle an existing binary, skip building) and `TARGET_DIR=` (point at a specific cargo target subdirectory, used for cross-compiles) — the CI release workflow calls them exactly that way.

> The frontend bundle is embedded into the binary **at compile time** by rust-embed, so any frontend change requires a fresh `cargo build`. `build.sh` already enforces that order.

---

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl + N` / `O` / `S` | New / open / save |
| `Cmd/Ctrl + Shift + S` | Save as |
| `Cmd/Ctrl + W` | Close tab |
| `Cmd/Ctrl + Z` / `Shift + Z` | Undo / redo |
| `Cmd/Ctrl + F` / `H` | Find / find and replace |
| `Cmd/Ctrl + P` | Quick switcher |
| `Cmd/Ctrl + Shift + F` | Workspace full-text search |
| `Cmd/Ctrl + B` / `I` | Bold / italic |
| `Cmd/Ctrl + /` | Toggle source mode |
| `Cmd/Ctrl + Shift + T` | Toggle theme |
| `Cmd/Ctrl + .` | Toggle Vim mode |
| `F11` / `Cmd/Ctrl + Shift + Z` | Zen mode |
| `Alt + Click` | Add a multi-cursor |
| `Cmd/Ctrl + D` | Select next match into multi-cursor |
| `Alt + drag` | Column selection (rectangle) |
| `Esc` | Clear multi-cursors / leave Vim visual mode |

The full list (quick insert, code blocks, detailed Vim bindings) is in the app's settings panel.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│              Rust desktop shell (backend/)          │
│  ┌───────────────────────────────────────────────┐ │
│  │          Svelte 5 frontend (frontend/src/)    │ │
│  │  ┌─────────────────────────────────────────┐  │ │
│  │  │  Tiptap WYSIWYG editor                 │  │ │
│  │  │  + CodeMirror 6 code blocks             │  │ │
│  │  │  + KaTeX math / Mermaid diagrams        │  │ │
│  │  │  + live hints / multi-cursor / Vim       │  │ │
│  │  └─────────────────────────────────────────┘  │ │
│  │  custom IPC JSON protocol                     │ │
│  └───────────────────────────────────────────────┘ │
│  wry (system WebView) + tao (windowing)            │
│  rust-embed (frontend embedded at compile time)    │
│  Document registry (HashMap<doc_id, Document>)      │
└─────────────────────────────────────────────────────┘
              │
┌─────────────┼─────────────┬─────────────┬──────────┐
│  core-lib   │    fs       │  markdown   │  export    │
│  docs/config│  file I/O   │  MD parsing │ HTML/PDF   │
│  (ropey)    │  encoding   │ (pulldown)  │  Word/PNG  │
└─────────────┴─────────────┴─────────────┴──────────┘
```

**The frontend only renders and handles interaction; every functional operation is delegated to the Rust backend over IPC.** The Rust side holds a rope-backed copy of each document, so counting, searching, and exporting happen natively — the full text is never serialized back and forth.

### Layout

```
MarkPure/
├── frontend/src/                # Svelte 5 + TypeScript frontend
│   ├── app/                    # Shell (menu bar / tabs / toolbar / status bar)
│   ├── editor/                 # Tiptap editor wrappers and IPC commands
│   ├── components/             # Shared UI / layout / workspace panels
│   ├── features/               # Settings, search, quick insert, outline, palette
│   ├── extensions/             # Tiptap extensions (incl. large-document virtualization)
│   ├── plugins/                # ProseMirror plugins (multi-cursor, column, Vim, undo tree)
│   ├── nodeviews/              # NodeViews for code blocks / Mermaid / TOC
│   └── stores/                 # Svelte 5 runes state
├── backend/
│   ├── apps/desktop/           # App entry (window, WebView, IPC dispatch)
│   └── crates/                 # core-lib / fs / markdown / export / search /
│                               # bookmark / assets / spellcheck
├── scripts/                    # Build, packaging, and version-sync scripts
├── resources/icons/            # App icons
└── distribution/               # Packaging config (Info.plist, .desktop file)
```

### Stack

| Layer | Technology |
|---|---|
| Desktop shell | wry 0.46 + tao 0.34 (system WebView, no Electron) |
| Frontend | Svelte 5 (runes) + TypeScript, built with Vite 8 |
| Editor core | Tiptap 3 (ProseMirror) |
| Code blocks | CodeMirror 6 (14+ languages) |
| Math / diagrams | KaTeX 0.16 / Mermaid |
| Backend | Rust 2021 (ropey buffers, regex search, pulldown-cmark) |
| Watching / encoding | notify 8 / chardetng + encoding_rs |
| Export | printpdf 0.7 / docx-rs / html-to-image |

---

## Development

```bash
npm run check                       # Type checking (svelte-check + tsc)
cargo test --workspace              # Rust unit tests
python3 scripts/test_backend.py     # Full backend IPC suite (drives real handlers via mt_harness)
npm run test:markdown               # Markdown round-trip and normalization regressions
npm run test:frontend               # Frontend validation scripts (browser ones skip without Chrome)
./scripts/check-file-size.sh        # File size budget
```

CI runs type checking, the full Linux test suite, and platform compile checks on macOS and Windows for every push and pull request.

### Cutting a release

```bash
# 1. Sync the version to Cargo.toml / About page / Info.plist / Cargo.lock
./scripts/sync-version.sh 0.2.0

# 2. Commit the version bump
git commit -am "chore(release): v0.2.0"

# 3. Tag and push — CI builds all four platforms and publishes the Release
git tag v0.2.0
git push origin main v0.2.0
```

---

## Known limitations

- PDF export relies on system fonts: DejaVu / Liberation for Latin, WenQuanYi / Noto CJK for Chinese (missing fonts leave Chinese blank in the PDF rather than failing)
- PNG export needs a live editor instance (it snapshots the off-screen DOM); it is skipped for empty documents or when ProseMirror is unavailable
- Chinese spell checking is macOS-only (Windows and Linux currently check English only)
- PlantUML / Draw.io insert code blocks but are not rendered live yet
- Release artifacts are not code-signed or notarized: macOS needs right-click → Open on first launch, and Windows may show a SmartScreen prompt
- Some themes are CSS-only for now

---

## License

[MIT](./LICENSE)
