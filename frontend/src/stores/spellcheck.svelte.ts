/**
 * Spell-check store (Svelte 5 runes singleton).
 *
 * Holds three pieces of state shared between:
 *   - the ProseMirror `spellcheck` plugin (consumes `enabled`
 *     + `language` to decide whether to fire IPC and how)
 *   - the right-click `SpellcheckMenu` overlay (consumes
 *     `latestErrors` to look up the suggestions for the
 *     clicked range)
 *   - the Settings panel (reads + writes `enabled` and
 *     `languageOverride`)
 *
 * Modelled after `stores/i18n.svelte.ts` — a single instance
 * created at the App root via `createSpellcheck()` and read
 * elsewhere via `useSpellcheck()` through Svelte context. The
 * plugin can't go through context (it's instantiated outside
 * the Svelte component tree), so the App root assigns the
 * instance to a module-scoped fallback `_globalInstance`
 * that the plugin reads via `getSpellcheckStore()`.
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
 * Lightweight, in-memory cache of the most recent
 * `checkSpelling` reply for the active document. The
 * spellcheck plugin writes here every time its IPC resolves;
 * the right-click overlay reads here to find the error at
 * the clicked position.
 *
 * Keyed by ProseMirror absolute positions (`from` / `to`)
 * rather than UTF-8 byte offsets so callers can hit the map
 * with `view.posAtCoords` output directly.
 */
export interface ErrorRange {
  from: number
  to: number
  word: string
  suggestions: string[]
}

class SpellcheckStore {
  /** User-controlled master switch. Defaults match the
   *  Rust-side `default_spellcheck_enabled` (true on macOS). */
  enabled = $state(false)
  /** Language code to pass to the IPC. `null` means follow
   *  the UI language; the plugin substitutes `fallbackLanguage`
   *  at call time. */
  languageOverride = $state<string | null>(null)
  /** UI language code. App.svelte syncs this from the i18n
   *  store so the plugin can fall back to it when the user
   *  hasn't pinned an override. */
  fallbackLanguage = $state<string>('en')
  /** Most recent IPC reply mapped into ProseMirror coordinate
   *  space. The ProseMirror plugin owns the byte-offset →
   *  PM-position translation. */
  latestErrors = $state<ErrorRange[]>([])

  setEnabled(v: boolean) { this.enabled = v }
  setLanguage(lang: string | null) { this.languageOverride = lang }
  setFallbackLanguage(lang: string) { this.fallbackLanguage = lang }
  setErrors(errors: ErrorRange[]) { this.latestErrors = errors }

  /** The language to actually use for the next IPC call. */
  effectiveLanguage(): string {
    return this.languageOverride ?? this.fallbackLanguage
  }

  /** Find the error covering `pos` (PM absolute), if any. */
  errorAt(pos: number): ErrorRange | null {
    for (const e of this.latestErrors) {
      if (pos >= e.from && pos <= e.to) return e
    }
    return null
  }
}

// Module-scoped fallback so non-Svelte code (the ProseMirror
// plugin) can reach the store without context plumbing. The
// App root sets this in `createSpellcheck`. Only one app
// instance ever runs in the WebView, so the singleton is safe.
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

/** Plugin-side accessor. Returns null until App root mounts. */
export function getSpellcheckStore(): SpellcheckStore | null {
  return _globalInstance
}
