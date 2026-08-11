<!--
  Settings dialog — orchestrator only.

  The four sections (general / appearance / shortcuts / about)
  each live in their own .svelte file. This component owns:
    - The sidebar tab nav (justSaved flash, active button state)
    - The data-loading effect (load on open)
    - The IPC wiring (saveConfig, changeLanguage, etc.)
    - The hidden file input for "Import Preferences"
    - The ThemeEditor overlay mount point

  See `./GeneralSection.svelte`, `./AppearanceSection.svelte`,
  `./ShortcutsSection.svelte`, `./AboutSection.svelte` for
  the per-section markup. Pure helpers (theme lookup tables,
  accelerator formatter, config export/import I/O) live in
  `./themes.ts`, `./keybindings.ts`, `./configIO.ts`.

  Styles live in `./settings.css` so the orchestrator file
  stays focused on template + script logic.
-->
<script lang="ts">
  import './settings.css'
  import { onMount, untrack } from 'svelte'
  import {
    getConfig,
    setConfig,
    getThemes,
    importTheme,
    deleteTheme,
    getLocale,
    setLocale,
    getKeybindings,
    updateKeybinding,
    resetKeybindings,
    exportConfig,
    importConfig,
    type ConfigImportReport,
    type AppConfig,
    type Theme,
    type KeyBinding,
    type LocaleInfo,
  } from '$lib/editor/commands'
  import { useI18n } from '$lib/stores/i18n.svelte'
  import ThemeEditor from './ThemeEditor.svelte'
  import { acceleratorFromEvent } from './keybindings'
  import { downloadConfigAsJson, readJsonFromFileInput } from './configIO'
  import GeneralSection from './GeneralSection.svelte'
  import AppearanceSection from './AppearanceSection.svelte'
  import ShortcutsSection from './ShortcutsSection.svelte'
  import AboutSection from './AboutSection.svelte'

  const i18n = useI18n()

  let {
    visible = $bindable(false),
    onConfigChange,
  }: {
    visible: boolean
    onConfigChange?: (updates: Partial<AppConfig>) => void
  } = $props()
  let activeSection = $state<'general' | 'appearance' | 'shortcuts' | 'about'>('general')
  let config = $state<AppConfig | null>(null)
  let localeInfo = $state<LocaleInfo | null>(null)
  let themes = $state<Theme[]>([])
  let keybindings = $state<KeyBinding[]>([])
  let recordingId = $state<string | null>(null)
  let loading = $state(false)
  let themeEditorVisible = $state(false)

  // P1-11: platform detection drives the spellcheck tooltip.
  // We can't import the cargo cfg from the renderer, so we
  // rely on `navigator.platform` for the OS the WebView is
  // running on. The Settings copy on non-macOS reads
  // "currently only English is checked".
  const isMacPlatform = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

  async function load() {
    loading = true
    try {
      const [c, l, t, k] = await Promise.all([
        getConfig(),
        getLocale(),
        getThemes(),
        getKeybindings(),
      ])
      config = c
      localeInfo = l
      themes = t
      keybindings = k
    } catch (e) {
      console.error('Failed to load settings:', e)
    }
    loading = false
  }

  // P0-X: Typora-style "saved" toast. We flash a
  // "✓ Saved" indicator in the dialog header for ~1.5s
  // after every successful save so the user knows the
  // change persisted (Typora / VSCode both do this; the
  // previous implementation gave no visible feedback and
  // the user had to assume `setConfig` succeeded).
  let justSaved = $state(false)
  // P0-X: import-report state. Set after the user picks
  // a config file so the panel can flash a one-line
  // summary ("Restored: 2 themes, 0 skipped, 12
  // keybindings"). `null` hides the report.
  let configImportReport = $state<ConfigImportReport | null>(null)
  // P0-X: re-fetch the latest config after a successful
  // import so the Settings UI reflects the freshly
  // restored theme / editor prefs / keybindings without
  // a restart.
  async function reloadAllAfterImport() {
    try {
      const [c, k] = await Promise.all([getConfig(), getKeybindings()])
      config = c
      keybindings = k
      // Re-apply i18n + theme through the same path the
      // user would take when changing them in Settings.
      if (c.language) {
        await i18n.changeLocale(c.language)
      }
      onConfigChange?.(c as unknown as Partial<AppConfig>)
      flashSaved()
    } catch (e) {
      console.error('Failed to reload config after import:', e)
    }
  }
  async function handleExportConfig() {
    try {
      const payload = await exportConfig()
      await downloadConfigAsJson(payload)
      flashSaved()
    } catch (e) {
      console.error('Failed to export preferences:', e)
    }
  }
  async function handleImportConfig() {
    // Hidden `<input type=file>` is rendered at the end
    // of the dialog; clicking it opens the native file
    // picker scoped to `.json` (Typora / VSCode
    // convention).
    if (importInput) importInput.click()
  }
  async function onImportFileChange(e: Event) {
    try {
      const payload = await readJsonFromFileInput(e)
      if (!payload) return
      const report = await importConfig(payload)
      configImportReport = report
      await reloadAllAfterImport()
    } catch (e) {
      console.error('Failed to import preferences:', e)
      configImportReport = null
    } finally {
      const target = e.target as HTMLInputElement
      target.value = ''
    }
  }
  let importInput: HTMLInputElement | null = $state.raw(null)
  let savedTimer: ReturnType<typeof setTimeout> | null = null
  function flashSaved() {
    justSaved = true
    if (savedTimer) clearTimeout(savedTimer)
    savedTimer = setTimeout(() => {
      justSaved = false
      savedTimer = null
    }, 1500)
  }

  async function saveConfig(updates: Partial<AppConfig>) {
    try {
      await setConfig(updates)
      if (config) {
        Object.assign(config, updates)
      }
      onConfigChange?.(updates)
      flashSaved()
    } catch (e) {
      console.error('Failed to save config:', e)
    }
  }

  async function changeLanguage(lang: string) {
    try {
      await setLocale(lang)
      if (localeInfo) {
        localeInfo.current = lang
      }
      onConfigChange?.({ language: lang })
    } catch (e) {
      console.error('Failed to set locale:', e)
    }
  }

  async function changeTheme(themeName: string) {
    // The `<select>` value is the human-readable label; the
    // label and the CSS class map 1:1 in this build (the
    // legacy label→class translator lives in `./themes.ts`
    // if the menu ever re-introduces a friendly name).
    await saveConfig({ theme: themeName })
  }

  async function handleImportTheme() {
    try {
      // Use the native file picker (rfd via Rust) so we get
      // an absolute path. The previous implementation used
      // `input[type=file]` which only exposed a sandboxed
      // filename and never persisted the imported theme to
      // the on-disk themes directory.
      const { pickThemeFile } = await import('$lib/editor/commands')
      const path = await pickThemeFile()
      if (!path) return  // user cancelled
      const theme = await importTheme(path)
      // Re-pull the canonical list from Rust so the UI
      // mirrors the on-disk truth (id may have been
      // canonicalised by `import_theme_from_path`).
      themes = await getThemes()
      void theme  // kept for future "select just-imported" UX
    } catch (e) {
      console.error('Failed to import theme:', e)
    }
  }

  async function handleDeleteTheme(id: string) {
    try {
      await deleteTheme(id)
      themes = themes.filter(t => t.id !== id)
    } catch (e) {
      console.error('Failed to delete theme:', e)
    }
  }

  async function handleResetKeybindings() {
    try {
      keybindings = await resetKeybindings()
    } catch (e) {
      console.error('Failed to reset keybindings:', e)
    }
  }

  function startRecording(id: string) {
    recordingId = id
  }

  function handleKeyCapture(e: KeyboardEvent, binding: KeyBinding) {
    if (!recordingId || recordingId !== binding.id) return
    e.preventDefault()
    e.stopPropagation()

    const accelerator = acceleratorFromEvent(e)
    if (!accelerator) return

    updateKeybinding(binding.id, accelerator).then((kb: KeyBinding[]) => {
      keybindings = kb
      recordingId = null
    }).catch((e: Error) => {
      console.error('Failed to update keybinding:', e)
      recordingId = null
    })
  }

  $effect(() => {
    if (visible) load()
  })
