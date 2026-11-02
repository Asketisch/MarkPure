import { defineConfig, type Plugin } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import path from 'path'
import { ipcDevBridge } from './scripts/vite-ipc-bridge'

/**
 * marked 用一次运行时特性检测决定 lookbehind 正则是否可用：
 *
 *   var be = (() => { try { return !!new RegExp("(?<=1)(?<!1)") } catch { return false } })()
 *
 * rolldown 的压缩器会在构建期（Node 引擎）求值该 IIFE——Node 支持
 * lookbehind、不抛错——于是把它常量折叠成 `true`。在 macOS 12
 * WKWebView（不支持 lookbehind）上，marked 模块初始化时
 * `new RegExp("(?<!`)()")` 抛 SyntaxError，整个应用白屏。
 *
 * 这里把检测改成**间接 eval**：语义不变（在目标引擎上真实检测），
 * 但压缩器无法静态求值，不再误折叠。应用同时带两份 marked
 * （自身一份、mermaid 内嵌一份），都命中同一替换。
 */
function fixMarkedLookbehindDetect(): Plugin {
  const BROKEN = 'return!!new RegExp("(?<=1)(?<!1)")'
  const FIXED = "return!!(0,eval)('new RegExp(\"(?<=1)(?<!1)\")')"
  return {
    name: 'fix-marked-lookbehind-detect',
    transform(code, id) {
      const file = id.split('?')[0]
      if (!file.includes('/marked/') || !file.endsWith('.js')) return null
      if (!code.includes(BROKEN)) return null
      return { code: code.split(BROKEN).join(FIXED), map: null }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // `ipcDevBridge`：开发模式下的 IPC 桥（把浏览器请求转发给 mt_harness），
  //   浏览器 harness 脚本依赖它。
  // `fixMarkedLookbehindDetect`：修 marked 被压缩器常量折叠引发的白屏，
  //   见上方说明。
  plugins: [svelte(), ipcDevBridge(), fixMarkedLookbehindDetect()],
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
