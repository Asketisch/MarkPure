/**
 * 前端日志器。
 *
 * 一个包在 `console` 上的小门面，它：
 *  - 按级别过滤（debug/info/warn/error），
 *  - 给每条消息打毫秒级时间戳，
 *  - 保存一个有界的近期日志环形缓冲，让崩溃报告能带上最后几 KB
 *    的活动记录，且不必在每次日志调用时同步触碰 `localStorage`。
 *
 * `debug` 级别在生产构建中保持静默。我们用 `import.meta.env.DEV`
 * 判断，它在构建时由 Vite 设置。浏览器控制台（F12）里用户看到的
 * 与底层 `console.*` 本会产生的消息一致。
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

// 阈值：开发环境全要；生产环境丢弃 debug 但保留 info 及以上。
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
  // 交给原生 console。让浏览器决定如何渲染结构化前缀——保持为
  // 字符串便于在 DevTools 中 grep。
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
   * 最近 `RING_SIZE` 条日志的快照。返回适合放进崩溃报告的
   * 扁平字符串。
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