</script>

{#if visible}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="settings-overlay" onclick={() => visible = false}>
    <div class="settings-dialog" onclick={(e) => e.stopPropagation()}>
      <div class="settings-sidebar">
        <h3>
          {i18n.t('sidebar.settings')}
          {#if justSaved}
            <span class="settings-saved-flash" aria-live="polite">
              {i18n.t('settings.saved_flash')}
            </span>
          {/if}
        </h3>
        <nav>
          <button class:active={activeSection === 'general'} onclick={() => activeSection = 'general'}>{i18n.t('settings.general')}</button>
          <button class:active={activeSection === 'appearance'} onclick={() => activeSection = 'appearance'}>{i18n.t('settings.appearance')}</button>
          <button class:active={activeSection === 'shortcuts'} onclick={() => activeSection = 'shortcuts'}>{i18n.t('settings.shortcuts')}</button>
          <button class:active={activeSection === 'about'} onclick={() => activeSection = 'about'}>{i18n.t('settings.about')}</button>
        </nav>
      </div>

      <div class="settings-content">
        {#if loading}
          <div class="loading">{i18n.t('settings.loading')}</div>
        {:else if activeSection === 'general' && config}
          <GeneralSection
            {config}
            {localeInfo}
            {isMacPlatform}
            {configImportReport}
            onSaveConfig={saveConfig}
            onChangeLanguage={changeLanguage}
            onExportConfig={handleExportConfig}
            onImportConfig={handleImportConfig}
          />
        {:else if activeSection === 'appearance' && config}
          <AppearanceSection
            {themes}
            currentTheme={config.theme}
            onChangeTheme={changeTheme}
            onDeleteTheme={handleDeleteTheme}
            onImportTheme={handleImportTheme}
            onOpenThemeEditor={() => themeEditorVisible = true}
          />
        {:else if activeSection === 'shortcuts'}
          <ShortcutsSection
            {keybindings}
            {recordingId}
            platform={navigator.platform}
            onStartRecording={startRecording}
            onKeyCapture={handleKeyCapture}
            onReset={handleResetKeybindings}
          />
        {:else if activeSection === 'about'}
          <AboutSection />
        {/if}
      </div>

      <button class="close-btn" onclick={() => visible = false}>x</button>
    </div>
  </div>
{/if}

<!-- P0-X: hidden file input for the "Import Preferences"
     button. Same shape as the image-picker input —
     keep it offscreen but in the DOM so `input.click()`
     works on every WebView port. -->
<input
  bind:this={importInput}
  type="file"
  accept="application/json,.json"
  class="hidden-file-input"
  onchange={onImportFileChange}
  aria-hidden="true"
  tabindex="-1"
/>

{#if themeEditorVisible}
  <div class="theme-editor-wrapper">
    <ThemeEditor
      currentThemeId={config?.theme ?? ''}
      onThemeUpdated={(theme) => {
        // Optionally refresh themes list
      }}
    />
    <button class="close-btn" onclick={() => themeEditorVisible = false}>x</button>
  </div>
{/if}