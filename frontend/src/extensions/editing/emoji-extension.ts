import { Extension } from '@tiptap/core'
import { InputRule } from '@tiptap/core'

/**
 * P0-X: Typora-style emoji shortcode expansion. Typing
 * `:smile:` and pressing Space / Enter / Tab
 * automatically rewrites the literal `smile` to `😄`. The
 * rule fires only on a word boundary so a URL like
 * `https://example.com/:1234` is left alone.
 *
 * The shortcode table is a small, conservative subset
 * (~80 entries) — enough to cover the common
 * GitHub/Slack/Discord shortcodes that users expect to
 * work, without bundling the full `node-emoji` data set
 * (which would add ~50KB to the renderer bundle). Users
 * who want more can extend the table via the
 * `additionalShortcodes` extension option.
 */

export interface EmojiOptions {
  /** Extra shortcodes merged into the built-in table.
   *  Last-write-wins on duplicate keys. */
  additionalShortcodes?: Record<string, string>
}

/** Built-in shortcode table. Keep this list conservative
 *  — only widely-recognised shortcodes that users
 *  actually type. The full GitHub emoji list is 1800+
 *  entries; we'd rather ship 80 the right way than 1800
 *  most of which nobody will ever type.
 *
 * Exported so the `validate-emoji-shortcode.ts` script
 * can assert the regex stays in sync with the actual
 * table. */
export const DEFAULT_SHORTCODES: Record<string, string> = {
  // Smileys
  smile: '😄',
  grinning: '😀',
  laugh: '😆',
  joy: '😂',
  rofl: '🤣',
  wink: '😉',
  blush: '😊',
  yum: '😋',
  sunglasses: '😎',
  heart_eyes: '😍',
  kissing_heart: '😘',
  thinking: '🤔',
  neutral_face: '😐',
  expressionless: '😑',
  no_mouth: '😶',
  smirk: '😏',
  unamused: '😒',
  roll_eyes: '🙄',
  grimacing: '😬',
  lying_face: '🤥',
  relieved: '😌',
  pensive: '😔',
  sleepy: '😪',
  sleepy_face: '😴',
  mask: '😷',
  // Hands
  wave: '👋',
  raised_hand: '✋',
  ok_hand: '👌',
  thumbsup: '👍',
  thumbsdown: '👎',
  clap: '👏',
  pray: '🙏',
  // Hearts / symbols
  heart: '❤️',
  broken_heart: '💔',
  sparkles: '✨',
  star: '⭐',
  fire: '🔥',
  zap: '⚡',
  boom: '💥',
  tada: '🎉',
  confetti_ball: '🎊',
  // Status
  rocket: '🚀',
  warning: '⚠️',
  x: '❌',
  white_check_mark: '✅',
  no_entry: '⛔',
  // Common
  coffee: '☕',
  tea: '🍵',
  pizza: '🍕',
  burger: '🍔',
  beer: '🍺',
  cocktail: '🍸',
  apple: '🍎',
  banana: '🍌',
  cherry: '🍒',
  // Arrows / pointers
  point_right: '👉',
  point_left: '👈',
  point_up: '👆',
  point_down: '👇',
}

/** Compose the lookup table from the built-in set plus
 *  any `additionalShortcodes` the host injected. */
function buildTable(opts: EmojiOptions): Record<string, string> {
  const out = { ...DEFAULT_SHORTCODES }
  if (opts.additionalShortcodes) {
    Object.assign(out, opts.additionalShortcodes)
  }
  return out
}

/** Escape a shortcode for use in a regex character class.
 *  None of our shortcodes contain regex meta-characters
 *  in practice, but defending against an `additionalShortcodes`
 *  override keeps the rule safe. */
function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export const EmojiShortcodeExtension = Extension.create<EmojiOptions>({
  name: 'emojiShortcode',

  addOptions() {
    return {
      additionalShortcodes: undefined,
    }
  },

  addInputRules() {
    const table = buildTable(this.options)
    const shortcodes = Object.keys(table)
      .sort((a, b) => b.length - a.length) // longest first so `:point_right:` wins over `:point:`
    // Build a single combined regex that matches any known
    // shortcode. The capture group at index 1 is the
    // shortcode name (without the colons) so the handler
    // can look it up in `table`.
    const alternation = shortcodes.map(escapeForRegex).join('|')
    // We anchor the rule on a word boundary to the left so
    // URLs like `https://example.com/:smile:` aren't matched
    // (the `:` is mid-identifier). The trailing `\s` (typed
    // by the user pressing Space) and `[\n\t]` (Enter / Tab)
    // are the trigger characters Typora supports.
    const pattern = new RegExp(
      `(?:^|[^\\w]):(${alternation}):[\\s\\n\\t]$`,
    )
    return [
      new InputRule({
        find: pattern,
        handler: ({ range, match, chain }) => {
          const name = match[1]
          const emoji = table[name]
          if (!emoji) return
          // Replace the whole `:name:` with the emoji glyph.
          // We trim the trailing whitespace the user just
          // typed (Space / Enter) so the caret lands cleanly
          // after the emoji.
          chain()
            .insertContentAt(
              { from: range.from, to: range.to - 1 },
              emoji,
            )
            // Place the cursor right after the inserted emoji.
            .setTextSelection(range.from + emoji.length)
            .run()
        },
      }),
    ]
  },
})