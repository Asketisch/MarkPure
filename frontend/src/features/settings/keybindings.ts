/**
 * Keyboard-binding helpers used by the Settings → Shortcuts panel.
 *
 * Lives outside the component so the platform-dependent symbol
 * maps (`\u2318` for Cmd, `\u21E7` for Shift, etc.) can be unit
 * tested in isolation and reused by future keybinding surfaces
 * (e.g. an in-app shortcut recorder overlay).
 *
 * The "recording" code path needs a DOM event so it's kept in
 * the component, but the formatting logic — which is pure —
 * is here.
 */

import type { KeyBinding } from '$lib/editor/commands'

/** Modifier keys we filter out of the captured event so
 *  the resulting accelerator string contains exactly one
 *  logical key. The `Meta`/`Control`/`Shift`/`Alt` tokens
 *  are the only ones the host-side parser recognises. */
const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Shift', 'Alt'])

/** Build an accelerator string (`CmdOrCtrl+Shift+A`) from a
 *  keyboard event. We always emit `CmdOrCtrl` rather than the
 *  raw `Cmd`/`Ctrl` so the same record works on Windows/Linux
 *  without re-binding. */
export function acceleratorFromEvent(e: KeyboardEvent): string | null {
  const parts: string[] = []
  if (e.metaKey || e.ctrlKey) parts.push('CmdOrCtrl')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')

  const key = e.key
  if (MODIFIER_KEYS.has(key)) return null
  parts.push(key.length === 1 ? key.toUpperCase() : key)
  return parts.join('+')
}

/** Pretty-print an accelerator for display. We swap the canonical
 *  `CmdOrCtrl` token for the platform-specific glyph (\u2318 on
 *  macOS, `Ctrl` elsewhere) so the shortcut list reads naturally. */
export function formatAccelerator(
  acc: string | null,
  platform: string,
): string {
  if (!acc) return '—'
  return acc
    .replace('CmdOrCtrl', platform.includes('Mac') ? '\u2318' : 'Ctrl')
    .replace('Shift', '\u21E7')
    .replace('Alt', '\u2325')
}

/** Convenience helper for the Shortcuts panel: filter out the
 *  empty modifier-only capture from a recording session. */
export function isCompleteBinding(e: KeyboardEvent): boolean {
  return !MODIFIER_KEYS.has(e.key)
}

/** Re-export so the Settings component can keep its existing
 *  `KeyBinding` import path (some callers re-export through
 *  this module instead of the IPC layer). */
export type { KeyBinding }