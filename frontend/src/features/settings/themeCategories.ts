/**
 * Theme editor colour palette catalogue.
 *
 * The `ColorCategories[]` array drives the `<ColorPicker>` grid
 * inside `ThemeEditor.svelte`. It's pure data — no state, no
 * callbacks — so it lives in its own file and is imported by
 * the editor component.
 *
 * Adding a new colour slot:
 *   1. Add the field to `ThemeColors` in
 *      `$lib/editor/commands/types.ts`.
 *   2. Add the matching entry below. `isSize: true` marks
 *      entries that are pixel/font sizes (the editor renders
 *      them as a free-text `<input>` instead of a colour picker
 *      — same UX as the heading size fields).
 */

import type { ThemeColors } from '$lib/editor/commands'

export interface ColorCategoryItem {
  key: keyof ThemeColors
  label: string
  labelKey: string
  /** When true, render a `<input type=text>` instead of a colour
   *  picker — used for font-size / heading-size fields. */
  isSize?: boolean
}

export interface ColorCategory {
  nameKey: string
  colors: ColorCategoryItem[]
}

export const COLOR_CATEGORIES: ColorCategory[] = [
  {
    nameKey: 'settings.theme_editor.category.ui',
    colors: [
      { key: 'bg', label: 'Background', labelKey: 'settings.theme_editor.color.bg' },
      { key: 'bg_secondary', label: 'Secondary BG', labelKey: 'settings.theme_editor.color.bg_secondary' },
      { key: 'bg_tab_active', label: 'Tab Active', labelKey: 'settings.theme_editor.color.bg_tab_active' },
      { key: 'bg_tab_inactive', label: 'Tab Inactive', labelKey: 'settings.theme_editor.color.bg_tab_inactive' },
      { key: 'text', label: 'Text', labelKey: 'settings.theme_editor.color.text' },
      { key: 'text_secondary', label: 'Text Secondary', labelKey: 'settings.theme_editor.color.text_secondary' },
      { key: 'accent', label: 'Accent', labelKey: 'settings.theme_editor.color.accent' },
      { key: 'accent_hover', label: 'Accent Hover', labelKey: 'settings.theme_editor.color.accent_hover' },
      { key: 'border', label: 'Border', labelKey: 'settings.theme_editor.color.border' },
      { key: 'status_bg', label: 'Status Bar BG', labelKey: 'settings.theme_editor.color.status_bg' },
      { key: 'scrollbar_thumb', label: 'Scrollbar', labelKey: 'settings.theme_editor.color.scrollbar_thumb' },
    ],
  },
  {
    nameKey: 'settings.theme_editor.category.heading',
    colors: [
      { key: 'heading1_color', label: 'H1 Color', labelKey: 'settings.theme_editor.color.heading1_color' },
      { key: 'heading2_color', label: 'H2 Color', labelKey: 'settings.theme_editor.color.heading2_color' },
      { key: 'heading3_color', label: 'H3 Color', labelKey: 'settings.theme_editor.color.heading3_color' },
      { key: 'heading4_color', label: 'H4 Color', labelKey: 'settings.theme_editor.color.heading4_color' },
      { key: 'heading5_color', label: 'H5 Color', labelKey: 'settings.theme_editor.color.heading5_color' },
      { key: 'heading6_color', label: 'H6 Color', labelKey: 'settings.theme_editor.color.heading6_color' },
      { key: 'heading1_size', label: 'H1 Size', labelKey: 'settings.theme_editor.color.heading1_size', isSize: true },
      { key: 'heading2_size', label: 'H2 Size', labelKey: 'settings.theme_editor.color.heading2_size', isSize: true },
      { key: 'heading3_size', label: 'H3 Size', labelKey: 'settings.theme_editor.color.heading3_size', isSize: true },
      { key: 'heading4_size', label: 'H4 Size', labelKey: 'settings.theme_editor.color.heading4_size', isSize: true },
      { key: 'heading5_size', label: 'H5 Size', labelKey: 'settings.theme_editor.color.heading5_size', isSize: true },
      { key: 'heading6_size', label: 'H6 Size', labelKey: 'settings.theme_editor.color.heading6_size', isSize: true },
    ],
  },
  {
    nameKey: 'settings.theme_editor.category.code',
    colors: [
      { key: 'code_bg', label: 'Inline Code BG', labelKey: 'settings.theme_editor.color.code_bg' },
      { key: 'code_block_bg', label: 'Code Block BG', labelKey: 'settings.theme_editor.color.code_block_bg' },
    ],
  },
  {
    nameKey: 'settings.theme_editor.category.link',
    colors: [
      { key: 'link_color', label: 'Link', labelKey: 'settings.theme_editor.color.link_color' },
      { key: 'link_hover_color', label: 'Link Hover', labelKey: 'settings.theme_editor.color.link_hover_color' },
    ],
  },
  {
    nameKey: 'settings.theme_editor.category.block',
    colors: [
      { key: 'blockquote_border', label: 'Blockquote Border', labelKey: 'settings.theme_editor.color.blockquote_border' },
      { key: 'blockquote_bg', label: 'Blockquote BG', labelKey: 'settings.theme_editor.color.blockquote_bg' },
      { key: 'hr_color', label: 'HR Color', labelKey: 'settings.theme_editor.color.hr_color' },
    ],
  },
  {
    nameKey: 'settings.theme_editor.category.table',
    colors: [
      { key: 'table_border', label: 'Table Border', labelKey: 'settings.theme_editor.color.table_border' },
      { key: 'table_header_bg', label: 'Table Header BG', labelKey: 'settings.theme_editor.color.table_header_bg' },
    ],
  },
  {
    nameKey: 'settings.theme_editor.category.menu',
    colors: [
      { key: 'menu_hover_bg', label: 'Menu Hover BG', labelKey: 'settings.theme_editor.color.menu_hover_bg' },
      { key: 'menu_hover_text', label: 'Menu Hover Text', labelKey: 'settings.theme_editor.color.menu_hover_text' },
      { key: 'highlight_bg', label: 'Highlight BG', labelKey: 'settings.theme_editor.color.highlight_bg' },
      { key: 'cell_selected_bg', label: 'Selected Cell BG', labelKey: 'settings.theme_editor.color.cell_selected_bg' },
    ],
  },
]