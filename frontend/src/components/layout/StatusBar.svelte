<script lang="ts">
  /**
   * 状态栏——编辑器区域底部。
   *
   * 作为文件体积审计的一部分，从 App.svelte 中拆出
   * （App.svelte 当时有 1367 行）。该组件纯粹是展示性的：
   * 它接收文档统计 + `saving` 标志并渲染它们。所有文案翻译
   * 都经由 i18n 属性完成。
   */
  import { useI18n } from '$lib/stores/i18n.svelte'

  interface DocStats {
    words: number
    characters: number
    lines: number
  }

  let {
    stats,
    saving,
    multiCursorCount = 0,
    columnMode = false,
    undoBranchCount = 0,
    undoIsForked = false,
    vimEnabled = false,
    vimMode = 'normal',
    vimPending = '',
    /** 当前选中区域内的字符数（未选中时为 0）。驱动
     *  文档统计旁的「已选 N 字」小徽标，给用户即时的
     *  选区反馈。 */
    selectionChars = 0,
    /** 最近一次成功保存的时间戳（自纪元起的毫秒数）。
     *  为 `null` 时完全隐藏该指示器，让刚打开的新标签页
     *  在用户保存前不显示「刚刚已保存」。我们通过 `savedTick`
     *  rune 每分钟重新读取一次 `Date.now()`，让「X 分钟前」
     *  这类可读标签无需全局定时器也能保持新鲜。 */
    savedAt = null as number | null,
    /** 字数目标。当大于 0 时，状态栏渲染 `<当前> / <目标> (<百分比>%)`，
     *  让用户能对照写作目标跟踪进度。`0`（默认值）隐藏该指示器。 */
    wordCountGoal = 0,
    /** 「跳到顶部 / 跳到底部」回调。在状态栏右缘渲染成
     *  小的 ↑ / ↓ 按钮。宿主把它们接到 `editor.commands.focus()`
     *  + `setTextSelection` + `scrollIntoView` 上，让光标落到
     *  文档开头 / 结尾并随之滚动视口。组件本身与编辑器解耦——
     *  与 `StatusBar` 其他由宿主驱动的动作形态一致。 */
    onJumpTop = () => {},
    onJumpBottom = () => {},
  }: {
    stats: DocStats
    saving: boolean
    /** 次光标数量（多光标）。大于 0 时编辑器处于多光标模式。 */
    multiCursorCount?: number
    /** 用户正在 Alt+拖拽列选择矩形时置为 true。在多光标计数
     *  旁渲染一个小徽标，让用户知道当前正在做什么。 */
    columnMode?: boolean
    /** 分支式撤销树中当前的节点总数。 */
    undoBranchCount?: number
    /** 当前路径至少有一个兄弟节点（即树在某处出现过分支）
     *  时为 true。 */
    undoIsForked?: boolean
    /** Vim 模式启用时为 true。 */
    vimEnabled?: boolean
    /** 当前 Vim 模式。决定徽标的颜色与文案。 */
    vimMode?: 'normal' | 'insert' | 'visual' | 'visual-line' | 'visual-block' | 'replace'
    /** 待解析的计数/操作符显示（例如 "3d"）。 */
    vimPending?: string
    selectionChars?: number
    savedAt?: number | null
    wordCountGoal?: number
    onJumpTop?: () => void
    onJumpBottom?: () => void
  } = $props()

  const i18n = useI18n()

  /** 为每种 Vim 模式渲染一个简短标签。 */
  function labelForVimMode(mode: typeof vimMode): string {
    if (mode === 'normal') return 'NORMAL'
    if (mode === 'insert') return 'INSERT'
    if (mode === 'visual') return 'VISUAL'
    if (mode === 'visual-line') return 'V-LINE'
    if (mode === 'visual-block') return 'V-BLOCK'
    return 'REPLACE'
  }

  // 阅读时长估算。平均阅读速度约为散文 250 词/分钟；
  // 中文读者更接近 500 字/分钟，因此根据 `doc_get_stats`
  // 已返回的中文字符数混合两种启发式
  // （Rust 端把每个汉字都计作一个词）。
  let readingTime = $derived.by(() => {
    const minutes = stats.words / 250
    if (minutes < 1) return '< 1 min'
    if (minutes < 60) return `${Math.round(minutes)} min`
    const hours = Math.floor(minutes / 60)
    const rest = Math.round(minutes - hours * 60)
    return rest > 0 ? `${hours} h ${rest} min` : `${hours} h`
  })

  // 「X 前保存」指示器。我们通过一个会跳动的 rune 每分钟
  // 重新推导一次人性化文案；否则用户盯着文档看 5 分钟，
  // 在触发任何状态变更前，仍会看到「1 分钟前保存」。
  let savedTick = $state(0)
  $effect(() => {
    if (savedAt == null) return
    const handle = window.setInterval(() => {
      savedTick++
    }, 60_000)
    return () => window.clearInterval(handle)
  })
  let savedLabel = $derived.by(() => {
    void savedTick
    if (savedAt == null) return null
    const ms = Date.now() - savedAt
    if (ms < 5_000) return i18n.t('status.saved_just_now')
    if (ms < 60_000) return i18n.t('status.saved_seconds_ago')
    if (ms < 3_600_000) {
      const m = Math.floor(ms / 60_000)
      return i18n.t('status.saved_minutes_ago').replace('{n}', String(m))
    }
    if (ms < 86_400_000) {
      const h = Math.floor(ms / 3_600_000)
      return i18n.t('status.saved_hours_ago').replace('{n}', String(h))
    }
    const d = Math.floor(ms / 86_400_000)
    return i18n.t('status.saved_days_ago').replace('{n}', String(d))
  })

  // 字数目标进度。在文档统计旁渲染为 `<当前> / <目标> (<百分比>%)`；
  // 目标为 `0`（默认）时隐藏。我们把百分比钳制在 100%，
  // 避免超长文档显示 `150%` 这样的数字。
  let wordGoalLabel = $derived.by(() => {
    if (!wordCountGoal || wordCountGoal <= 0) return null
    const pct = Math.min(100, Math.round((stats.words / wordCountGoal) * 100))
    return i18n.t('status.word_goal')
      .replace('{current}', String(stats.words))
      .replace('{goal}', String(wordCountGoal))
      .replace('{pct}', String(pct))
  })
