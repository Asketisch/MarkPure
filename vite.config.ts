import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import path from 'path'
import { ipcDevBridge } from './scripts/vite-ipc-bridge'

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte(), ipcDevBridge()],
  resolve: {
    alias: {
      '$lib': path.resolve('./frontend/src'),
    },
  },
  build: {
    // 目标运行环境是**内嵌的 WKWebView**（macOS 自带 Safari 引擎），
    // 不是要兼容 IE 的老浏览器。指定一个现代基线可以让 Vite 少做
    // 很多语法降级，产物更小、解析更快。
    target: 'safari16',
    // 报告体积时把 500KB 的默认阈值调高，避免真正的巨型 chunk
    // 淹没在警告里；这里的阈值按「首屏必须下载的量」来定。
    chunkSizeWarningLimit: 700,
    cssCodeSplit: true,
    reportCompressedSize: true,
  },
})
