/**
 * Quick insert command definitions
 * Quick insert config
 */

export interface QuickInsertItem {
  title: string
  subtitle: string
  label: string
  shortcut?: string
  category: string
  icon: string
  action: (commands: any) => void
}

const CMD = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'
const ALT = navigator.platform.includes('Mac') ? '⌥' : 'Alt'
const SHIFT = navigator.platform.includes('Mac') ? '⇧' : 'Shift'

export const quickInsertItems: QuickInsertItem[] = [
  // Basic blocks
  {
    title: 'Paragraph',
    subtitle: 'Plain text paragraph',
    label: 'paragraph',
    shortcut: `${CMD}+0`,
    category: 'Basic',
    icon: '¶',
    action: (c) => c.setParagraph(),
  },
  {
    title: 'Horizontal Rule',
    subtitle: '---',
    label: 'hr',
    shortcut: `${ALT}+${CMD}+-`,
    category: 'Basic',
    icon: '—',
    action: (c) => c.setHorizontalRule(),
  },

  // Headers
  {
    title: 'Heading 1',
    subtitle: '# Heading',
    label: 'heading1',
    shortcut: `${CMD}+1`,
    category: 'Headings',
    icon: 'H1',
    action: (c) => c.toggleHeading({ level: 1 }),
  },
  {
    title: 'Heading 2',
    subtitle: '## Heading',
    label: 'heading2',
    shortcut: `${CMD}+2`,
    category: 'Headings',
    icon: 'H2',
    action: (c) => c.toggleHeading({ level: 2 }),
  },
  {
    title: 'Heading 3',
    subtitle: '### Heading',
    label: 'heading3',
    shortcut: `${CMD}+3`,
    category: 'Headings',
    icon: 'H3',
    action: (c) => c.toggleHeading({ level: 3 }),
  },
  {
    title: 'Heading 4',
    subtitle: '#### Heading',
    label: 'heading4',
    shortcut: `${CMD}+4`,
    category: 'Headings',
    icon: 'H4',
    action: (c) => c.toggleHeading({ level: 4 }),
  },
  {
    title: 'Heading 5',
    subtitle: '##### Heading',
    label: 'heading5',
    shortcut: `${CMD}+5`,
    category: 'Headings',
    icon: 'H5',
    action: (c) => c.toggleHeading({ level: 5 }),
  },
  {
    title: 'Heading 6',
    subtitle: '###### Heading',
    label: 'heading6',
    shortcut: `${CMD}+6`,
    category: 'Headings',
    icon: 'H6',
    action: (c) => c.toggleHeading({ level: 6 }),
  },

  // Advanced blocks
  {
    title: 'Code Block',
    subtitle: '```language ... ```',
    label: 'codeblock',
    shortcut: `${ALT}+${CMD}+C`,
    category: 'Advanced',
    icon: '{ }',
    action: (c) => c.toggleNode('codeBlock', 'paragraph'),
  },
  {
    title: 'Blockquote',
    subtitle: '> Block quote',
    label: 'blockquote',
    shortcut: `${ALT}+${CMD}+Q`,
    category: 'Advanced',
    icon: '❝',
    action: (c) => c.toggleBlockquote(),
  },
  {
    title: 'Table',
    subtitle: '| Col | Col |',
    label: 'table',
    shortcut: `${SHIFT}+${CMD}+T`,
    category: 'Advanced',
    icon: '⊞',
    action: (c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }),
  },
  {
    title: 'Math Block',
    subtitle: '$$ ... $$',
    label: 'mathblock',
    shortcut: `${ALT}+${CMD}+M`,
    category: 'Advanced',
    icon: '∑',
    action: (c) => c.insertContent({ type: 'mathDisplay' }),
  },
  {
    title: 'Mermaid Diagram',
    subtitle: 'graph TD\n  A --> B',
    label: 'mermaid',
    category: 'Advanced',
    icon: '◇',
    action: (c) => c.insertMermaid(),
  },
  {
    // P2-8: PlantUML block. We currently insert a fenced
    // ```plantuml code block (mirroring mermaid). A future
    // addition is a PlantUML nodeview that previews the
    // rendered diagram via a PlantUML server or jar; the
    // fenced block round-trips through the markdown export
    // pipeline unchanged.
    title: 'PlantUML Diagram',
    subtitle: '@startuml\n  A --> B\n@enduml',
    label: 'plantuml',
    category: 'Advanced',
    icon: '◊',
    action: (c) => c.insertContent({
      type: 'codeBlock',
      attrs: { language: 'plantuml' },
      content: [{ type: 'text', text: '@startuml\n  Alice -> Bob: Hello\n@enduml' }],
    }),
  },
  {
    title: 'Table of Contents',
    subtitle: '<!-- TOC -->',
    label: 'toc',
    category: 'Advanced',
    icon: '☰',
    action: (c) => c.insertToc(),
  },
  {
    title: 'Footnote Reference',
    subtitle: '[^id]',
    label: 'footnote_ref',
    category: 'Advanced',
    icon: '¹',
    action: (c) => c.insertFootnoteRef?.() ?? c.insertContent('[^1]'),
  },

  // Lists
  {
    title: 'Bullet List',
    subtitle: '- List item',
    label: 'bulletlist',
    shortcut: `${ALT}+${CMD}+U`,
    category: 'Lists',
    icon: '•',
    action: (c) => c.toggleBulletList(),
  },
  {
    title: 'Ordered List',
    subtitle: '1. List item',
    label: 'orderedlist',
    shortcut: `${ALT}+${CMD}+O`,
    category: 'Lists',
    icon: '1.',
    action: (c) => c.toggleOrderedList(),
  },
  {
    title: 'Task List',
    subtitle: '- [ ] Task item',
    label: 'tasklist',
    shortcut: `${ALT}+${CMD}+X`,
    category: 'Lists',
    icon: '☐',
    action: (c) => c.toggleTaskList(),
  },

  // Inline
  {
    title: 'Image',
    subtitle: '![alt](url)',
    label: 'image',
    category: 'Insert',
    icon: '🖼',
    action: (c) => {
      const url = window.prompt('Image URL:')
      if (url) c.setImage({ src: url })
    },
  },
  {
    title: 'Link',
    subtitle: '[text](url)',
    label: 'link',
    category: 'Insert',
    icon: '🔗',
    action: (c) => {
      const url = window.prompt('Link URL:')
      if (url) c.setLink({ href: url })
    },
  },
]

/** Fuzzy-search items by query */
export function searchQuickInsert(query: string): QuickInsertItem[] {
  if (!query) return quickInsertItems
  const q = query.toLowerCase()
  return quickInsertItems.filter(
    (item) =>
      item.title.toLowerCase().includes(q) ||
      item.label.toLowerCase().includes(q) ||
      item.subtitle.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q)
  )
}