</script>

<footer class="status-bar">
  <span>{stats.lines} {i18n.t('status.lines')}</span>
  <span>{stats.words} {i18n.t('status.words')}</span>
  <span>{stats.characters} {i18n.t('status.chars')}</span>
  <span class="reading-time" title={i18n.t('status.reading_time_tooltip')}>
    {readingTime}
  </span>
  {#if wordGoalLabel}
    <span class="word-goal" title={i18n.t('status.word_goal_tooltip')}>
      {wordGoalLabel}
    </span>
  {/if}
  {#if selectionChars > 0}
    <span class="selection" title={i18n.t('status.selection_tooltip')}>
      {i18n.t('status.selection')}: {selectionChars}
    </span>
  {/if}
  {#if multiCursorCount > 0}
    <span class="multi-cursor" title="Multi-cursor mode (Esc to exit)">
      {i18n.t('status.multi_cursor')} ({multiCursorCount})
    </span>
  {/if}
  {#if columnMode}
    <span class="multi-cursor" title="Column select mode (Esc to exit)">
      {i18n.t('status.column_select')}
    </span>
  {/if}
  {#if vimEnabled}
    <span
      class="vim-mode vim-mode--{vimMode}"
      title="Vim mode (Cmd+. to toggle)"
    >
      {labelForVimMode(vimMode)}{vimPending ? `│${vimPending}` : ''}
    </span>
  {/if}
  {#if undoBranchCount > 1}
    <span class="undo-tree" title="Branching undo tree">
      {i18n.t('status.undo_tree')} ({undoBranchCount}{undoIsForked ? '·fork' : ''})
    </span>
  {/if}
  {#if saving}
    <span class="saving">{i18n.t('status.saving')}</span>
  {:else if savedLabel}
    <span class="saved-at" title={i18n.t('status.saved_at_tooltip')}>{savedLabel}</span>
  {/if}
  <!-- ↑ / ↓ 跳转按钮。始终渲染，给用户一个稳定的视觉
      提示（保存指示器会替换出入，按钮位置从不移动）。
      `margin-left: auto` 让它们贴住右缘。 -->
  <div class="jump-buttons" role="group" aria-label={i18n.t('status.jump_buttons_aria')}>
    <button class="jump-btn" onclick={onJumpTop} title={i18n.t('status.jump_top_tooltip')} aria-label={i18n.t('status.jump_top_tooltip')}>↑</button>
    <button class="jump-btn" onclick={onJumpBottom} title={i18n.t('status.jump_bottom_tooltip')} aria-label={i18n.t('status.jump_bottom_tooltip')}>↓</button>
  </div>
</footer>

<style>
  .status-bar {
    display: flex;
    gap: 16px;
    padding: 4px 12px;
    background: var(--bg-secondary);
    border-top: 1px solid var(--border);
    color: var(--text-secondary);
    font-size: 11px;
  }
  .multi-cursor {
    color: var(--mc-cursor-color, #e51400);
    font-weight: 600;
  }
  .undo-tree {
    color: var(--accent);
    font-weight: 600;
  }
  .reading-time {
    color: var(--text-secondary);
  }
  /* 字数目标徽标。仅在用户设置了目标时渲染。
     越过 100% 后颜色变为强调色，让用户看到
     这一里程碑。 */
  .word-goal {
    color: var(--text-secondary);
  }
  .word-goal.is-complete {
    color: var(--accent);
    font-weight: 600;
  }
  .selection {
    color: var(--accent);
    font-weight: 600;
  }
  /* Vim 模式徽标。按模式区分颜色。 */
  .vim-mode {
    padding: 1px 6px;
    border-radius: 3px;
    font-weight: 600;
    font-family: var(--editor-font-family);
    transition: background-color 120ms ease;
  }
  .vim-mode--normal  { background: var(--bg-tertiary, #e0e0e0); color: var(--text, #1a1a1a); }
  .vim-mode--insert  { background: #2e7d32; color: #fff; }
  .vim-mode--visual  { background: #1565c0; color: #fff; }
  .vim-mode--visual-line { background: #6a1b9a; color: #fff; }
  .vim-mode--visual-block{ background: #c62828; color: #fff; }
  .vim-mode--replace { background: #ef6c00; color: #fff; }
  .saving {
    margin-left: auto;
    color: var(--accent);
    animation: pulse 1s ease-in-out infinite;
  }
  /* 「X 前保存」指示器。与保存脉冲共用同一个右对齐槽位，
     两者之间的过渡因此无缝衔接。 */
  .saved-at {
    margin-left: auto;
    color: var(--text-secondary);
    font-size: 11px;
  }
  /* ↑ / ↓ 跳转按钮。渲染在保存指示器旁边；二者都靠父级
     flex 容器的 `margin-left: auto` 锚定到右缘。 */
  .jump-buttons {
    margin-left: auto;
    display: flex;
    gap: 2px;
  }
  .jump-btn {
    background: none;
    border: 1px solid transparent;
    color: var(--text-secondary);
    width: 22px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border-radius: 3px;
    font-size: 12px;
    line-height: 1;
    padding: 0;
  }
  .jump-btn:hover {
    background: var(--menu-hover-bg);
    color: var(--menu-hover-text);
  }
  @keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.5 } }
</style>
