/**
 * 设置对话框的主题相关助手与查找表。
 *
 * 从 `Settings.svelte` 中拆出，让常量数据（标签 ↔ CSS 类映射、
 * 下拉选项的 i18n 键）与翻译表放在一起，而不是堆在一个
 * 950 行的组件文件顶部。用纯 TypeScript 保存这些映射，在新增或
 * 重命名主题时便于审计（也便于 grep）。
 *
 * 标签解析函数接收 `t()` 回调而不是直接导入 i18n store——设置页
 * 持有响应式实例，我们不想引入隐藏耦合。
 */

/** 标签 ↔ CSS 类映射。顺序与设置 → 外观面板中的下拉框一致。 */
export const THEME_LABEL_TO_CLASS: Record<string, string> = {
  'Cadmium Light': '',
  'Light': '',
  'Dark': 'theme-dark',
  'One Dark': 'theme-one-dark',
  'Graphite': 'theme-graphite',
  'Ulysses': 'theme-ulysses',
  'Material Dark': 'theme-material-dark',
  'Blue Topaz': 'theme-blue-topaz',
}

/** CSS 类 ↔ i18n 键映射。空字符串是默认主题（“Cadmium Light”）——
 *  自定义主题永远不会与上面的类名冲突，因为宿主会把自己的主题
 *  目录名前缀加在 id 前面。 */
const CLASS_TO_I18N_KEY: Record<string, string> = {
  '': 'settings.theme.cadmium',
  'theme-dark': 'settings.theme.dark',
  'theme-one-dark': 'settings.theme.one_dark',
  'theme-graphite': 'settings.theme.graphite',
  'theme-ulysses': 'settings.theme.ulysses',
  'theme-material-dark': 'settings.theme.material_dark',
  'theme-blue-topaz': 'settings.theme.blue_topaz',
}

/** 把 CSS 类的主题 id（磁盘上的规范形态）转成人类可读的标签。
 *  标签通过 `i18n.t()` 解析，因此跟随当前语言。若 id 未知则
 *  回退到原始 id——对 i18n 表里无法预知名字的自定义主题很有用。 */
export function getThemeLabel(
  cssClass: string,
  t: (key: string) => string,
): string {
  const key = CLASS_TO_I18N_KEY[cssClass]
  return key ? t(key) : cssClass
}

/** 设置 → 外观中 `<select>` 的主题选项。值是 CSS 类；标签在
 *  渲染时通过 `i18n.t()` 解析。 */
export const THEME_OPTIONS: Array<{ value: string; labelKey: string }> = [
  { value: '', labelKey: 'settings.theme.cadmium' },
  { value: 'theme-dark', labelKey: 'settings.theme.dark' },
  { value: 'theme-one-dark', labelKey: 'settings.theme.one_dark' },
  { value: 'theme-graphite', labelKey: 'settings.theme.graphite' },
  { value: 'theme-ulysses', labelKey: 'settings.theme.ulysses' },
  { value: 'theme-material-dark', labelKey: 'settings.theme.material_dark' },
  { value: 'theme-blue-topaz', labelKey: 'settings.theme.blue_topaz' },
]

/** 为人类可读的主题标签挑选规范 CSS 类。`changeTheme` 用它把
 *  `<select>` 的值转回持久化到磁盘的形态。 */
export function labelToThemeClass(label: string): string {
  return THEME_LABEL_TO_CLASS[label] ?? label
}