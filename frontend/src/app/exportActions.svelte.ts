/**
 * 从 `App.svelte` 中拆出的导出 / 复制为 处理器。
 *
 * 本模块拥有 HTML/PDF/Word/PNG 各导出入口，以及「复制为
 * Markdown / HTML / 纯文本」辅助函数。宿主传入一个小型依赖袋
 * （`getActiveTab`、`getMarkdown`）与 IPC 包装；处理器除了共享
 * 的 `exportingPng` 守卫外保持无副作用——该守卫以模块 `$state`
 * 形式存在这里，让快照进行中时工具栏可以禁用按钮。
 *
 * 每个处理器都与原先内联代码的行为完全一致——空文档短路、
 * 大文档信息日志、取消吞掉，以及经由动态 `pngExport` 导入的
 * 主题感知 HTML/PNG。把这坨代码搬出 `App.svelte`，让那个
 * 3500 行的文件稍微好导航一些。
 */

import type { Editor } from '@tiptap/core'
import { getMarkdown } from '$lib/editor/editor'
import {
  exportHtml as exportHtmlIpc,
  exportPdf as exportPdfIpc,
  exportWord as exportWordIpc,
  exportPng as exportPngIpc,
} from '$lib/editor/commands'
import type { Tab } from './handlers/types'

export interface ExportDeps {
  /** 实时 Tiptap 编辑器的读取器（挂载前为 null）。 */
  getEditor: () => Editor | null
  /** 活动标签页的读取器（标题 + 路径 + 兜底内容）。 */
  getActiveTab: () => Tab | undefined
  /**
   * 导出失败时的回调。
   *
   * 失败此前只写进 console——用户看到的是「点了导出，什么都没发生」。
   * PNG 导出在 WKWebView 里就曾这样静默失败过。
   */
  onError?: (message: string) => void
}

export interface ExportActions {
  handleCopyAs: (format: 'markdown' | 'html' | 'plain') => Promise<void>
  handleExportHtml: () => Promise<void>
  handleExportPdf: () => Promise<void>
  handleExportWord: () => Promise<void>
  handleExportPng: () => Promise<void>
  /** PNG 快照进行中时为 true。 */
  exportingPng: boolean
}

/** 「长文档」警告的启发式阈值。典型的 1000 段 `synth-1k.md`
 *  体积在 30-50 KB 左右，因此 100 KB 留有充足余量，之后我们
 *  才开始提示用户等待。 */
const LONG_DOC_BYTES = 100 * 1024

/** PNG 快照的超时上限（毫秒）。 */
const PNG_TIMEOUT_MS = 20_000

