<script lang="ts">
  import {
    getConfig,
    setConfig,
    getThemes,
    importTheme,
    exportTheme,
    deleteTheme,
    getLocale,
    setLocale,
    getKeybindings,
    updateKeybinding,
    resetKeybindings,
    type AppConfig,
    type Theme,
    type KeyBinding,
    type LocaleInfo,
  } from '$lib/editor/commands'
  import { useI18n } from '$lib/stores/i18n.svelte'
  import ThemeEditor from './ThemeEditor.svelte'

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

  async function saveConfig(updates: Partial<AppConfig>) {
    try {
      await setConfig(updates)
      if (config) {
        Object.assign(config, updates)
      }
      onConfigChange?.(updates)
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
    // Convert human-readable labels to CSS class names
    const labelToClass: Record<string, string> = {
      'Cadmium Light': '',
      'Light': '',
      'Dark': 'theme-dark',
      'One Dark': 'theme-one-dark',
      'Graphite': 'theme-graphite',
      'Ulysses': 'theme-ulysses',
      'Material Dark': 'theme-material-dark',
      'Blue Topaz': 'theme-blue-topaz',
    }
    const cssClass = labelToClass[themeName] ?? themeName
    await saveConfig({ theme: cssClass })
  }

  // Convert CSS class name to human-readable label for display
  function getThemeLabel(cssClass: string): string {
    const classToLabel: Record<string, string> = {
      '': 'Cadmium Light',
      'theme-dark': 'Dark',
      'theme-one-dark': 'One Dark',
      'theme-graphite': 'Graphite',
      'theme-ulysses': 'Ulysses',
      'theme-material-dark': 'Material Dark',
      'theme-blue-topaz': 'Blue Topaz',
    }
    return classToLabel[cssClass] ?? cssClass
  }

  async function handleImportTheme() {
    try {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) return
        const path = file.name
        const text = await file.text()
        const theme = JSON.parse(text) as Theme
        theme.id = `custom_${Date.now()}`
        themes = [...themes, theme]
      }
      input.click()
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

    const parts: string[] = []
    if (e.metaKey || e.ctrlKey) parts.push('CmdOrCtrl')
    if (e.shiftKey) parts.push('Shift')
    if (e.altKey) parts.push('Alt')

    const key = e.key
    if (!['Meta', 'Control', 'Shift', 'Alt'].includes(key)) {
      parts.push(key.length === 1 ? key.toUpperCase() : key)
      const accelerator = parts.join('+')

      updateKeybinding(binding.id, accelerator).then((kb: KeyBinding[]) => {
        keybindings = kb
        recordingId = null
      }).catch((e: Error) => {
        console.error('Failed to update keybinding:', e)
        recordingId = null
      })
    }
  }

  function formatAccelerator(acc: string | null): string {
    if (!acc) return '—'
    return acc
      .replace('CmdOrCtrl', navigator.platform.includes('Mac') ? '\u2318' : 'Ctrl')
      .replace('Shift', '\u21E7')
      .replace('Alt', '\u2325')
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
        <h3>{i18n.t('sidebar.settings')}</h3>
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
          <section>
            <h2>{i18n.t('settings.general')}</h2>

            <div class="setting-row">
              <label>{i18n.t('settings.language')}</label>
              <select value={localeInfo?.current ?? 'en'} onchange={(e) => changeLanguage((e.target as HTMLSelectElement).value)}>
                {#if localeInfo}
                  {#each localeInfo.available as [code, name]}
                    <option value={code}>{name}</option>
                  {/each}
                {/if}
              </select>
            </div>

            <div class="setting-row">
              <label>{i18n.t('settings.font_family')}</label>
              <input type="text" value={config.editor.font_family} onchange={(e) => saveConfig({ editor: { ...config!.editor, font_family: (e.target as HTMLInputElement).value } })} />
            </div>

            <div class="setting-row">
              <label>{i18n.t('settings.font_size')}</label>
              <input type="number" min="10" max="32" value={config.editor.font_size} onchange={(e) => saveConfig({ editor: { ...config!.editor, font_size: Number((e.target as HTMLInputElement).value) } })} />
            </div>

            <div class="setting-row">
              <label>{i18n.t('settings.tab_size')}</label>
              <input type="number" min="2" max="8" value={config.editor.tab_size} onchange={(e) => saveConfig({ editor: { ...config!.editor, tab_size: Number((e.target as HTMLInputElement).value) } })} />
            </div>

            <div class="setting-row">
              <label>{i18n.t('settings.soft_tabs')}</label>
              <input type="checkbox" checked={config.editor.soft_tabs} onchange={(e) => saveConfig({ editor: { ...config!.editor, soft_tabs: (e.target as HTMLInputElement).checked } })} />
            </div>

            <div class="setting-row">
              <label>{i18n.t('settings.line_numbers')}</label>
              <input type="checkbox" checked={config.editor.line_numbers} onchange={(e) => saveConfig({ editor: { ...config!.editor, line_numbers: (e.target as HTMLInputElement).checked } })} />
            </div>

            <div class="setting-row">
              <label>{i18n.t('settings.word_wrap')}</label>
              <input type="checkbox" checked={config.editor.word_wrap} onchange={(e) => saveConfig({ editor: { ...config!.editor, word_wrap: (e.target as HTMLInputElement).checked } })} />
            </div>

            <div class="setting-row">
              <label>{i18n.t('settings.auto_save_interval')}</label>
              <input type="number" min="0" max="300" value={config.editor.auto_save_interval} onchange={(e) => saveConfig({ editor: { ...config!.editor, auto_save_interval: Number((e.target as HTMLInputElement).value) } })} />
            </div>
          </section>

        {:else if activeSection === 'appearance'}
          <section>
            <h2>{i18n.t('settings.appearance')}</h2>

            <div class="setting-row">
              <label>{i18n.t('settings.builtin_theme')}</label>
              <select value={getThemeLabel(config?.theme ?? '')} onchange={(e) => changeTheme((e.target as HTMLSelectElement).value)}>
                <option value="Cadmium Light">Cadmium Light</option>
                <option value="Dark">Dark</option>
                <option value="One Dark">One Dark</option>
                <option value="Graphite">Graphite</option>
                <option value="Ulysses">Ulysses</option>
                <option value="Material Dark">Material Dark</option>
                <option value="Blue Topaz">Blue Topaz</option>
              </select>
            </div>

            {#if themes.length > 0}
              <h3>{i18n.t('settings.custom_themes')}</h3>
              {#each themes as theme (theme.id)}
                <div class="theme-card">
                  <div class="theme-info">
                    <span class="theme-name">{theme.name}</span>
                    <span class="theme-author">by {theme.author}</span>
                    <span class="theme-badge" class:dark={theme.is_dark}>{theme.is_dark ? 'Dark' : 'Light'}</span>
                  </div>
                  <div class="theme-actions">
                    <button onclick={() => handleDeleteTheme(theme.id)}>{i18n.t('action.delete')}</button>
                  </div>
                </div>
              {/each}
            {/if}

            <div class="setting-actions">
              <button onclick={handleImportTheme}>{i18n.t('settings.import_theme')}</button>
              <button onclick={() => themeEditorVisible = true}>{i18n.t('settings.edit_theme')}</button>
            </div>
          </section>

        {:else if activeSection === 'shortcuts'}
          <section>
            <div class="section-header">
              <h2>{i18n.t('settings.shortcuts')}</h2>
              <button class="reset-btn" onclick={handleResetKeybindings}>{i18n.t('settings.reset_to_default')}</button>
            </div>

            <div class="keybindings-list">
              {#each keybindings as binding (binding.id)}
                <div class="kb-row">
                  <span class="kb-label">{binding.label}</span>
                  {#if recordingId === binding.id}
                    <button class="kb-key recording" onkeydown={(e) => handleKeyCapture(e, binding)}>{i18n.t('settings.press_keys')}</button>
                  {:else}
                    <button class="kb-key" onclick={() => startRecording(binding.id)}>
                      {formatAccelerator(binding.accelerator)}
                    </button>
                  {/if}
                </div>
              {/each}
            </div>
          </section>

        {:else if activeSection === 'about'}
          <section>
            <h2>{i18n.t('settings.about')} {i18n.t('app.name')}</h2>
            <div class="about-info">
              <h1>{i18n.t('app.name')}</h1>
              <p>{i18n.t('app.description')}</p>
              <p class="version">v0.1.0</p>
            </div>
          </section>
        {/if}
      </div>

      <button class="close-btn" onclick={() => visible = false}>x</button>
    </div>
  </div>
{/if}

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

<style>
  .settings-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 2000;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .settings-dialog {
    display: flex;
    width: 720px;
    max-height: 80vh;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    overflow: hidden;
    position: relative;
  }

  .settings-sidebar {
    width: 180px;
    background: var(--bg-secondary);
    border-right: 1px solid var(--border);
    padding: 16px 0;
    flex-shrink: 0;
  }

  .settings-sidebar h3 {
    padding: 0 16px 12px;
    font-size: 14px;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .settings-sidebar nav {
    display: flex;
    flex-direction: column;
  }

  .settings-sidebar button {
    text-align: left;
    padding: 8px 16px;
    border: none;
    background: none;
    color: var(--text);
    cursor: pointer;
    font-size: 13px;
    transition: background 0.15s;
  }

  .settings-sidebar button:hover {
    background: var(--menu-hover-bg);
  }

  .settings-sidebar button.active {
    background: var(--accent);
    color: white;
  }

  .settings-content {
    flex: 1;
    padding: 24px;
    overflow-y: auto;
  }

  .settings-content h2 {
    font-size: 18px;
    margin-bottom: 20px;
  }

  .settings-content h3 {
    font-size: 14px;
    color: var(--text-secondary);
    margin: 20px 0 10px;
  }

  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 0;
    border-bottom: 1px solid var(--border);
  }

  .setting-row label {
    font-size: 13px;
  }

  .setting-row input[type="text"],
  .setting-row input[type="number"],
  .setting-row select {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 6px 10px;
    border-radius: 6px;
    font-size: 13px;
    min-width: 160px;
  }

  .setting-row input[type="checkbox"] {
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
  }

  .setting-actions {
    margin-top: 16px;
  }

  .setting-actions button {
    padding: 8px 16px;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
  }

  .setting-actions button:hover {
    opacity: 0.9;
  }

  .theme-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px;
    margin-bottom: 8px;
    background: var(--bg-secondary);
    border-radius: 8px;
    border: 1px solid var(--border);
  }

  .theme-info {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .theme-name { font-weight: 600; font-size: 13px; }
  .theme-author { color: var(--text-secondary); font-size: 12px; }
  .theme-badge {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--border);
  }
  .theme-badge.dark { background: #333; color: #ccc; }

  .theme-actions button {
    padding: 4px 10px;
    background: none;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }

  .reset-btn {
    padding: 6px 12px;
    background: none;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
  }

  .keybindings-list {
    display: flex;
    flex-direction: column;
  }

  .kb-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
  }

  .kb-label { font-size: 13px; }

  .kb-key {
    padding: 4px 10px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 4px;
    font-size: 12px;
    font-family: monospace;
    cursor: pointer;
    min-width: 120px;
    text-align: center;
  }

  .kb-key.recording {
    background: var(--accent);
    color: white;
    animation: pulse 1s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
  }

  .about-info {
    text-align: center;
    padding: 40px 0;
  }

  .about-info h1 {
    font-size: 28px;
    margin-bottom: 8px;
  }

  .about-info p {
    color: var(--text-secondary);
    margin-bottom: 4px;
  }

  .version {
    font-size: 14px;
  }

  .close-btn {
    position: absolute;
    top: 12px;
    right: 12px;
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 18px;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
  }

  .close-btn:hover {
    background: var(--menu-hover-bg);
    color: var(--text);
  }

  .loading {
    text-align: center;
    padding: 40px;
    color: var(--text-secondary);
  }

  .theme-editor-wrapper {
    position: fixed;
    inset: 0;
    background: var(--bg);
    z-index: 2001;
    display: flex;
    flex-direction: column;
  }

  .theme-editor-wrapper .close-btn {
    position: absolute;
    top: 12px;
    right: 12px;
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 18px;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    z-index: 2002;
  }

  .theme-editor-wrapper .close-btn:hover {
    background: var(--menu-hover-bg);
    color: var(--text);
  }
</style>
