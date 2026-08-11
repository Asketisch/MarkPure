<!--
  Settings → General section.

  Renders the editor prefs (font, tab size, soft tabs, line
  numbers, word wrap, auto-save, lint-on-save, word-count goal)
  plus spell-check and the backup / restore buttons.

  Pure presentational component — all state lives in the parent
  `Settings.svelte` which owns the `AppConfig` and the IPC
  writers (`saveConfig`, `changeLanguage`, `handleExportConfig`,
  `handleImportConfig`). We receive typed callbacks + the
  loaded config and emit change events back through them.
-->

<script lang="ts">
  import { useI18n } from '$lib/stores/i18n.svelte'
  import type { AppConfig, ConfigImportReport, LocaleInfo } from '$lib/editor/commands'

  const i18n = useI18n()

  let {
    config,
    localeInfo,
    isMacPlatform,
    configImportReport,
    onSaveConfig,
    onChangeLanguage,
    onExportConfig,
    onImportConfig,
  }: {
    config: AppConfig
    localeInfo: LocaleInfo | null
    isMacPlatform: boolean
    configImportReport: ConfigImportReport | null
    onSaveConfig: (updates: Partial<AppConfig>) => void
    onChangeLanguage: (lang: string) => void
    onExportConfig: () => void
    onImportConfig: () => void
  } = $props()
</script>

