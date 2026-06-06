/**
 * Frontend logger.
 *
 * A small facade over `console` that:
 *  - filters by level (debug/info/warn/error),
 *  - tags every message with a millisecond timestamp,
 *  - keeps a bounded ring buffer of recent log lines so a
 *    crash report can include the last few KB of activity
 *    without us touching `localStorage` synchronously on
 *    every log call.
 *
 * The `debug` level is silent in production builds. We detect
 * that via `import.meta.env.DEV`, which Vite sets at build
 * time. In the browser console (F12) the user sees the same
 * messages as the underlying `console.*` would have produced.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

// Threshold: in dev we want everything; in prod we drop
// debug but keep info+.
const minLevel: LogLevel = (typeof import.meta !== 'undefined' && (import.meta as { env?: { DEV?: boolean } }).env?.DEV)
  ? 'debug'
  : 'info'

const RING_SIZE = 256
const ring: { level: LogLevel; ts: number; args: unknown[] }[] = []

function record(level: LogLevel, args: unknown[]) {
  if (LEVEL_RANK[level] < LEVEL_RANK[minLevel]) return
  ring.push({ level, ts: Date.now(), args })
  if (ring.length > RING_SIZE) ring.shift()

  const prefix = `[${new Date().toISOString()}] [${level.toUpperCase()}]`
  // Hand off to the native console. We let the browser decide
  // how to render the structured prefix — keeping it as a
  // string keeps it grep-friendly in DevTools.
  switch (level) {
    case 'debug': console.debug(prefix, ...args); break
    case 'info':  console.info(prefix, ...args); break
    case 'warn':  console.warn(prefix, ...args); break
    case 'error': console.error(prefix, ...args); break
  }
}

export const logger = {
  debug: (...args: unknown[]) => record('debug', args),
  info:  (...args: unknown[]) => record('info', args),
  warn:  (...args: unknown[]) => record('warn', args),
  error: (...args: unknown[]) => record('error', args),
  /**
   * Snapshot of the last `RING_SIZE` log lines. Returned as
   * a flat string suitable for inclusion in a crash report.
   */
  dump(): string {
    return ring
      .map(e => `[${new Date(e.ts).toISOString()}] [${e.level.toUpperCase()}] ${e.args.map(stringify).join(' ')}`)
      .join('\n')
  },
}

function stringify(v: unknown): string {
  if (typeof v === 'string') return v
  if (v instanceof Error) return `${v.name}: ${v.message}`
  try { return JSON.stringify(v) } catch { return String(v) }
}
