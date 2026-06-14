/**
 * Export + asset + workspace-search IPC wrappers.
 *
 * Topic: turning a document into HTML/PDF/Word, the
 * workspace-level file-search, and image-paste / image-upload
 * helpers. The save dialog for exports is driven by the Rust
 * host (rfd), so each export returns the destination path
 * the user picked.
 */
import { ipc } from './ipc'
import type { SearchMatch, WorkspaceSearchResult } from './types'

// ============================== Export ==============================

export async function exportHtml(
  content: string,
  title: string,
  themeCss?: string | null,
): Promise<{ path: string }> {
  return await ipc('export_html', {
    content,
    title,
    // P1-8: pass through the active editor theme so the
    // standalone HTML mirrors the live palette. Older callers
    // (or callers that don't import `pngExport`) pass nothing
    // and the Rust side falls back to the built-in light CSS.
    theme_css: themeCss ?? null,
  })
}

export async function exportPdf(
  content: string,
  title: string,
  sourcePath?: string | null,
): Promise<{ path: string }> {
  return await ipc('export_pdf', { content, title, source_path: sourcePath ?? null })
}

export async function exportWord(
  content: string,
  title: string,
): Promise<{ path: string }> {
  return await ipc('export_word', { content, title })
}

/**
 * P1-8: persist a PNG byte stream that the caller has already
 * rasterised. The frontend pipeline (see `commands/pngExport.ts`)
 * renders the document into a hidden DOM node via `html-to-image`,
 * then sends the resulting `data:image/png;base64,…` URL through
 * this wrapper. The Rust host validates the bytes and writes them
 * to a user-chosen path.
 */
export async function exportPng(
  dataUrl: string,
  title: string,
): Promise<{ path: string }> {
  return await ipc('export_png', { bytes_b64: dataUrl, title })
}

// ============================== Workspace search ==============================

export interface WorkspaceSearchOptions {
  case_sensitive: boolean
  whole_word: boolean
  use_regex: boolean
  max_depth?: number
}

export async function searchWorkspace(
  path: string | string[],
  query: string,
  options: WorkspaceSearchOptions,
): Promise<WorkspaceSearchResult> {
  // P2-4 multi-root: pass `paths` (plural) when the caller
  // supplies an array; fall back to legacy `path: string` for
  // single-root callers. Rust merges the results internally.
  const pathOrPaths = Array.isArray(path)
    ? { paths: path }
    : { path }
  return await ipc<WorkspaceSearchResult>('search_workspace', {
    ...pathOrPaths, query, ...options,
  })
}

// ============================== Assets (images) ==============================

export interface SavedImage {
  path: string
  relative_path: string
  file_name: string
}

export async function savePastedImage(
  workspacePath: string,
  data: string,
  name?: string,
): Promise<SavedImage> {
  return await ipc('save_pasted_image', {
    workspace_path: workspacePath, data, name,
  })
}

export interface RemoteUploadResult {
  url: string
  success: boolean
  error: string | null
}

export async function uploadImageRemote(
  data: string,
  uploadUrl: string,
  apiKey?: string,
): Promise<RemoteUploadResult> {
  return await ipc('upload_image_remote', {
    data, upload_url: uploadUrl, api_key: apiKey,
  })
}
