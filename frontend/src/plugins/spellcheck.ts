/**
 * ProseMirror 拼写检查插件。
 *
 * 每次文档变化时我们：
 *   1. 尝试通过 tr.mapping 重新映射既有错误装饰
 *      （与 search.ts 使用的快速路径相同）。错误范围内的编辑
 *      会收缩到宽度 0 → 被丢弃；范围外的编辑则正确滑动区间。
 *   2. 安排一次防抖（500ms）的 IPC `checkSpelling` 调用
 *      来刷新错误列表。
 *
 * 插件持有*位置*；右键浮层从共享的 `spellcheck.svelte.ts`
 * store 读取同样的位置，这样用户右键时我们无需遍历装饰集。
 *
 * 为什么用独立插件（而不是并入 search 插件）：
 *   - 防抖语义不同（搜索是交互式的，拼写检查是后台的）
 *   - 装饰类名不同
 *   - 搜索的快速路径按*字面*匹配重映射；拼写错误没有可匹配的
 *     查询词，无法重新推导——只能等待 IPC 返回。
 */
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { checkSpelling, type SpellError as IpcSpellError } from '../editor/commands/editor'
import { getSpellcheckStore, type ErrorRange } from '../stores/spellcheck.svelte'

const DEBOUNCE_MS = 500
const MAX_DOC_BYTES = 200_000 // 跳过约 200KB 以上的文档；NSSpellChecker 能处理它们，但渲染上千条装饰会卡住

export interface SpellState {
  errors: ErrorRange[]
  decorations: DecorationSet
  pendingTimer: number | null
}

export const spellPluginKey = new PluginKey<SpellState>('markpure-spellcheck')

/**
 * 构建一份 textBetween 投影和一份位置映射，
 * 让我们能把 UTF-8 字节偏移（Rust IPC 返回的）
 * 还原为绝对的 ProseMirror 位置。
 *
 * Rust 侧按 UTF-8 字节计数；ProseMirror 按码点（即文档索引）计数。
 * 对投影中的每个字符，我们记录：
 *   - `byteToPos[byteIndex] = pmPos`
 *   - 对于多字节字符内的每一个字节，都指向同一个 pmPos，
 *     这样落在字符中间的偏移也不会丢失。
 *
 * 块边界处会在文本中插入一个 `\n`，并在映射中记录一个单字节，
 * 指向离开节点之后紧邻的位置——与 `doc.textBetween(_, _, '\n')`
 * 的结果一致。
 */
function projectDoc(doc: PMNode): { text: string; byteToPos: number[] } {
  let text = ''
  const byteToPos: number[] = []

  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      // 每个字符的 UTF-8 字节长度决定它贡献多少项映射。
      let charIdx = 0
      for (const ch of node.text) {
        const pmPos = pos + charIdx
        const utf8Len = byteLen(ch)
        for (let i = 0; i < utf8Len; i++) {
          byteToPos.push(pmPos)
        }
        text += ch
        charIdx += ch.length // JS 字符串索引是 UTF-16 码元
      }
      return false // 文本节点是叶子节点
    }
    if (node.isBlock && text.length > 0 && !text.endsWith('\n')) {
      // 镜像 textBetween('\n') 的分隔符。我们记录的 pmPos
      // 恰在块边界处；拼写错误永远不会跨越块边界，
      // 所以这项映射其实永不会被查询，但为了保持一致仍记录它。
      text += '\n'
      byteToPos.push(pos)
    }
    return true
  })

  // 文档结尾的哨兵项。
  byteToPos.push(doc.content.size)
  return { text, byteToPos }
}

function byteLen(ch: string): number {
  const code = ch.codePointAt(0) ?? 0
  if (code < 0x80) return 1
  if (code < 0x800) return 2
  if (code < 0x10000) return 3
  return 4
}

