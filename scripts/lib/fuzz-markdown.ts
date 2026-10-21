/**
 * 随机 markdown 文档生成器（供 fuzz 与分析脚本共用）。
 *
 * 刻意覆盖「合法却刁钻」的组合：表格单元格里含 `|`、围栏代码块里含
 * ``` ``` ```、列表项之间的空行（懒续行）、链接 URL 里含 `)` 或空格、
 * 图片 alt 里含 `[` / `]`、frontmatter 紧跟着正文……
 *
 * 现实里这些内容来自别的工具（Obsidian / Typora / 文档转换器）导出，
 * 用户的文档什么样都有。
 *
 * 生成器是**确定性**的：同一个 seed 必得同一份文档，失败可直接复现。
 */

// ---- 确定性随机数 -------------------------------------------------------

/** mulberry32——小、快、确定性好。 */
function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(rng: () => number, items: T[]): T {
  return items[Math.floor(rng() * items.length) % items.length]
}
function int(rng: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1))
}

// ---- 随机 markdown 生成器 ----------------------------------------------

/** 刻意刁钻的文本片段——它们是解析器最容易踩坑的地方。 */
const NASTY_TEXTS = [
  '普通文本',
  '带 | 竖线的文本',
  '带 [方括号] 的文本',
  '带 *星号* 和 _下划线_ 的文本',
  '带 `反引号` 的文本',
  '带 <html> & "引号" 的文本',
  '带 emoji 🎉 的文本',
  '带 **粗体** 与 *斜体* 的文本',
  '带 [链接](https://example.com) 的文本',
  '带 [[维基链接]] 的文本',
  '带 #标签 的文本',
  '带 $公式$ 的文本',
  '带 \` 转义反引号 的文本',
  '带 \\ 反斜杠 的文本',
  '   缩进开头的文本',
  '一行非常非常非常非常非常非常非常长的文本'.repeat(8),
  '',
]

function randText(rng: () => number): string {
  return pick(rng, NASTY_TEXTS)
}

function randHeading(rng: () => number): string {
  const level = int(rng, 1, 6)
  return `${'#'.repeat(level)} ${randText(rng)}`
}

function randParagraph(rng: () => number): string {
  const n = int(rng, 1, 3)
  const parts: string[] = []
  for (let i = 0; i < n; i++) parts.push(randText(rng))
  return parts.join(' ')
}

function randList(rng: () => number): string {
  const ordered = rng() < 0.4
  const items: string[] = []
  const depth = int(rng, 1, 3)
  for (let i = 0; i < depth; i++) {
    const indent = '  '.repeat(i)
    const marker = ordered ? `${i + 1}.` : '-'
    const task = rng() < 0.3
    const body = randText(rng) || `条目${i}`
    items.push(`${indent}${marker} ${task ? (rng() < 0.5 ? '[x] ' : '[ ] ') : ''}${body}`)
    // 列表项之间插入空行——触发「懒续行」缩进推断
    if (rng() < 0.35) items.push('')
    // 偶尔插入一个嵌套子列表
    if (rng() < 0.4) {
      items.push(`${indent}  - ${randText(rng) || '子项'}`)
      if (rng() < 0.3) items.push('')
    }
  }
  return items.join('\n')
}

function randQuote(rng: () => number): string {
  const depth = int(rng, 1, 2)
  const inner = rng() < 0.3 ? randList(rng) : randParagraph(rng)
  const prefix = '> '.repeat(depth)
  return inner
    .split('\n')
    .map((l) => (l ? prefix + l : prefix.trimEnd()))
    .join('\n')
}

function randCodeBlock(rng: () => number): string {
  const lang = pick(rng, ['', 'js', 'python', 'rust', 'ts', 'shell'])
  const bodies = [
    'const x = 1',
    '```\n嵌套围栏\n```',
    '包含 markdown 的行：\n# 不是标题\n- 不是列表',
    '',
    '带空行\n\n以及更多',
    '   缩进的代码',
    '带 ``` 的行',
  ]
  const body = pick(rng, bodies)
  return `\`\`\`${lang}\n${body}\n\`\`\``
}

function randTable(rng: () => number): string {
  const cols = int(rng, 1, 4)
  const rows = int(rng, 1, 3)
  const align = pick(rng, ['', ':---', '---:', ':---:', '---'])
  const head: string[] = []
  const sep: string[] = []
  for (let c = 0; c < cols; c++) {
    head.push(pick(rng, ['列', 'A', '长列名', 'x|y', '带 `反引号`']))
    sep.push(align)
  }
  const lines = [`| ${head.join(' | ')} |`, `| ${sep.join(' | ')} |`]
  for (let r = 0; r < rows; r++) {
    const cells: string[] = []
    for (let c = 0; c < cols; c++) cells.push(pick(rng, ['值', '', '长'.repeat(10), 'a|b', '**粗**']))
    lines.push(`| ${cells.join(' | ')} |`)
  }
  return lines.join('\n')
}

function randImage(rng: () => number): string {
  const url = pick(rng, [
    'https://example.com/a.png',
    'https://example.com/a b.png',
    'https://example.com/a(b).png',
    'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  ])
  const alt = pick(rng, ['图', '带]的 alt', '带 [ 的 alt', ''])
  const attrs = pick(rng, ['', '{width=120}', '{width=120 align=center}', '{align=right}'])
  return `![${alt}](${url})${attrs}`
}

function randHtml(rng: () => number): string {
  return pick(rng, [
    '<div class="x">\n  <p>HTML 块</p>\n</div>',
    '<!-- 注释 -->',
    '<br>',
    '<span>行内 HTML</span>',
  ])
}

function randMath(rng: () => number): string {
  if (rng() < 0.5) return `行内公式 $${pick(rng, ['x^2', 'a+b', '\\frac{1}{2}', 'x|y'])}$`
  return `$$\n${pick(rng, ['\\int_0^1 x^2 dx', 'a = b', 'x \\mid y'])}\n$$`
}

function randFrontmatter(rng: () => number): string {
  return ['---', 'title: 标题', 'tags: [a, b]', '---'].join('\n')
}

function randBlock(rng: () => number): string {
  const r = rng()
  if (r < 0.14) return randHeading(rng)
  if (r < 0.30) return randParagraph(rng)
  if (r < 0.44) return randList(rng)
  if (r < 0.52) return randQuote(rng)
  if (r < 0.62) return randCodeBlock(rng)
  if (r < 0.72) return randTable(rng)
  if (r < 0.78) return randImage(rng)
  if (r < 0.84) return randHtml(rng)
  if (r < 0.92) return randMath(rng)
  if (r < 0.96) return '---'
  return randFrontmatter(rng)
}

/** 生成一份随机文档（frontmatter 只在最开头出现一次）。 */
function randomDoc(rng: () => number): string {
  const blocks: string[] = []
  if (rng() < 0.2) blocks.push(randFrontmatter(rng))
  const n = int(rng, 1, 8)
  for (let i = 0; i < n; i++) blocks.push(randBlock(rng))
  return blocks.join('\n\n')
}


export { makeRng, randomDoc, randBlock, pick, int }
