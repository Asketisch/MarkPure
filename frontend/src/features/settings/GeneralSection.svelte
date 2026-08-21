<!--
  设置 → 通用 区域。

  渲染编辑器偏好（字体、Tab 宽度、软 Tab、行号、自动换行、
  自动保存、保存时整理、字数目标）以及拼写检查、备份与恢复按钮。

  纯展示组件——所有状态都存放在父组件 `Settings.svelte` 中，
  由其持有 `AppConfig` 与各 IPC 写入函数（`saveConfig`、
  `changeLanguage`、`handleExportConfig`、`handleImportConfig`）。
  本组件只接收带类型的回调与已加载的配置，再通过它们上抛变更事件。
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

  <!-- “保存时整理”开关。开启后 `save_file` 会在写盘前调用
       `lint_markdown`（去除行尾空白、确保以换行结尾、
       将连续 3 个以上的空行折叠为 2 个）。 -->
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

  <!-- 字数目标。设为大于 0 时，状态栏会显示
       `<当前字数> / <目标> (<百分比>%)`，
       方便用户跟踪写作进度。 -->
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

  <!-- 拼写检查（开关 + 语言）。在非 macOS 平台上，
       提示信息会告知用户仅检查英文。 -->
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

  <!-- 偏好设置导出 / 导入。用户可以把完整的
       `AppConfig` + 按键绑定 + 自定义主题备份到
       单个 JSON 文件中，稍后（通常是新装或换机时）再恢复。 -->
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