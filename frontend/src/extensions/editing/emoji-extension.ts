import { Extension } from '@tiptap/core'
import { InputRule } from '@tiptap/core'

/**
 * emoji 短代码展开。输入 `:smile:` 后按空格 / 回车 / Tab，
 * 会自动把字面 `smile` 改写成 `😄`。规则只在词边界触发，
 * 因此 `https://example.com/:1234` 这样的 URL 不会被碰。
 *
 * 短代码表是一份小而保守的子集（约 80 条）——足以覆盖用户
 * 在各主流平台常见的写法，又不必把完整的 `node-emoji` 数据集
 * 打进渲染包（那会额外增加约 50KB）。想用更多短代码的用户
 * 可以通过 `additionalShortcodes` 扩展选项扩充这张表。
 */

export interface EmojiOptions {
  /** 合并进内置表的额外短代码。重复键以后写入者为准。 */
  additionalShortcodes?: Record<string, string>
}

/** 内置短代码表。这份清单保持保守——只收录用户真正会打、
 *  被广泛认可的短代码。完整的 emoji 列表有 1800+ 条；我们
 *  宁愿把 80 条做对，也不愿把那 1800 条里多数没人会用的全
 *  带上。
 *
 * 导出它，让 `validate-emoji-shortcode.ts` 脚本可以断言
 * 正则与实际表保持同步。 */
export const DEFAULT_SHORTCODES: Record<string, string> = {
  // 表情
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
  // 手势
  wave: '👋',
  raised_hand: '✋',
  ok_hand: '👌',
  thumbsup: '👍',
  thumbsdown: '👎',
  clap: '👏',
  pray: '🙏',
  // 爱心 / 符号
  heart: '❤️',
  broken_heart: '💔',
  sparkles: '✨',
  star: '⭐',
  fire: '🔥',
  zap: '⚡',
  boom: '💥',
  tada: '🎉',
  confetti_ball: '🎊',
  // 状态
  rocket: '🚀',
  warning: '⚠️',
  x: '❌',
  white_check_mark: '✅',
  no_entry: '⛔',
  // 常用
  coffee: '☕',
  tea: '🍵',
  pizza: '🍕',
  burger: '🍔',
  beer: '🍺',
  cocktail: '🍸',
  apple: '🍎',
  banana: '🍌',
  cherry: '🍒',
  // 箭头 / 指针
  point_right: '👉',
  point_left: '👈',
  point_up: '👆',
  point_down: '👇',
}

/** 由内置表加上宿主注入的 `additionalShortcodes` 合成查找表。 */
function buildTable(opts: EmojiOptions): Record<string, string> {
  const out = { ...DEFAULT_SHORTCODES }
  if (opts.additionalShortcodes) {
    Object.assign(out, opts.additionalShortcodes)
  }
  return out
}

/** 转义短代码，使其可用于正则字符类。实际上我们的短代码
 *  都不含正则元字符，但防御住 `additionalShortcodes` 的覆盖
 *  能保证规则安全。 */
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
      .sort((a, b) => b.length - a.length) // 长的在前，让 `:point_right:` 优先生效而非 `:point:`
    // 构建一个能匹配任意已知短代码的合并正则。下标 1 的捕获组
    // 是短代码名（不含冒号），处理器据此在 `table` 中查找。
    const alternation = shortcodes.map(escapeForRegex).join('|')
    // 规则左侧锚定在词边界上，这样 `https://example.com/:smile:`
    // 这类 URL 不会被匹配（那里的 `:` 处于标识符中间）。尾部
    // 的 `\s`（用户按空格产生）与 `[\n\t]`（回车 / Tab）
    // 是触发字符。
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
          // 匹配头部的 `(?:^|[^\w])` 会在非行首时吞掉一个前导
          // 字符（通常是 `:smile:` 前的空格），而它属于 match[0]，
          // 也就落在 range 内。直接从 range.from 替换会把这个
          // 无辜的字符一起删掉（`word :smile: ` → `word😄`）。
          // 计算前导长度，从短代码真正的起点开始替换。
          const prefixLen = match[0].length - (name.length + 3) // +2 冒号 +1 触发字符
          // 把整个 `:name:` 替换为 emoji 字形。我们裁掉用户
          // 刚打出的尾部空白（空格 / 回车），让光标干净地落在
          // emoji 之后。
          chain()
            .insertContentAt(
              { from: range.from + prefixLen, to: range.to - 1 },
              emoji,
            )
            // 把光标放在插入的 emoji 正后方。
            .setTextSelection(range.from + prefixLen + emoji.length)
            .run()
        },
      }),
    ]
  },
})