export function createExportActions(deps: ExportDeps): ExportActions {
  let exportingPng = $state(false)

  /** 报告导出失败：既写 console，也交给宿主显示。 */
  function reportFailure(scope: string, e: unknown): void {
    const message = e instanceof Error ? e.message : String(e)
    console.error(`Failed to export ${scope}:`, e)
    deps.onError?.(message)
  }

  /**
   * 给一个 Promise 加超时。
   *
   * 超时不是「取消」——底层任务仍会继续跑完，但它不再阻塞用户：
   * 错误提示会立刻出现，��明卡在哪一步。
   */
  function withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    message: () => string,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message())), ms)
      promise.then(
        (v) => { clearTimeout(timer); resolve(v) },
        (e) => { clearTimeout(timer); reject(e) },
      )
    })
  }

  /** 解析活动标签页要导出的 markdown，缺省时回退到标签页的
   *  磁盘内容。标题去掉 `.md` 后缀，用作保存对话框的默认文件名。 */
  function snapshot(): { content: string; title: string } | null {
    const tab = deps.getActiveTab()
    if (!tab) return null
    const editor = deps.getEditor()
    const content = editor ? getMarkdown(editor) : tab.content
    const title = tab.name.replace(/\.md$/, '')
    return { content, title }
  }

  /** 纯复制辅助函数：浏览器的剪贴板 API 对三种格式都够用，
   *  无需 Rust IPC。 */
  async function handleCopyAs(format: 'markdown' | 'html' | 'plain'): Promise<void> {
    const editor = deps.getEditor()
    if (!editor) return
    const text = format === 'markdown'
      ? getMarkdown(editor)
      : format === 'html'
        ? editor.getHTML()
        : editor.getText()
    try {
      await navigator.clipboard.writeText(text)
    } catch (e) {
      console.error('Failed to copy:', e)
    }
  }

  async function handleExportHtml(): Promise<void> {
    const snap = snapshot()
    if (!snap) return
    try {
      // 序列化当前主题，让独立的 HTML 与实时编辑器的配色一致。
      // 动态导入让 `pngExport.ts` 不进入首屏打包。
      const { serializeActiveTheme } = await import('$lib/editor/commands/pngExport')
      await exportHtmlIpc(snap.content, snap.title, serializeActiveTheme())
    } catch (e) {
      reportFailure('HTML', e)
    }
  }

  async function handleExportPdf(): Promise<void> {
    const snap = snapshot()
    if (!snap || !deps.getActiveTab()) return
    const tab = deps.getActiveTab()!
    try {
      // 传入源文件路径，让 PDF 导出能解析相对路径的图片引用
      // （例如 ![](./images/foo.png)）。
      await exportPdfIpc(snap.content, snap.title, tab.path)
    } catch (e) {
      reportFailure('PDF', e)
    }
  }

  async function handleExportWord(): Promise<void> {
    const snap = snapshot()
    if (!snap) return
    try {
      await exportWordIpc(snap.content, snap.title)
    } catch (e) {
      reportFailure('Word', e)
    }
  }

  async function handleExportPng(): Promise<void> {
    if (exportingPng) return
    const snap = snapshot()
    if (!snap) return

    // 空文档：跳过 IPC 往返和（基本空白的）保存对话框。
    // 用户会看到一条控制台消息，而不是一个空 PNG 文件。
    if (!snap.content || !snap.content.trim()) {
      console.warn('PNG export: document is empty')
      deps.onError?.('EMPTY_DOCUMENT')
      return
    }
    if (snap.content.length > LONG_DOC_BYTES) {
      console.info(
        `PNG export: large document (${snap.content.length} bytes), this may take a moment`,
      )
    }

    exportingPng = true
    // 记录快照走到哪一步——出错时告诉用户卡在哪，而不是「没反应」。
    let stage = 'import'
    try {
      // 整条流水线都套上超时：动态 import 本身也可能挂住（分块
      // 加载失败时不会 reject，只是永远不 resolve）。
      const dataUrl = await withTimeout(
        (async () => {
          const { snapshotHtmlToPng } = await import('$lib/editor/commands/pngExport')
          // 给实时编辑器 DOM 截图。这搭的是既有 Tiptap 渲染的便车——
          // KaTeX、Mermaid、CodeMirror 高亮与工作区图片都已存在于
          // DOM 中，因此生成的 PNG 与用户屏幕上的内容逐像素一致。
          const host = document.querySelector('.ProseMirror') as HTMLElement | null
          if (!host) {
            console.warn('PNG export: editor DOM not found')
            deps.onError?.('EDITOR_DOM_NOT_FOUND')
            throw new Error('EDITOR_DOM_NOT_FOUND')
          }
          // 传入实时编辑器的宽度，让导出镜像用户正在看的栏宽
          // （侧边栏 / 大纲面板会改变可用宽度；固定 800px 会裁剪）。
          stage = 'snapshot'
          return await snapshotHtmlToPng(host.outerHTML, host.offsetWidth, (s) => { stage = s })
        })(),
        PNG_TIMEOUT_MS,
        () => `timeout at stage '${stage}'`,
      )
      // 去掉 `data:image/png;base64,` 前缀——Rust 端解码纯 base64。
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl
      try {
        await exportPngIpc(base64, snap.title)
      } catch (e) {
        // 用户关闭保存对话框时 Rust 端返回 `Cancelled`；这是正常
        // 流程，不该向控制台刷错误堆栈。
        const msg = e instanceof Error ? e.message : String(e)
        if (msg.toLowerCase().includes('cancel')) return
        reportFailure('PNG', e)
      }
    } catch (e) {
      reportFailure('PNG', e)
    } finally {
      exportingPng = false
    }
  }

  return {
    handleCopyAs,
    handleExportHtml,
    handleExportPdf,
    handleExportWord,
    handleExportPng,
    get exportingPng() { return exportingPng },
  }
}