// --- projectDoc 缓存 ---
// 当文档自上次检查以来没有变化时，
// 避免重建整份文本投影与 byteToPos 数组。
// 缓存以 doc 对象身份为键（不能只按 size——两个大小恰好
// 相同的文档，如多编辑器/分栏场景，会互相拿到对方的
// 字节→位置映射，把错误标在错误位置）。
let cachedDoc: PMNode | null = null
let cachedProjection: { text: string; byteToPos: number[] } | null = null

function projectDocCached(doc: PMNode): { text: string; byteToPos: number[] } {
  if (cachedDoc === doc && cachedProjection) {
    return cachedProjection
  }
  cachedProjection = projectDoc(doc)
  cachedDoc = doc
  return cachedProjection
}

/** 使 projectDoc 缓存失效（文档变化时调用）。 */
function invalidateProjectionCache() {
  cachedDoc = null
  cachedProjection = null
}

/** 尝试通过事务的映射重新定位既有错误。
 *  任何收缩为空的项都会被丢弃。 */
function remapErrors(tr: any, prev: ErrorRange[]): ErrorRange[] {
  const out: ErrorRange[] = []
  for (const e of prev) {
    const from = tr.mapping.map(e.from, 1)
    const to = tr.mapping.map(e.to, -1)
    if (from >= to) continue
    out.push({ ...e, from, to })
  }
  return out
}

function buildDecorations(doc: PMNode, errors: ErrorRange[]): DecorationSet {
  if (errors.length === 0) return DecorationSet.empty
  const docSize = doc.content.size
  const decos = errors
    .filter(e => e.from >= 0 && e.to <= docSize && e.from < e.to)
    .map(e => Decoration.inline(e.from, e.to, { class: 'spell-error' }))
  return DecorationSet.create(doc, decos)
}

/**
 * 安排一次防抖刷新。会取消上一次未执行的调用。
 * IPC 返回结果通过一个新事务应用
 * （meta = { type: 'setErrors', errors }）。
 */
function scheduleRefresh(view: EditorView, prevTimer: number | null): number {
  if (prevTimer !== null) clearTimeout(prevTimer)
  return window.setTimeout(() => {
    void runCheck(view)
  }, DEBOUNCE_MS) as unknown as number
}

// 每个编辑器实例一个递增检查序号：防抖检查、forceSpellcheckRecheck、
// 应用建议后的复查可能重叠，晚到的旧 IPC 应答会覆盖新结果，
// 因此应答时必须校验序号（与 WorkspaceSearch 的 searchSeq 同模式）。
const checkSeq = new WeakMap<EditorView, number>()

async function runCheck(view: EditorView): Promise<void> {
  const store = getSpellcheckStore()
  if (!store || !store.enabled) return

  const { doc } = view.state
  const docSize = doc.content.size
  if (docSize === 0) {
    pushErrors(view, [])
    return
  }
  if (docSize > MAX_DOC_BYTES) {
    // 跳过超大文档——NSSpellChecker 处理它们没问题，
    // 但渲染数千条行内装饰会拖垮 ProseMirror，
    // 右键浮层也会变得不可用。清除任何过期状态。
    pushErrors(view, [])
    return
  }

  const { text, byteToPos } = projectDocCached(doc)
  if (text.length === 0) {
    pushErrors(view, [])
    return
  }

  // 实际生效的语言由 store 决定（用户覆盖值或 UI 语言环境的回退值）。
  // App.svelte 让 `fallbackLanguage` 与 i18n 保持同步。
  const lang = store.effectiveLanguage()

  const seq = (checkSeq.get(view) ?? 0) + 1
  checkSeq.set(view, seq)

  let result: { errors: IpcSpellError[] } | null = null
  try {
    result = await checkSpelling(text, lang)
  } catch (e) {
    console.warn('[spellcheck] IPC failed:', e)
    return
  }

  // 过期应答：期间发起了更新的检查，或文档已变化
  // （doc 对象会被替换）。两种情况下 byteToPos 都已失效。
  if (checkSeq.get(view) !== seq || view.state.doc !== doc) return

  // 把 UTF-8 字节偏移转换为 PM 位置。
  const errs: ErrorRange[] = []
  for (const err of result.errors ?? []) {
    const from = byteToPos[err.start]
    const to = byteToPos[err.end]
    if (from === undefined || to === undefined || from >= to) continue
    errs.push({ from, to, word: err.word, suggestions: err.suggestions })
  }
  pushErrors(view, errs)
}

