/**
 * Types and invariants for the branching undo tree (P0-8).
 *
 * The tree lives entirely in plugin state and runs **alongside**
 * ProseMirror's linear `prosemirror-history` (StarterKit default).
 * The PM history keeps doing what it does best — linear undo/redo
 * bound to Cmd+Z / Cmd+Shift+Z — and the tree records a
 * navigable view of every meaningful edit with branch topology.
 *
 * Invariants:
 *   1. Exactly one root node (parentId === null).
 *   2. `currentId` always points to a leaf (no outgoing `isCurrent`
 *      edge). It is the node the user can keep editing on.
 *   3. There is exactly one `isCurrent: true` node reachable from
 *      the root via the unique chain of `isCurrent` children.
 *      Switching branches flips this invariant from one path to
 *      another (see `switchToBranch` in state.ts).
 *   4. `nextId` is monotonic and never reused, even after GC.
 *   5. `docJson` is the post-edit `state.doc.toJSON()`. It is
 *      captured at the moment the node is created (or last
 *      throttled into place).
 *   6. `collapsed` is UI-only state (persisted in the plugin
 *      state because collapsed subtrees need to remain collapsed
 *      across renders). It is read by `UndoTreePanel.svelte` and
 *      written by the `collapseSubtree` command.
 *
 * Storage rationale: we keep `docJson` (PM Node.toJSON) rather
 * than a live `Node` because (a) PMNodes are tied to a specific
 * schema instance and cannot outlive an editor swap; (b) JSON
 * is serialisable, so a future "snapshot to disk on tab close"
 * is straightforward; (c) the cost of `schema.nodeFromJSON` on
 * a 100 KB doc is sub-millisecond, well within budget for the
 * "switch to branch" path.
 */

import { PluginKey } from '@tiptap/pm/state'
import type { DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'

/** A single snapshot of the document at a moment in time. */
export interface BranchNode {
  /** Stable identifier — `'b0'`, `'b1'`, ... monotonically increasing. */
  id: string
  /** null ⇔ root. Otherwise the id of the parent node. */
  parentId: string | null
  /** Ordered child ids. Ordering reflects creation order; the
   *  first child is the one on the current path (when applicable). */
  childIds: string[]
  /** Frozen PM `doc.toJSON()` at the moment this branch was captured. */
  docJson: unknown
  /** Optional user-supplied label; falls back to the first text line. */
  label?: string
  /** Capture timestamp (epoch ms). */
  timestamp: number
  /** True iff this node lies on the current branch path. */
  isCurrent: boolean
  /** UI-only: subtree is collapsed in the panel. */
  collapsed: boolean
}

/** Full plugin state. */
export interface UndoTreeState {
  nodes: Record<string, BranchNode>
  rootId: string
  /** Leaf of the currently active path. */
  currentId: string
  /** Hard cap on node count. LRU trim beyond this. */
  maxNodes: number
  /** Next id to allocate (monotonic, never reused). */
  nextId: number
  /** Decoration cache, rebuilt when topology changes. Empty by default;
   *  panels drive their own DOM, decorations are reserved for the
   *  future "edit-point gutter markers" feature. */
  decorations: DecorationSet
}

/**
 * Transaction meta payload. Plugin's `apply` reads
 * `tr.getMeta(undoTreePluginKey)` and dispatches by `type`.
 */
export type UndoTreeMeta =
  | { type: 'append'; doc: PMNode; timestamp?: number }
  | { type: 'switch'; fromId: string; toId: string; timestamp?: number }
  | { type: 'prune'; id: string }
  | { type: 'label'; id: string; label: string }
  | { type: 'collapse'; id: string; collapsed: boolean }

/** Default capacity. Memory ≈ 50 × 100 KB ≈ 5 MB upper bound. */
export const MAX_NODES_DEFAULT = 50

/**
 * Throttle window. Edits within `THROTTLE_MS` of the last append
 * update the latest branch in place rather than allocating a new
 * node. Without this, a typing burst would balloon the tree.
 */
export const THROTTLE_MS = 1000

/** Singleton plugin key. */
export const undoTreePluginKey = new PluginKey<UndoTreeState>('undoTree')