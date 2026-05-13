import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const undoTreePluginKey = new PluginKey('undoTree')

export interface UndoTreeState {
  branches: Array<{
    id: string
    timestamp: number
    label: string
    current: boolean
  }>
}

export interface UndoTreeOptions {
  maxBranches: number // Maximum number of branches to keep
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    undoTree: {
      toggleUndoTree: () => ReturnType
      undoToBranch: (branchId: string) => ReturnType
    }
  }
}

export const UndoTreeExtension = Extension.create<UndoTreeOptions>({
  name: 'undoTree',

  addOptions() {
    return {
      maxBranches: 10,
    }
  },

  addCommands() {
    return {
      toggleUndoTree:
        () =>
        ({ editor }) => {
          // This would toggle a sidebar/panel showing the undo tree
          // For now, just dispatch a custom event
          window.dispatchEvent(new CustomEvent('toggle-undo-tree'))
          return true
        },

      undoToBranch:
        (branchId: string) =>
        ({ editor }) => {
          // This would restore state to a specific branch point
          // Implementation would need to store document states at branch points
          window.dispatchEvent(new CustomEvent('undo-to-branch', { detail: { branchId } }))
          return true
        },
    }
  },

  addProseMirrorPlugins() {
    const { options } = this

    return [
      new Plugin({
        key: undoTreePluginKey,

        state: {
          init: () => {
            return {
              branches: [
                {
                  id: 'initial',
                  timestamp: Date.now(),
                  label: 'Initial state',
                  current: true,
                },
              ],
            }
          },

          apply: (tr, value, oldState, newState) => {
            // Track document changes
            if (tr.docChanged) {
              const meta = tr.getMeta('branchInfo')
              if (meta) {
                // New branch was created
                const newBranch = {
                  id: `branch-${Date.now()}`,
                  timestamp: Date.now(),
                  label: meta.label || 'Edit',
                  current: true,
                }

                // Mark old current branch as not current
                const updatedBranches = value.branches.map((b) => ({
                  ...b,
                  current: false,
                }))

                // Add new branch
                let newBranches = [...updatedBranches, newBranch]

                // Trim if too many branches
                if (newBranches.length > options.maxBranches) {
                  newBranches = newBranches.slice(-options.maxBranches)
                }

                return { branches: newBranches }
              }
            }

            return value
          },
        },

        props: {
          decorations: (state) => {
            // This could render decorations showing branch points
            return DecorationSet.empty
          },
        },
      }),
    ]
  },
})
