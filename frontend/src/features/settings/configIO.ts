/**
 * Config export/import helpers for the Settings dialog's
 * "Backup & Restore" panel.
 *
 * Extracted from `Settings.svelte` so the small but fiddly
 * download-anchor dance (create Blob → object URL → synthetic
 * `<a>` click → revoke URL) and the matching file-pick →
 * JSON.parse → IPC pipeline live in a unit-testable module
 * rather than at the bottom of a 950-line component.
 *
 * The host IPC layer (`importConfig` / `exportConfig`) does
 * the actual work; this file only handles the browser-side
 * I/O around it.
 */

import type {
  ConfigExportPayload,
  ConfigImportReport,
} from '$lib/editor/commands'

/** Format a payload as a JSON string and trigger a download via
 *  a transient `<a>` element. Returns the suggested filename
 *  (YYYY-MM-DD-stamped) so the caller can log success or
 *  surface it in the UI. */
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

/** Read the first file selected by an `<input type=file>` event
 *  and parse it as JSON. Returns `null` if the user cancelled
 *  or the file is empty — both are valid user actions and
 *  shouldn't be treated as errors by the caller. */
export async function readJsonFromFileInput(
  e: Event,
): Promise<ConfigExportPayload | null> {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return null
  const text = await file.text()
  return JSON.parse(text) as ConfigExportPayload
}

/** Re-export the IPC report type so callers don't need a
 *  second import for the report UI. */
export type { ConfigExportPayload, ConfigImportReport }