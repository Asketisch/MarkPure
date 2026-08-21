/**
 * Vim 模式插件的 ex 命令执行。
 *
 * 插件解析出的 ex 命令通过 `executeEx(cmd, ctx)` 派发。该函数
 * 调用既有的编辑器命令 / IPC 桥接；它不会直接改动文档
 * （结果是宿主侧的一个副作用）。
 *
 * 当前命令集：
 *   - `:w`           → 保存当前标签页
 *   - `:q`           → 关闭当前标签页（有未保存修改时拒绝）
 *   - `:wq` / `:x`   → 先保存再关闭
 *   - `:e`           → 从磁盘重新加载当前标签页
 *   - `:e <path>`    → 按相对路径打开工作区文件
 *   - `:b<N>`        → 切换到第 N 个标签页（从 1 开始编号）
 *
 * 宿主注入最小面的 `ExecContext`，让本模块易于单元测试
 * （无需 DOM、无需编辑器实例）：
 *
 *   - `save(): Promise<{ ok: boolean, error?: string }>`
 *   - `reload(): Promise<{ ok: boolean, error?: string }>`
 *   - `close(force = false): Promise<{ ok: boolean, error?: string }>`
 *   - `openFile(path: string): Promise<{ ok: boolean, error?: string }>`
 *   - `switchTab(index: number): Promise<{ ok: boolean, error?: string }>`
 *
 * 返回 `ExResult`，由插件转成一条临时的状态栏消息。
 */

import type { ExCmd } from './types'

export interface ExecContext {
  save: () => Promise<{ ok: boolean; error?: string }>
  reload: () => Promise<{ ok: boolean; error?: string }>
  close: (force?: boolean) => Promise<{ ok: boolean; error?: string }>
  /**
   * 按绝对路径或工作区相对路径打开文件。宿主把它接到既有的
   * `handleOpenFile` 流程上，该流程已处理路径解析与文档注册表
   * 更新。后续版本可以按名称做模糊匹配；当前只是直接委托。
   */
  openFile: (path: string) => Promise<{ ok: boolean; error?: string }>
  /**
   * 切换到第 N 个标签页（从 1 开始编号）。宿主把它接到
   * `switchTab(tabs[N-1].id)` 上。N 越界时返回
   * `{ ok: false, error }`，以便显示一条临时的状态消息。
   */
  switchTab: (index: number) => Promise<{ ok: boolean; error?: string }>
  isDirty: () => boolean
}

export type ExResult =
  | { ok: true; message: string }
  | { ok: false; message: string }

/** 针对宿主执行一条解析好的 ex 命令。 */
export async function executeEx(cmd: ExCmd, ctx: ExecContext): Promise<ExResult> {
  switch (cmd.type) {
    case 'write': {
      const r = await ctx.save()
      return r.ok
        ? { ok: true, message: 'wrote' }
        : { ok: false, message: r.error ?? 'write failed' }
    }
    case 'quit': {
      if (ctx.isDirty() && !ctx.close.length) {
        // 带强制关闭签名；交给宿主决定。
      }
      const r = await ctx.close(false)
      return r.ok
        ? { ok: true, message: 'closed' }
        : { ok: false, message: r.error ?? 'no write since last change (add ! to override)' }
    }
    case 'writeQuit': {
      const saveResult = await ctx.save()
      if (!saveResult.ok) {
        return { ok: false, message: saveResult.error ?? 'write failed' }
      }
      const closeResult = await ctx.close(true)
      return closeResult.ok
        ? { ok: true, message: 'wrote and closed' }
        : { ok: false, message: closeResult.error ?? 'close failed' }
    }
    case 'reload': {
      const r = await ctx.reload()
      return r.ok
        ? { ok: true, message: 'reloaded' }
        : { ok: false, message: r.error ?? 'reload failed' }
    }
    case 'edit': {
      const r = await ctx.openFile(cmd.path)
      return r.ok
        ? { ok: true, message: `opened ${cmd.path}` }
        : { ok: false, message: r.error ?? `no such file: ${cmd.path}` }
    }
    case 'buffer': {
      const r = await ctx.switchTab(cmd.index)
      return r.ok
        ? { ok: true, message: `switched to buffer ${cmd.index}` }
        : { ok: false, message: r.error ?? `no buffer ${cmd.index}` }
    }
  }
}
