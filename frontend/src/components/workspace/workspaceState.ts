/**
 * Sidebar dialog + error-banner state shape.
 *
 * Extracted from `WorkSpace.svelte` so the `DialogState`
 * discriminated union and the auto-dismissing error-banner
 * helpers live in one focused module. The component still
 * owns the actual `$state` cells — we just define the types
 * and small helpers here.
 */

export interface DialogState {
  type: 'confirm' | 'input'
  title: string
  message: string
  confirmText: string
  cancelText: string
  inputValue: string
  onConfirm: (value?: string) => void | Promise<void>
}

/** Auto-dismiss an inline error banner after `ms` milliseconds.
 *  Returns a `setTimeout` handle the caller should keep in a
 *  module-scope variable so a second `flashError` can cancel
 *  the previous timer before scheduling a new one. */
export function flashError(
  setMessage: (msg: string | null) => void,
  clearTimer: () => void,
  setTimer: (id: ReturnType<typeof setTimeout>) => void,
  msg: string,
  ms = 6000,
): void {
  setMessage(msg)
  clearTimer()
  setTimer(setTimeout(() => setMessage(null), ms))
}