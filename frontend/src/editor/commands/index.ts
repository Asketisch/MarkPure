/**
 * Re-export everything from the topic-specific modules so the
 * public path `import ... from '$lib/editor/commands'` keeps
 * working. New code is encouraged to import from the topic
 * module directly:
 *
 *   import { openFile } from '$lib/editor/commands/file'
 *   import { getOutline } from '$lib/editor/commands/editor'
 *
 * but the flat re-export here means existing callers don't
 * need a sweeping refactor.
 *
 * The IPC plumbing (the `ipc()` function and `__mt_dispatch`
 * handler) is intentionally NOT re-exported — it's an
 * internal implementation detail of these topic modules.
 */

export * from './types'
export * from './file'
export * from './editor'
export * from './workspace'
export * from './export'

// Internal — these are not part of the public surface but a
// few callers (the file-watcher helper) still reach for the
// ambient window globals. Re-export them so an existing
// `import { _resetIpcForTests } from '$lib/editor/commands'`
// keeps working. (The actual public functions are above.)
export { _resetIpcForTests } from './ipc'