function pushErrors(view: EditorView, errors: ErrorRange[]): void {
  const tr = view.state.tr.setMeta(spellPluginKey, {
    type: 'setErrors',
    errors,
  })
  view.dispatch(tr)
}

function emptyState(): SpellState {
  return {
    errors: [],
    decorations: DecorationSet.empty,
    pendingTimer: null,
  }
}

export function createSpellcheckPlugin(): Plugin {
  return new Plugin({
    key: spellPluginKey,

    state: {
      init() {
        return emptyState()
      },

      apply(tr, prev, _old, newState): SpellState {
        const meta = tr.getMeta(spellPluginKey) as
          | { type: 'setErrors'; errors: ErrorRange[] }
          | { type: 'clear' }
          | { type: 'forceRefresh' }
          | undefined

        if (meta?.type === 'setErrors') {
          // 缓存到共享 store 中，右键浮层无需遍历装饰集即可读取。
          getSpellcheckStore()?.setErrors(meta.errors)
          return {
            ...prev,
            errors: meta.errors,
            decorations: buildDecorations(newState.doc, meta.errors),
          }
        }
        if (meta?.type === 'clear') {
          getSpellcheckStore()?.setErrors([])
          return emptyState()
        }

        if (tr.docChanged) {
          // 跳过 heading-id 追加事务的昂贵处理：它们只修改标题的
          // `id` 属性，而不改动文本内容。
          if (tr.getMeta('headingId')) return prev
          // 文档已变化，使 projectDoc 缓存失效
          invalidateProjectionCache()
          // 快速路径：通过事务映射重定位既有错误位置，
          // 并用 DecorationSet.map（复杂度 O(变化量)）
          // 取代重建全部装饰（复杂度 O(文档)）。
          // 精确位置稍后由 IPC 响应带回。
          const remapped = remapErrors(tr, prev.errors)
          getSpellcheckStore()?.setErrors(remapped)
          return {
            ...prev,
            errors: remapped,
            decorations: prev.decorations.map(tr.mapping, newState.doc),
          }
        }

        return prev
      },
    },

    view(view) {
      // 初始检查 + 每次编辑后的防抖刷新。
      let timer: number | null = null
      const tick = () => {
        timer = scheduleRefresh(view, timer)
      }
      // 挂载后立即执行一次，让已加载的文档立刻显示错误。
      // 等一帧，确保文档已完全挂接。
      requestAnimationFrame(() => tick())

      return {
        update(_view, _prevState) {
          // 只有当上一条事务确实改变了文档时才重新触发
          // （上面的 apply() 已经完成重映射）。
          tick()
        },
        destroy() {
          if (timer !== null) clearTimeout(timer)
        },
      }
    },

    props: {
      decorations(state) {
        return spellPluginKey.getState(state)?.decorations ?? DecorationSet.empty
      },
    },
  })
}

/** 命令式触发——供命令面板的「tools.spellcheck」条目
 *  强制立即重新检查。 */
export function forceSpellcheckRecheck(view: EditorView): void {
  void runCheck(view)
}

/** 用 `replacement` 替换 `[from..to]`，并立即重新检查，
 *  使红色下划线的消失（修正正确）或移位（仍不正确）。 */
export function applySpellSuggestion(
  view: EditorView,
  from: number,
  to: number,
  replacement: string,
): void {
  const tr = view.state.tr.insertText(replacement, from, to)
  view.dispatch(tr)
  // 在下一帧重新检查，让 IPC 看到新文本。
  requestAnimationFrame(() => runCheck(view))
}
