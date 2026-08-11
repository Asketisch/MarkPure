/**
 * Export / copy-as handlers extracted from `App.svelte`.
 *
 * This module owns the HTML/PDF/Word/PNG export entry points
 * plus the "Copy as Markdown / HTML / Plain" helper. The host
 * passes a small deps bag (`getActiveTab`, `getMarkdown`) and
 * the IPC wrappers; the handlers stay side-effect free except
 * for the shared `exportingPng` guard, which lives here as a
 * module `$state` so the toolbar can disable the button while
 * a snapshot is in flight.
 *
 * Each handler mirrors what the old inline code did exactly —
 * empty-document short-circuits, large-doc info log, cancel
 * swallowing, and theme-aware HTML/PNG via the dynamic
 * `pngExport` import. Moving the block out of `App.svelte`
 * keeps that 3500-line file a little more navigable.
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
  /** Reader for the live Tiptap editor (null before mount). */
  getEditor: () => Editor | null
  /** Reader for the active tab (title + path + fallback content). */
  getActiveTab: () => Tab | undefined
}

export interface ExportActions {
  handleCopyAs: (format: 'markdown' | 'html' | 'plain') => Promise<void>
  handleExportHtml: () => Promise<void>
  handleExportPdf: () => Promise<void>
  handleExportWord: () => Promise<void>
  handleExportPng: () => Promise<void>
  /** True while a PNG snapshot is in flight. */
  exportingPng: boolean
}

/** Heuristic threshold for the "long document" warning. A
 *  typical 1000-paragraph `synth-1k.md` weighs in around
 *  30-50 KB so 100 KB gives a comfortable cushion before we
 *  start asking the user to wait. */
const LONG_DOC_BYTES = 100 * 1024

export function createExportActions(deps: ExportDeps): ExportActions {
  let exportingPng = $state(false)

  /** Resolve the markdown to export for the active tab, falling
   *  back to the tab's on-disk content. The title strips `.md`
   *  for the Save dialog's default filename. */
  function snapshot(): { content: string; title: string } | null {
    const tab = deps.getActiveTab()
    if (!tab) return null
    const editor = deps.getEditor()
    const content = editor ? getMarkdown(editor) : tab.content
    const title = tab.name.replace(/\.md$/, '')
    return { content, title }
  }

  /** Pure-copy helper: the browser Clipboard API is fine for
   *  all three formats, no Rust IPC needed. */
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
      // P1-8: serialise the active theme so the standalone HTML
      // matches the live editor palette. The dynamic import
      // keeps `pngExport.ts` out of the eager bundle.
      const { serializeActiveTheme } = await import('$lib/editor/commands/pngExport')
      await exportHtmlIpc(snap.content, snap.title, serializeActiveTheme())
    } catch (e) {
      console.error('Failed to export HTML:', e)
    }
  }

  async function handleExportPdf(): Promise<void> {
    const snap = snapshot()
    if (!snap || !deps.getActiveTab()) return
    const tab = deps.getActiveTab()!
    try {
      // P0-9: pass the source file path so the PDF export
      // can resolve relative image references (e.g.
      // ![](./images/foo.png)).
      await exportPdfIpc(snap.content, snap.title, tab.path)
    } catch (e) {
      console.error('Failed to export PDF:', e)
    }
  }

  async function handleExportWord(): Promise<void> {
    const snap = snapshot()
    if (!snap) return
    try {
      await exportWordIpc(snap.content, snap.title)
    } catch (e) {
      console.error('Failed to export Word:', e)
    }
  }

  async function handleExportPng(): Promise<void> {
    if (exportingPng) return
    const snap = snapshot()
    if (!snap) return

    // Empty document: skip the IPC round-trip and the
    // (essentially-blank) save dialog. The user will see a
    // console message instead of an empty PNG file.
    if (!snap.content || !snap.content.trim()) {
      console.warn('PNG export: document is empty')
      return
    }
    if (snap.content.length > LONG_DOC_BYTES) {
      console.info(
        `PNG export: large document (${snap.content.length} bytes), this may take a moment`,
      )
    }

    exportingPng = true
    try {
      const { snapshotHtmlToPng } = await import('$lib/editor/commands/pngExport')
      // Snapshot the live editor DOM. This piggy-backs on the
      // existing Tiptap render — KaTeX, Mermaid, CodeMirror
      // highlighting and workspace images are all already in
      // the DOM, so the resulting PNG is pixel-identical to
      // what the user sees on screen.
      const host = document.querySelector('.ProseMirror') as HTMLElement | null
      if (!host) {
        console.warn('PNG export: editor DOM not found')
        return
      }
      // Pass the live editor's width so the export mirrors
      // the column the user is looking at (the sidebar /
      // outline panel change the available width; a fixed
      // 800px would clip).
      const dataUrl = await snapshotHtmlToPng(host.outerHTML, host.offsetWidth)
      // Strip the `data:image/png;base64,` prefix — the Rust
      // side decodes pure base64.
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl
      try {
        await exportPngIpc(base64, snap.title)
      } catch (e) {
        // The Rust side returns `Cancelled` when the user
        // dismisses the save dialog; that's a normal flow and
        // shouldn't spam the console with an error stack.
        const msg = e instanceof Error ? e.message : String(e)
        if (msg.toLowerCase().includes('cancel')) return
        console.error('Failed to export PNG:', e)
      }
    } catch (e) {
      console.error('Failed to export PNG:', e)
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