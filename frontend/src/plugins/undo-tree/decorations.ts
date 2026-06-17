/**
 * Decoration helpers for the undo-tree plugin.
 *
 * The plugin's `props.decorations` returns a `DecorationSet`. The
 * right-side panel (`UndoTreePanel.svelte`) drives the primary UI;
 * we keep decorations deliberately minimal so the panel stays the
 * single source of truth.
 *
 * Future expansion: per-node "where did this branch diverge" gutter
 * markers. Today this returns an empty set and is reserved for
 * host integration (e.g., the StatusBar could read the plugin key
 * and highlight the active branch).
 */

import { DecorationSet } from '@tiptap/pm/view'
import { undoTreePluginKey, type UndoTreeState } from './types'

export function buildUndoTreeDecorations(state: { doc: unknown }): DecorationSet {
  // Touch the plugin key so callers reading the state don't have
  // to — keeps the API hot-path friendly.
  const _ = undoTreePluginKey.getState(state as never) as UndoTreeState | undefined
  if (!_) return DecorationSet.empty
  return _.decorations
}