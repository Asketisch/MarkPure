/**
 * 导出 + 资产 + 工作区搜索的 IPC 包装。
 *
 * 主题：把文档转成 HTML/PDF/Word、工作区级文件搜索，以及图片
 * 粘贴 / 图片上传助手。导出的保存对话框由 Rust 宿主（rfd）驱动，
 * 因此每个导出都返回用户选择的落盘路径。
 */
import { ipc, NATIVE_DIALOG_TIMEOUT_MS } from './ipc'
import type { SearchMatch, WorkspaceSearchResult } from './types'

// ============================== 导出 ==============================

export async function exportHtml(
  content: string,
  title: string,
  themeCss?: string | null,
): Promise<{ path: string }> {
  return await ipc('export_html', {
    content,
    title,
    // 透传当前编辑器主题，让独立 HTML 与实时配色一致。旧调用方
    // （或不导入 `pngExport` 的调用方）不传，Rust 侧回退到内置
    // 的浅色 CSS。
    theme_css: themeCss ?? null,
  }, NATIVE_DIALOG_TIMEOUT_MS)
}

export async function exportPdf(
  content: string,
  title: string,
  sourcePath?: string | null,
): Promise<{ path: string }> {
  return await ipc(
    'export_pdf',
    { content, title, source_path: sourcePath ?? null },
    NATIVE_DIALOG_TIMEOUT_MS,
  )
}

export async function exportWord(
  content: string,
  title: string,
): Promise<{ path: string }> {
  return await ipc('export_word', { content, title }, NATIVE_DIALOG_TIMEOUT_MS)
}

/**
 * 持久化调用方已栅格化的 PNG 字节流。前端管线（见
 * `commands/pngExport.ts`）用 `html-to-image` 把文档渲染进一个
 * 隐藏 DOM 节点，然后把得到的 `data:image/png;base64,…` URL 经
 * 本包装发送。Rust 宿主校验字节并写入用户选择的路径。
 */
export async function exportPng(
  dataUrl: string,
  title: string,
): Promise<{ path: string }> {
  return await ipc('export_png', { bytes_b64: dataUrl, title }, NATIVE_DIALOG_TIMEOUT_MS)
}

// ============================== 工作区搜索 ==============================

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
  // 多根：调用方传入数组时传 `paths`（复数）；单根调用方回退到
  // 旧的 `path: string`。Rust 内部合并结果。
  const pathOrPaths = Array.isArray(path)
    ? { paths: path }
    : { path }
  return await ipc<WorkspaceSearchResult>('search_workspace', {
    ...pathOrPaths, query, ...options,
  })
}

// ============================== 资产（图片） ==============================

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
