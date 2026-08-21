/**
 * 拼写检查 store（Svelte 5 runes 单例）。
 *
 * 持有三份在三处共享的状态：
 *   - ProseMirror `spellcheck` 插件（消费 `enabled` + `language`
 *     决定是否发起 IPC 以及如何发起）
 *   - 右键 `SpellcheckMenu` 浮层（消费 `latestErrors` 查询
 *     点击区间对应的建议）
 *   - 设置面板（读写 `enabled` 与 `languageOverride`）
 *
 * 参照 `stores/i18n.svelte.ts` 的做法——在 App 根部通过
 * `createSpellcheck()` 创建单一实例，其他地方通过 Svelte context
 * 的 `useSpellcheck()` 读取。插件无法走 context（它在 Svelte
 * 组件树之外实例化），因此 App 根部把实例赋给模块级回退变量
 * `_globalInstance`，插件经 `getSpellcheckStore()` 读取。
 */
import { getContext, setContext } from 'svelte'

const SPELL_KEY = Symbol('spellcheck')

export interface SpellError {
  word: string
  start: number
  end: number
  suggestions: string[]
}

/**
 * 对激活文档最近一次 `checkSpelling` 应答的轻量内存缓存。
 * 拼写检查插件每次 IPC 返回时都会写入这里；右键浮层从这里
 * 读取点击位置对应的错误。
 *
 * 以 ProseMirror 绝对位置（`from` / `to`）为键而非 UTF-8 字节
 * 偏移，调用方可直接用 `view.posAtCoords` 的输出命中映射。
 */
export interface ErrorRange {
  from: number
  to: number
  word: string
  suggestions: string[]
}

class SpellcheckStore {
  /** 用户控制的总开关。默认值与 Rust 侧的
   *  `default_spellcheck_enabled` 一致（macOS 上为 true）。 */
  enabled = $state(false)
  /** 传给 IPC 的语言代码。`null` 表示跟随界面语言；插件在调用时
   *  用 `fallbackLanguage` 替代。 */
  languageOverride = $state<string | null>(null)
  /** 界面语言代码。App.svelte 从 i18n store 同步过来，用户未
   *  固定覆盖语言时，插件回退到它。 */
  fallbackLanguage = $state<string>('en')
  /** 最近一次 IPC 应答映射到 ProseMirror 坐标空间后的结果。
   *  字节偏移 → PM 位置的翻译由 ProseMirror 插件负责。 */
  latestErrors = $state<ErrorRange[]>([])
  
  setEnabled(v: boolean) { this.enabled = v }
  setLanguage(lang: string | null) { this.languageOverride = lang }
  setFallbackLanguage(lang: string) { this.fallbackLanguage = lang }
  setErrors(errors: ErrorRange[]) { this.latestErrors = errors }

  /** 下一次 IPC 调用实际使用的语言。 */
  effectiveLanguage(): string {
    return this.languageOverride ?? this.fallbackLanguage
  }

  /** 查找覆盖 `pos`（PM 绝对位置）的错误，若存在的话。 */
  errorAt(pos: number): ErrorRange | null {
    for (const e of this.latestErrors) {
      if (pos >= e.from && pos <= e.to) return e
    }
    return null
  }
}

// 模块级回退，让非 Svelte 代码（ProseMirror 插件）无需 context
// 管道即可访问 store。App 根部在 `createSpellcheck` 里设置它。
// WebView 中同一时刻只有一个应用实例，因此单例是安全的。
let _globalInstance: SpellcheckStore | null = null

export function createSpellcheck(): SpellcheckStore {
  const store = new SpellcheckStore()
  setContext(SPELL_KEY, store)
  _globalInstance = store
  return store
}

export function useSpellcheck(): SpellcheckStore {
  return getContext<SpellcheckStore>(SPELL_KEY)
}

/** 插件侧访问器。App 根部挂载前返回 null。 */
export function getSpellcheckStore(): SpellcheckStore | null {
  return _globalInstance
}
