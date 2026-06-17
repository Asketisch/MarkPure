/**
 * Branching undo tree (P0-8) — Tiptap extension wrapper.
 *
 * Wraps the pure ProseMirror plugin from
 * `frontend/src/plugins/undo-tree/` in a Tiptap `Extension` and
 * exposes typed commands under the `undoTree.*` namespace.
 *
 * Replaces the previous snapshot-stub (which was a self-admitted
 * "Snapshot-based, NOT a real branching history yet" — see the
 * 2026-06 pre-P0-8 docs/COMPETITOR_TODO.md revision). The new
 * implementation tracks a true tree topology with `parentId` /
 * `childIds` and a `currentId` pointer that the user can move
 * between siblings and ancestors.
 *
 * Storage model:
 *   - Each node holds a frozen `state.doc.toJSON()` snapshot.
 *   - 50 nodes max (LRU trim of non-current leaves).
 *   - Throttle window: 1 second per leaf — typing bursts collapse
 *     into one node, fresh branches after a switch always
 *     allocate a new child.
 *
 * Relationship with PM history:
 *   - The plugin runs *alongside* StarterKit's `prosemirror-history`.
 *     `Cmd+Z` / `Cmd+Shift+Z` continue to use PM's linear history.
 *   - The tree is the branching view; "switch branch" is a
 *     `tr.replaceWith` that PM records as one event (so the user
 *     can PM-undo a branch switch).
 *
 * Decorations:
 *   - Minimal today. The right-side panel drives the primary UI;
 *     decorations are reserved for future "gutter markers at edit
 *     points" work.
 */

import { Extension } from '@tiptap/core'
import {
  createUndoTreePlugin,
  undoToBranch,
  labelBranch,
  pruneBranch,
  collapseSubtree,
  goToParent,
  goToChild,
} from '../../plugins/undo-tree'

export const UndoTreeExtension = Extension.create({
  name: 'undoTree',

  addCommands() {
    // The Tiptap `addCommands` registry is closed; we escape with
    // `as unknown as Record<...>` like the multi-cursor extension
    // does (see editor.ts:67-111). Callers reach the commands via
    // `editor.commands.undoToBranch(...)` etc.
    return {
      undoToBranch: (branchId: string) => undoToBranch(branchId),
      labelBranch: (branchId: string, label: string) => labelBranch(branchId, label),
      pruneBranch: (branchId: string) => pruneBranch(branchId),
      collapseSubtree: (branchId: string, collapsed: boolean) =>
        collapseSubtree(branchId, collapsed),
      goToParent: () => goToParent(),
      goToChild: (index: number) => goToChild(index),
    } as unknown as Record<string, (...args: unknown[]) => boolean>
  },

  addProseMirrorPlugins() {
    return [createUndoTreePlugin()]
  },
})