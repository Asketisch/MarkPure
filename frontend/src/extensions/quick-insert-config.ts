/**
 * 快速插入命令定义
 * 快速插入配置
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
  // 基础块
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

  // 标题
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

  // 高级块
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
    // PlantUML 块。当前插入一个围栏 ```plantuml 代码块
    // （与 mermaid 对应）。未来会新增一个 PlantUML 节点视图，
    // 通过 PlantUML 服务器或 jar 预览渲染出的图表；围栏块仍不经
    // 改动地从 markdown 导出管线往返。
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

  // 列表
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

  // 行内
  {
    // wry WebView 不实现 window.prompt（静默返回 null），所以经
    // CustomEvent 交给宿主：图片复用工具栏的文件选择器管线
    // （保存到工作区 + 插入图片节点，走 IPC）。
    title: 'Image',
    subtitle: '![alt](url)',
    label: 'image',
    category: 'Insert',
    icon: '🖼',
    action: () => {
      window.dispatchEvent(new CustomEvent('mt:quick-insert-image'))
    },
  },
  {
    // 链接 URL 由宿主的应用内对话框输入（见 windowEvents.ts 的
    // mt:quick-insert-link 监听器），确认后调用 setLink。
    title: 'Link',
    subtitle: '[text](url)',
    label: 'link',
    category: 'Insert',
    icon: '🔗',
    action: () => {
      window.dispatchEvent(new CustomEvent('mt:quick-insert-link'))
    },
  },
]

/** 按查询模糊搜索条目 */
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
