/**
 * Theme-related helpers and lookup tables for the Settings dialog.
 *
 * Extracted from `Settings.svelte` so the constant data (label
 * ↔ CSS-class maps and the i18n keys for the dropdown options)
 * lives next to the translation tables rather than at the top
 * of a 950-line component file. Keeping these maps in plain
 * TypeScript makes them easy to audit (and grep) when themes
 * are added or renamed.
 *
 * The label-resolution function takes a `t()` callback rather
 * than importing the i18n store directly — Settings owns the
 * reactive instance and we don't want a hidden coupling.
 */

/** Label ↔ CSS-class map. Order matches the dropdown in the
 *  Settings → Appearance panel. */
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

/** CSS-class ↔ i18n key map. The empty string is the default
 *  ("Cadmium Light") — a custom theme should never collide
 *  with the class names above because the host prepends the
 *  user theme directory name to its ids. */
const CLASS_TO_I18N_KEY: Record<string, string> = {
  '': 'settings.theme.cadmium',
  'theme-dark': 'settings.theme.dark',
  'theme-one-dark': 'settings.theme.one_dark',
  'theme-graphite': 'settings.theme.graphite',
  'theme-ulysses': 'settings.theme.ulysses',
  'theme-material-dark': 'settings.theme.material_dark',
  'theme-blue-topaz': 'settings.theme.blue_topaz',
}

/** Convert a CSS-class theme id (the canonical on-disk form)
 *  into a human-readable label. The label resolves through
 *  `i18n.t()` so it follows the active locale. If the id is
 *  unknown we fall back to the raw id — useful for custom
 *  themes whose names the i18n table can't know about. */
export function getThemeLabel(
  cssClass: string,
  t: (key: string) => string,
): string {
  const key = CLASS_TO_I18N_KEY[cssClass]
  return key ? t(key) : cssClass
}

/** Theme options for the `<select>` in Settings → Appearance.
 *  Values are CSS classes; labels resolve via `i18n.t()`
 *  at render time. */
export const THEME_OPTIONS: Array<{ value: string; labelKey: string }> = [
  { value: '', labelKey: 'settings.theme.cadmium' },
  { value: 'theme-dark', labelKey: 'settings.theme.dark' },
  { value: 'theme-one-dark', labelKey: 'settings.theme.one_dark' },
  { value: 'theme-graphite', labelKey: 'settings.theme.graphite' },
  { value: 'theme-ulysses', labelKey: 'settings.theme.ulysses' },
  { value: 'theme-material-dark', labelKey: 'settings.theme.material_dark' },
  { value: 'theme-blue-topaz', labelKey: 'settings.theme.blue_topaz' },
]

/** Pick the canonical CSS class for a human-readable theme
 *  label. Used by `changeTheme` to translate the `<select>`
 *  value back to the form we persist on disk. */
export function labelToThemeClass(label: string): string {
  return THEME_LABEL_TO_CLASS[label] ?? label
}