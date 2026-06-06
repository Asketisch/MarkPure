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
): Promise<{ path: string }> {
  return await ipc('export_html', { content, title })
}

export async function exportPdf(
  content: string,
  title: string,
): Promise<{ path: string }> {
  return await ipc('export_pdf', { content, title })
}

export async function exportWord(
  content: string,
  title: string,
): Promise<{ path: string }> {
  return await ipc('export_word', { content, title })
}

// ============================== Workspace search ==============================

export interface WorkspaceSearchOptions {
  case_sensitive: boolean
  whole_word: boolean
  use_regex: boolean
  max_depth?: number
}

export async function searchWorkspace(
  path: string,
  query: string,
  options: WorkspaceSearchOptions,
): Promise<WorkspaceSearchResult> {
  return await ipc<WorkspaceSearchResult>('search_workspace', {
    path, query, ...options,
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
