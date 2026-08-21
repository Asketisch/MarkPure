/**
 * 侧边栏对话框 + 错误横幅的状态形态。
 *
 * 从 `WorkSpace.svelte` 中拆出，让 `DialogState` 判别联合与自动
 * 消失的错误横幅助手集中在一个模块。组件仍持有真正的 `$state`
 * 单元——这里只定义类型与小块助手。
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

/** 在 `ms` 毫秒后自动消失内联错误横幅。返回一个 `setTimeout`
 *  句柄，调用方应保存在模块作用域变量里，这样第二次 `flashError`
 *  能在安排新定时器前取消上一个。 */
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