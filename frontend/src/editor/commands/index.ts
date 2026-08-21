/**
 * 重新导出各主题模块的一切，让公共路径
 * `import ... from '$lib/editor/commands'` 继续可用。新代码建议
 * 直接从主题模块导入：
 *
 *   import { openFile } from '$lib/editor/commands/file'
 *   import { getOutline } from '$lib/editor/commands/editor'
 *
 * 但这里的扁平重新导出意味着现有调用方无需大规模重构。
 *
 * IPC 通信层（`ipc()` 函数与 `__mt_dispatch` 处理器）刻意**不**
 * 重新导出——它是这些主题模块的内部实现细节。
 */

export * from './types'
export * from './file'
export * from './editor'
export * from './workspace'
export * from './export'

// 内部——它们不属于公共表面，但少数调用方（文件监视助手）仍需要
// 触达环境的 window 全局量。重新导出它们，让既有的
// `import { _resetIpcForTests } from '$lib/editor/commands'`
// 继续可用（真正的公共函数见上）。
export { _resetIpcForTests } from './ipc'
