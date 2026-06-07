/**
 * Footnote reference mark.
 *
 * Recognises inline `[^id]` text in the document and renders it as
 * a styled `<sup class="footnote-ref">` chip. Markdown round-trips
 * losslessly: the editor preserves the literal `[^id]` text on
 * save, and `markdown::to_html_with_diagrams_and_footnotes` (in
 * the Rust backend) re-numbers and links the references on export.
 *
 * The mark carries a `label` attribute (the `id` portion: `1`,
 * `note-1`, `i0` for inline, etc.). It does NOT need to track the
 * document-order number — that's computed at render time.
 *
 * The companion block-level definition (`[^id]: content`) is left
 * as plain text on purpose: pulldown-cmark's `ENABLE_FOOTNOTES`
 * recognises it natively, so the export pipeline picks it up
 * without us needing a custom ProseMirror node.
 */
import { Mark, mergeAttributes, InputRule } from '@tiptap/core'

export interface FootnoteRefOptions {
  HTMLAttributes: Record<string, unknown>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    footnoteRef: {
      setFootnoteRef: (label: string) => ReturnType
      unsetFootnoteRef: () => ReturnType
      insertFootnoteRef: (label?: string) => ReturnType
    }
  }
}

/// Pattern that matches a complete `[^id]` reference at the
/// cursor. Used by the input rule that fires on the closing `]`.
const FOOTNOTE_REF_INPUT_RE = /\[\^([^\[\]\s]+)\]$/

/// Pattern that scans an entire text for `[^id]` occurrences.
/// Used by the paste rule that re-marks pasted text.
const FOOTNOTE_REF_GLOBAL_RE = /\[\^([^\[\]\s]+)\]/g

let nextLabelCounter = 0
function nextAutoLabel(): string {
  // Simple monotonic counter; the export pipeline renumbers in
  // document order, so the on-disk label is purely cosmetic
  // until the markdown is regenerated.
  nextLabelCounter += 1
  return String(nextLabelCounter)
}

export const FootnoteRefExtension = Mark.create<FootnoteRefOptions>({
  name: 'footnoteRef',

  addOptions() {
    return { HTMLAttributes: {} }
  },

  addAttributes() {
    return {
      label: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-label'),
        renderHTML: (attrs) => {
          if (!attrs.label) return {}
          return { 'data-label': attrs.label }
        },
      },
    }
  },

  parseHTML() {
    return [
      { tag: 'sup[data-footnoteref]' },
      // Also accept the `[^id]` raw text the backend emits when
      // round-tripping — this keeps editor→html→editor lossless
      // when the user pastes an exported HTML block back in.
      { tag: 'sup.footnote-ref' },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'sup',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-footnoteref': '',
        class: 'footnote-ref',
      }),
      0,
    ]
  },

  addCommands() {
    return {
      setFootnoteRef:
        (label) =>
        ({ commands }) =>
          commands.setMark(this.name, { label }),
      unsetFootnoteRef:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
      insertFootnoteRef:
        (label) =>
        ({ chain }) => {
          const finalLabel = label ?? nextAutoLabel()
          return chain()
            .insertContent({
              type: 'text',
              text: `[^${finalLabel}]`,
              marks: [{ type: this.name, attrs: { label: finalLabel } }],
            })
            .run()
        },
    }
  },

  /// Convert `[^N]` to a marked footnote reference as the user
  /// types the closing `]`. Mirrors the wikilink input rule.
  addInputRules() {
    return [
      new InputRule({
        find: FOOTNOTE_REF_INPUT_RE,
        handler: ({ range, match, chain }) => {
          const [, label] = match
          chain()
            .insertContentAt({ from: range.from, to: range.to }, [
              {
                type: 'text',
                text: `[^${label}]`,
                marks: [{ type: this.name, attrs: { label } }],
              },
            ])
            // Cursor lands right after the inserted reference.
            .setTextSelection(range.from + label.length + 3)
            .run()
        },
      }),
    ]
  },

  /// Re-mark pasted `[^id]` text so it isn't just plain text.
  addPasteRules() {
    return [
      {
        find: FOOTNOTE_REF_GLOBAL_RE,
        handler: ({ range, match, chain }) => {
          const [, label] = match
          chain()
            .insertContentAt({ from: range.from, to: range.to }, [
              {
                type: 'text',
                text: `[^${label}]`,
                marks: [{ type: this.name, attrs: { label } }],
              },
            ])
            .run()
        },
      },
    ]
  },
})
