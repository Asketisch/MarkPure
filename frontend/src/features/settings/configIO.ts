/**
 * 设置对话框中“备份与恢复”面板的配置导出 / 导入助手。
 *
 * 从 `Settings.svelte` 中拆出，让细小繁琐的下载锚点流程（创建
 * Blob → 对象 URL → 合成 `<a>` 点击 → 撤销 URL）以及配套的选文件
 * → JSON.parse → IPC 管线住进一个可单元测试的模块，而不是堆在
 * 950 行组件文件的底部。
 *
 * 真正的活由宿主 IPC 层（`importConfig` / `exportConfig`）干；
 * 本文件只处理它周边的浏览器侧 I/O。
 */

import type {
  ConfigExportPayload,
  ConfigImportReport,
} from '$lib/editor/commands'

/** 把负载格式化为 JSON 字符串，并通过一个临时 `<a>` 元素触发下载。
 *  返回建议的文件名（带 YYYY-MM-DD 时间戳），方便调用方记录成功
 *  或在 UI 中呈现。 */
export async function downloadConfigAsJson(
  payload: ConfigExportPayload,
): Promise<string> {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const stamp = new Date().toISOString().slice(0, 10)
  a.download = `markpure-preferences-${stamp}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  return a.download
}

/** 读取 `<input type=file>` 事件选中的第一个文件并解析为 JSON。
 *  若用户取消选择或文件为空则返回 `null`——两者都是合理的用户行为，
 *  不应被调用方当作错误。 */
export async function readJsonFromFileInput(
  e: Event,
): Promise<ConfigExportPayload | null> {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return null
  const text = await file.text()
  return JSON.parse(text) as ConfigExportPayload
}

/** 重新导出 IPC 报告类型，让调用方无需为报告 UI 再导入一次。 */
export type { ConfigExportPayload, ConfigImportReport }