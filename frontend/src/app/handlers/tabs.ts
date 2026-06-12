/**
 * Tab management — kept here so App.svelte's <script> doesn't
 * carry 200+ lines of tab bookkeeping.
 *
 * The `Tabs` class is instantiated **once** in App.svelte with
 * `new Tabs()` and lives for the whole app lifetime. Methods
 * mutate the `$state` arrays directly; consumers can read
 * `tabs.list` / `tabs.activeId` and the Svelte 5 reactivity
 * system tracks the changes.
 *
 * Why a class and not free functions: the handlers in here
 * (newTab, closeTab, switchTab, …) all share a few pieces of
 * state — `tabs`, `activeTabId`, `nextId` — and reach into
 * `editor` to flush content on close. A class bundles the
 * state + the read/write contract; the App wires the
 * side-effectful pieces (docClose IPC, editor destroy) in via
 * constructor callbacks so this file stays UI-agnostic and
 * easy to test.
 */
import type { Tab } from './types'

export interface TabsDeps {
  /** Flush the editor's current markdown back into the active
   *  tab's `content` field. Called before any close-path that
   *  may destroy the editor. */
  flushActiveContent: () => void
  /** Rust-side close: drops the doc from the LRU registry. */
  docClose: (id: number) => Promise<void>
  /** Re-mount the Tiptap editor for the current active tab. */
  initEditor: () => void
  /** Tear down the editor and clear the container. Used when
   *  the last tab is closed. */
  teardownEditor: () => void
}

export class Tabs {
  list = $state<Tab[]>([])
  activeId = $state<number | null>(null)
  nextId = $state(1)
  private deps: TabsDeps

  constructor(deps: TabsDeps) {
    this.deps = deps
  }

  get active(): Tab | undefined {
    if (this.activeId === null) return undefined
    return this.list.find((t) => t.id === this.activeId)
  }

  /** Switch to tab `id`. The App is responsible for the
   *  editor remount; this method just updates the active
   *  pointer and triggers a re-init via the dep. */
  switchTab(id: number, force: boolean = false): void {
    if (!force && this.activeId === id) return
    this.activeId = id
    // The actual `initEditor()` call is scheduled by the App
    // on the next animation frame so the DOM has a chance to
    // update; the App wires that via its own effect.
    queueMicrotask(() => this.deps.initEditor())
  }

  /** Open a new untitled tab and make it active. */
  newTab(untitledName: string): Tab {
    const tab: Tab = {
      id: this.nextId++,
      path: null,
      name: untitledName,
      dirty: false,
      content: '',
      mtime: null,
    }
    this.list = [...this.list, tab]
    this.switchTab(tab.id)
    return tab
  }

  /** Open an untitled tab with a custom display name (used
   *  for wikilink → missing-file flows). */
  openUntitled(name: string): Tab {
    const tab: Tab = {
      id: this.nextId++,
      path: null,
      name,
      dirty: false,
      content: '',
      mtime: null,
    }
    this.list = [...this.list, tab]
    this.switchTab(tab.id)
    return tab
  }

  /** Close a single tab. If it was active, move to the
   *  neighbour at the same index (or empty if the last tab
   *  was closed). */
  async closeTab(id: number): Promise<void> {
    const idx = this.list.findIndex((t) => t.id === id)
    if (idx === -1) return
    const wasActive = this.activeId === id

    if (wasActive) {
      this.deps.flushActiveContent()
    }
    this.deps.docClose(id).catch(() => {})

    this.list = this.list.filter((t) => t.id !== id)
    if (wasActive) {
      if (this.list.length > 0) {
        const newIdx = Math.min(idx, this.list.length - 1)
        this.activeId = this.list[newIdx].id
        queueMicrotask(() => this.deps.initEditor())
      } else {
        this.activeId = null
        this.deps.teardownEditor()
      }
    }
  }

  /** Close every tab except `keepId`. */
  async closeOtherTabs(keepId: number): Promise<void> {
    this.deps.flushActiveContent()
    for (const t of this.list) {
      if (t.id !== keepId) this.deps.docClose(t.id).catch(() => {})
    }
    const keepTab = this.list.find((t) => t.id === keepId)
    if (!keepTab) return
    this.list = [keepTab]
    this.activeId = keepId
    queueMicrotask(() => this.deps.initEditor())
  }

  /** Close every tab. */
  async closeAll(): Promise<void> {
    if (this.list.length === 0) return
    for (const t of this.list) this.deps.docClose(t.id).catch(() => {})
    this.list = []
    this.activeId = null
    this.deps.teardownEditor()
  }

  /** Close every tab to the right of `id` (inclusive of the
   *  tabs strictly after, not of `id` itself). */
  async closeTabsToRight(id: number): Promise<void> {
    const idx = this.list.findIndex((t) => t.id === id)
    if (idx === -1) return
    this.deps.flushActiveContent()
    for (let i = idx + 1; i < this.list.length; i++) {
      this.deps.docClose(this.list[i].id).catch(() => {})
    }
    this.list = this.list.slice(0, idx + 1)
    if (this.activeId !== null) {
      queueMicrotask(() => this.deps.initEditor())
    }
  }

  /** Bulk-close tabs by id. Used by the LRU-eviction path
   *  when the workspace root switches. */
  async closeManyById(ids: Set<number>): Promise<void> {
    if (ids.size === 0) return
    const wasActiveClosed = this.activeId !== null && ids.has(this.activeId)
    if (wasActiveClosed) {
      this.deps.flushActiveContent()
    }
    for (const t of this.list) {
      if (ids.has(t.id)) this.deps.docClose(t.id).catch(() => {})
    }
    this.list = this.list.filter((t) => !ids.has(t.id))
    if (wasActiveClosed) {
      if (this.list.length > 0) {
        this.activeId = this.list[0].id
        queueMicrotask(() => this.deps.initEditor())
      } else {
        this.activeId = null
        this.deps.teardownEditor()
      }
    }
  }
}
