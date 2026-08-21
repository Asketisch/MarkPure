<!--
  设置对话框——仅负责编排。

  四个分区（通用 / 外观 / 快捷键 / 关于）各自位于独立的 .svelte
  文件中。本组件负责：
    - 侧边栏标签导航（justSaved 闪烁、激活按钮状态）
    - 数据加载 effect（打开时加载）
    - IPC 接线（saveConfig、changeLanguage 等）
    - “导入偏好设置”的隐藏文件输入
    - ThemeEditor 遮罩的挂载点

  各分区标记见 `./GeneralSection.svelte`、`./AppearanceSection.svelte`、
  `./ShortcutsSection.svelte`、`./AboutSection.svelte`。纯辅助函数
  （主题查找表、快捷键格式化、配置导入导出 I/O）位于
  `./themes.ts`、`./keybindings.ts`、`./configIO.ts`。

  样式位于 `./settings.css`，让编排文件专注于模板与脚本逻辑。
-->
<script lang="ts">
  import './settings.css'
  import { onMount, onDestroy, untrack } from 'svelte'
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
    pickThemeFile,
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

  // 平台检测驱动拼写检查的提示文案。渲染进程无法导入 cargo 的
  // cfg，因此用 `navigator.platform` 判断 WebView 运行在哪个
  // 操作系统上。非 macOS 平台上的设置文案显示
  // “currently only English is checked”。
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

  // “已保存”提示。每次保存成功后，在对话框标题栏闪烁约 1.5 秒
  // 的“✓ Saved”指示器，让用户确认改动确实已持久化（之前的实现
  // 没有任何可见反馈，用户只能假设 `setConfig` 成功了）。
  let justSaved = $state(false)
  // 导入报告状态。用户选定配置文件后写入，面板据此闪烁显示一行
  // 摘要（“Restored: 2 themes, 0 skipped, 12 keybindings”）。
  // `null` 表示不显示报告。
  let configImportReport = $state<ConfigImportReport | null>(null)
  // 导入成功后重新拉取最新配置，让设置界面无需重启即可反映
  // 刚恢复的主题 / 编辑器偏好 / 快捷键。
  async function reloadAllAfterImport() {
    try {
      const [c, k] = await Promise.all([getConfig(), getKeybindings()])
      config = c
      keybindings = k
      // 通过用户在设置里动手改时的同一条路径，重新应用
      // i18n 与主题。
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
    // 隐藏的 `<input type=file>` 渲染在对话框末尾；点击它会弹出
    // 限定为 `.json` 的原生文件选择器（业界通用做法）。
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
  // 对话框关闭时若有「已保存」闪烁计时器在途，取消它。
  onDestroy(() => {
    if (savedTimer) clearTimeout(savedTimer)
  })

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
    // `<select>` 的值是人类可读的名称；本版本中名称与 CSS class
    // 一一对应（旧式名称→class 的转换器保留在 `./themes.ts`，
    // 以备将来菜单再次引入友好名称）。
    await saveConfig({ theme: themeName })
  }

  async function handleImportTheme() {
    try {
      // 使用原生文件选择器（经 Rust 的 rfd），这样才能拿到绝对
      // 路径。之前的实现用 `input[type=file]`，只能拿到沙箱化
      // 文件名，而且从不会把导入的主题写入磁盘上的主题目录。
      const path = await pickThemeFile()
      if (!path) return  // user cancelled
      const theme = await importTheme(path)
      // 从 Rust 重新拉取规范化列表，让界面与磁盘上的实际情况同步
      // （id 可能已被 `import_theme_from_path` 规范化）。
      themes = await getThemes()
      void theme  // 保留给未来“选中刚导入的主题”的交互
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
            onStopRecording={() => {
              recordingId = null
            }}
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

<!-- “导入偏好设置”按钮使用的隐藏文件输入。与图片选择器的
     输入同构——保持在屏幕外但留在 DOM 中，这样 `input.click()`
     在所有 WebView 端口上都能工作。 -->
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
      onThemeUpdated={() => {
        // 编辑器保存/新建主题后，从 Rust 重新拉取列表，
        // 让外观分区的自定义主题区与磁盘同步。
        getThemes().then((t) => { themes = t }).catch((e) => {
          console.error('Failed to refresh themes:', e)
        })
      }}
    />
    <button class="close-btn" onclick={() => themeEditorVisible = false}>x</button>
  </div>
{/if}