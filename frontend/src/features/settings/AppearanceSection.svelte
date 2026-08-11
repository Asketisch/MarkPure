<!--
  Settings → Appearance section.

  Lists the built-in theme selector, the user's imported
  custom themes (with delete buttons), and the import /
  edit-theme entry points.

  Pure presentational component — receives the theme list
  and the active theme CSS class, plus callbacks for theme
  change, delete, import, and opening the ThemeEditor.
-->

<script lang="ts">
  import { useI18n } from '$lib/stores/i18n.svelte'
  import { THEME_OPTIONS } from './themes'
  import type { Theme } from '$lib/editor/commands'

  const i18n = useI18n()

  let {
    themes,
    currentTheme,
    onChangeTheme,
    onDeleteTheme,
    onImportTheme,
    onOpenThemeEditor,
  }: {
    themes: Theme[]
    currentTheme: string
    onChangeTheme: (themeName: string) => void
    onDeleteTheme: (id: string) => void
    onImportTheme: () => void
    onOpenThemeEditor: () => void
  } = $props()
</script>

<section>
  <h2>{i18n.t('settings.appearance')}</h2>

  <div class="setting-row">
    <label for="settings-builtin-theme">{i18n.t('settings.builtin_theme')}</label>
    <select
      id="settings-builtin-theme"
      value={currentTheme}
      onchange={(e) => onChangeTheme((e.target as HTMLSelectElement).value)}
    >
      {#each THEME_OPTIONS as opt (opt.value)}
        <option value={opt.value}>{i18n.t(opt.labelKey)}</option>
      {/each}
    </select>
  </div>

  {#if themes.length > 0}
    <h3>{i18n.t('settings.custom_themes')}</h3>
    {#each themes as theme (theme.id)}
      <div class="theme-card">
        <div class="theme-info">
          <span class="theme-name">{theme.name}</span>
          <span class="theme-author">
            {i18n.t('settings.theme.author_template').replace('{author}', theme.author)}
          </span>
          <span class="theme-badge" class:dark={theme.is_dark}>
            {theme.is_dark ? i18n.t('settings.theme.badge.dark') : i18n.t('settings.theme.badge.light')}
          </span>
        </div>
        <div class="theme-actions">
          <button onclick={() => onDeleteTheme(theme.id)}>{i18n.t('action.delete')}</button>
        </div>
      </div>
    {/each}
  {/if}

  <div class="setting-actions">
    <button onclick={onImportTheme}>{i18n.t('settings.import_theme')}</button>
    <button onclick={onOpenThemeEditor}>{i18n.t('settings.edit_theme')}</button>
  </div>
</section>