<section>
  <h2>{i18n.t('settings.general')}</h2>

  <div class="setting-row">
    <label for="settings-language">{i18n.t('settings.language')}</label>
    <select
      id="settings-language"
      value={localeInfo?.current ?? 'en'}
      onchange={(e) => onChangeLanguage((e.target as HTMLSelectElement).value)}
    >
      {#if localeInfo}
        {#each localeInfo.available as [code, name]}
          <option value={code}>{name}</option>
        {/each}
      {/if}
    </select>
  </div>

  <div class="setting-row">
    <label for="settings-font-family">{i18n.t('settings.font_family')}</label>
    <input
      id="settings-font-family"
      type="text"
      value={config.editor.font_family}
      onchange={(e) => onSaveConfig({ editor: { ...config.editor, font_family: (e.target as HTMLInputElement).value } })}
    />
  </div>

  <div class="setting-row">
    <label for="settings-font-size">{i18n.t('settings.font_size')}</label>
    <input
      id="settings-font-size"
      type="number" min="10" max="32"
      value={config.editor.font_size}
      onchange={(e) => onSaveConfig({ editor: { ...config.editor, font_size: Number((e.target as HTMLInputElement).value) } })}
    />
  </div>

  <div class="setting-row">
    <label for="settings-tab-size">{i18n.t('settings.tab_size')}</label>
    <input
      id="settings-tab-size"
      type="number" min="2" max="8"
      value={config.editor.tab_size}
      onchange={(e) => onSaveConfig({ editor: { ...config.editor, tab_size: Number((e.target as HTMLInputElement).value) } })}
    />
  </div>

  <div class="setting-row">
    <label for="settings-soft-tabs">{i18n.t('settings.soft_tabs')}</label>
    <input
      id="settings-soft-tabs"
      type="checkbox"
      checked={config.editor.soft_tabs}
      onchange={(e) => onSaveConfig({ editor: { ...config.editor, soft_tabs: (e.target as HTMLInputElement).checked } })}
    />
  </div>

  <div class="setting-row">
    <label for="settings-line-numbers">{i18n.t('settings.line_numbers')}</label>
    <input
      id="settings-line-numbers"
      type="checkbox"
      checked={config.editor.line_numbers}
      onchange={(e) => onSaveConfig({ editor: { ...config.editor, line_numbers: (e.target as HTMLInputElement).checked } })}
    />
  </div>

  <div class="setting-row">
    <label for="settings-word-wrap">{i18n.t('settings.word_wrap')}</label>
    <input
      id="settings-word-wrap"
      type="checkbox"
      checked={config.editor.word_wrap}
      onchange={(e) => onSaveConfig({ editor: { ...config.editor, word_wrap: (e.target as HTMLInputElement).checked } })}
    />
  </div>

  <div class="setting-row">
    <label for="settings-auto-save">{i18n.t('settings.auto_save_interval')}</label>
    <input
      id="settings-auto-save"
      type="number" min="0" max="300"
      value={config.editor.auto_save_interval}
      onchange={(e) => onSaveConfig({ editor: { ...config.editor, auto_save_interval: Number((e.target as HTMLInputElement).value) } })}
    />
  </div>

  <!-- P0-X: Typora-style "lint on save" toggle.
       When enabled, `save_file` runs `lint_markdown`
       (trim trailing whitespace, ensure final newline,
       collapse 3+ blank lines into 2) before writing to disk. -->
  <div class="setting-row">
    <label
      for="settings-lint-on-save"
      title={i18n.t('settings.lint_on_save_tooltip')}
    >
      {i18n.t('settings.lint_on_save')}
    </label>
    <input
      id="settings-lint-on-save"
      type="checkbox"
      checked={config.editor.lint_on_save}
      onchange={(e) => onSaveConfig({ editor: { ...config.editor, lint_on_save: (e.target as HTMLInputElement).checked } })}
    />
  </div>

  <!-- P0-X: Typora-style word-count goal. When
       set (>0), the status bar shows
       `<current> / <goal> (<pct>%)` so the user can
       track progress against a writing target. -->
  <div class="setting-row">
    <label
      for="settings-word-count-goal"
      title={i18n.t('settings.word_count_goal_tooltip')}
    >
      {i18n.t('settings.word_count_goal')}
    </label>
    <input
      id="settings-word-count-goal"
      type="number" min="0" step="100"
      value={config.word_count_goal ?? 0}
      onchange={(e) => onSaveConfig({ word_count_goal: Number((e.target as HTMLInputElement).value) })}
    />
  </div>

  <!-- P1-11: Spell check (toggle + language). On
       non-macOS the tooltip warns the user that
       only English is checked. -->
  <h3>{i18n.t('settings.spellcheck')}</h3>
  <div class="setting-row">
    <label
      for="settings-spellcheck-enabled"
      title={isMacPlatform ? '' : i18n.t('settings.spellcheck.macos_only')}
    >
      {i18n.t('settings.spellcheck_enabled')}
    </label>
    <input
      id="settings-spellcheck-enabled"
      type="checkbox"
      checked={config.editor.spellcheck_enabled}
      onchange={(e) => onSaveConfig({ editor: { ...config.editor, spellcheck_enabled: (e.target as HTMLInputElement).checked } })}
    />
  </div>
  <div class="setting-row">
    <label for="settings-spellcheck-language">{i18n.t('settings.spellcheck_language')}</label>
    <select
      id="settings-spellcheck-language"
      value={config.editor.spellcheck_language ?? ''}
      onchange={(e) => {
        const v = (e.target as HTMLSelectElement).value
        onSaveConfig({ editor: { ...config.editor, spellcheck_language: v === '' ? null : v } })
      }}
    >
      <option value="">{i18n.t('settings.spellcheck.follow_ui')}</option>
      <option value="en">English</option>
      <option value="zh-CN">简体中文</option>
      <option value="ja">日本語</option>
    </select>
  </div>

  <!-- P0-X: Typora-style preferences export /
       import. The user can back up the entire
       `AppConfig` + keybindings + custom themes
       to a single JSON file and restore them
       later (typically on a fresh install or
       after switching machines). -->
  <h3>{i18n.t('settings.backup_restore')}</h3>
  <div class="setting-row">
    <label>{i18n.t('settings.export_preferences')}</label>
    <button class="setting-action" onclick={onExportConfig}>
      {i18n.t('settings.export_button')}
    </button>
  </div>
  <div class="setting-row">
    <label>{i18n.t('settings.import_preferences')}</label>
    <button class="setting-action" onclick={onImportConfig}>
      {i18n.t('settings.import_button')}
    </button>
  </div>
  {#if configImportReport}
    <div class="import-report" role="status">
      {i18n.t('settings.import_report')
        .replace('{themes}', String(configImportReport.themes_restored))
        .replace('{skipped}', String(configImportReport.themes_skipped))
        .replace('{keybindings}', String(configImportReport.keybindings_restored))}
    </div>
  {/if}
</section>