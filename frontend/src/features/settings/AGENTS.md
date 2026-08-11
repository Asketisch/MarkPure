# AGENTS.md — features/settings/ 设置面板

## 目录

| 文件 | 说明 |
|------|------|
| `Settings.svelte` | 设置面板（通用/外观/快捷键/关于） |
| `ThemeEditor.svelte` | 主题编辑器（自定义主题编辑） |
| `themes.ts` | 主题标签 ↔ CSS class 映射 + `<select>` 选项 |
| `keybindings.ts` | 键盘事件 → accelerator 字符串解析 + 格式化 |
| `configIO.ts` | 配置导出/导入的浏览器端 I/O（Blob + `<a>` 下载、`<input>` 读取） |

`Settings.svelte` 的纯函数（主题映射、快捷键格式化、配置 I/O）已提取到
对应 `.ts` 模块，便于单元测试和复用。