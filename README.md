# MarkText-RS

WYSIWYG Markdown 桌面编辑器，灵感来自 MarkText。

## 特性

- WYSIWYG 编辑（所见即所得）
- Tiptap/ProseMirror 编辑器
- 文件树管理
- 大纲导航
- 多主题支持
- 导出 HTML/PDF

## 技术栈

- Rust (wry + tao) - 桌面壳
- Svelte 5 - 前端框架
- Tiptap - Markdown 编辑器
- Vite - 构建工具

## 构建

```bash
# 安装前端依赖
npm install

# 构建前端
npm run build

# 构建 Rust 后端
cargo build --release
```

## 开发

```bash
# 终端1：前端开发服务器
npm run dev

# 终端2：Rust 后端
cargo run -- --dev
```

## 运行

```bash
./target/release/marktext
```

## 许可证

MIT
