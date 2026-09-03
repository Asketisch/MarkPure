import { defineConfig, type Plugin } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import path from 'path'

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
  plugins: [svelte(), fixMarkedLookbehindDetect()],
  resolve: {
    alias: {
      '$lib': path.resolve('./frontend/src'),
    },
  },
})
