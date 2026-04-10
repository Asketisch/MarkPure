<script lang="ts">
  import { getThemes, saveCustomTheme, type Theme, type ThemeColors } from '$lib/commands'
  import ColorPicker from './ColorPicker.svelte'

  let {
    currentThemeId = '',
    onThemeUpdated,
  }: {
    currentThemeId?: string
    onThemeUpdated?: (theme: Theme) => void
  } = $props()

  let themes = $state<Theme[]>([])
  let selectedTheme = $state<Theme | null>(null)
  let editedColors = $state<ThemeColors | null>(null)
  let previewOpen = $state(false)
  let isModified = $state(false)

  // Built-in theme colors (fallback when no custom theme selected)
  const builtinThemeColors: Record<string, Partial<ThemeColors>> = {
    '': {
      bg: '#ffffff', bg_secondary: '#f6f8fa', bg_tab_active: '#ffffff', bg_tab_inactive: '#e8e8e8',
      text: '#24292e', text_secondary: '#586069', accent: '#0969da', accent_hover: '#0550ae',
      border: '#d0d7de', menu_hover_bg: '#0969da', menu_hover_text: '#ffffff', status_bg: '#f6f8fa',
      scrollbar_thumb: '#c1c1c1', highlight_bg: '#fff3b0', cell_selected_bg: 'rgba(9, 105, 218, 0.1)',
      heading1_color: '#24292e', heading2_color: '#24292e', heading3_color: '#24292e',
      heading4_color: '#24292e', heading5_color: '#24292e', heading6_color: '#586069',
      heading1_size: '2em', heading2_size: '1.5em', heading3_size: '1.25em',
      heading4_size: '1.1em', heading5_size: '1em', heading6_size: '0.9em',
      code_bg: '#f6f8fa', code_block_bg: '#f6f8fa',
      link_color: '#0969da', link_hover_color: '#0550ae',
      blockquote_border: '#0969da', blockquote_bg: '#f6f8fa',
      hr_color: '#d0d7de', table_border: '#d0d7de', table_header_bg: '#f6f8fa',
    },
    'theme-dark': {
      bg: '#1e1e1e', bg_secondary: '#252526', bg_tab_active: '#1e1e1e', bg_tab_inactive: '#2d2d2d',
      text: '#d4d4d4', text_secondary: '#858585', accent: '#007acc', accent_hover: '#1a8ad4',
      border: '#3e3e3e', menu_hover_bg: '#007acc', menu_hover_text: '#ffffff', status_bg: '#252526',
      scrollbar_thumb: '#424242', highlight_bg: 'rgba(255, 200, 50, 0.3)', cell_selected_bg: 'rgba(0, 122, 204, 0.15)',
      heading1_color: '#e0e0e0', heading2_color: '#e0e0e0', heading3_color: '#e0e0e0',
      heading4_color: '#e0e0e0', heading5_color: '#e0e0e0', heading6_color: '#858585',
      heading1_size: '2em', heading2_size: '1.5em', heading3_size: '1.25em',
      heading4_size: '1.1em', heading5_size: '1em', heading6_size: '0.9em',
      code_bg: '#252526', code_block_bg: '#252526',
      link_color: '#007acc', link_hover_color: '#1a8ad4',
      blockquote_border: '#007acc', blockquote_bg: '#252526',
      hr_color: '#3e3e3e', table_border: '#3e3e3e', table_header_bg: '#252526',
    },
    'theme-one-dark': {
      bg: '#282c34', bg_secondary: '#2c313a', bg_tab_active: '#282c34', bg_tab_inactive: '#21252b',
      text: '#abb2bf', text_secondary: '#636d83', accent: '#61afef', accent_hover: '#528bcc',
      border: '#3e4451', menu_hover_bg: '#61afef', menu_hover_text: '#282c34', status_bg: '#21252b',
      scrollbar_thumb: '#4b5263', highlight_bg: 'rgba(97, 175, 239, 0.2)', cell_selected_bg: 'rgba(97, 175, 239, 0.12)',
      heading1_color: '#abb2bf', heading2_color: '#abb2bf', heading3_color: '#abb2bf',
      heading4_color: '#abb2bf', heading5_color: '#abb2bf', heading6_color: '#636d83',
      heading1_size: '2em', heading2_size: '1.5em', heading3_size: '1.25em',
      heading4_size: '1.1em', heading5_size: '1em', heading6_size: '0.9em',
      code_bg: '#2c313a', code_block_bg: '#2c313a',
      link_color: '#61afef', link_hover_color: '#528bcc',
      blockquote_border: '#61afef', blockquote_bg: '#2c313a',
      hr_color: '#3e4451', table_border: '#3e4451', table_header_bg: '#2c313a',
    },
    'theme-graphite': {
      bg: '#2b2b2b', bg_secondary: '#313131', bg_tab_active: '#2b2b2b', bg_tab_inactive: '#383838',
      text: '#c8c8c8', text_secondary: '#8a8a8a', accent: '#8a8a8a', accent_hover: '#a0a0a0',
      border: '#404040', menu_hover_bg: '#555555', menu_hover_text: '#ffffff', status_bg: '#313131',
      scrollbar_thumb: '#505050', highlight_bg: 'rgba(200, 200, 200, 0.15)', cell_selected_bg: 'rgba(138, 138, 138, 0.12)',
      heading1_color: '#c8c8c8', heading2_color: '#c8c8c8', heading3_color: '#c8c8c8',
      heading4_color: '#c8c8c8', heading5_color: '#c8c8c8', heading6_color: '#8a8a8a',
      heading1_size: '2em', heading2_size: '1.5em', heading3_size: '1.25em',
      heading4_size: '1.1em', heading5_size: '1em', heading6_size: '0.9em',
      code_bg: '#313131', code_block_bg: '#313131',
      link_color: '#8a8a8a', link_hover_color: '#a0a0a0',
      blockquote_border: '#8a8a8a', blockquote_bg: '#313131',
      hr_color: '#404040', table_border: '#404040', table_header_bg: '#313131',
    },
    'theme-ulysses': {
      bg: '#f5f0e8', bg_secondary: '#ede7db', bg_tab_active: '#f5f0e8', bg_tab_inactive: '#e5ddd0',
      text: '#3b3226', text_secondary: '#7a6f5f', accent: '#8b7355', accent_hover: '#a08060',
      border: '#d5cfc3', menu_hover_bg: '#8b7355', menu_hover_text: '#f5f0e8', status_bg: '#ede7db',
      scrollbar_thumb: '#c5bfb3', highlight_bg: 'rgba(139, 115, 85, 0.15)', cell_selected_bg: 'rgba(139, 115, 85, 0.1)',
      heading1_color: '#3b3226', heading2_color: '#3b3226', heading3_color: '#3b3226',
      heading4_color: '#3b3226', heading5_color: '#3b3226', heading6_color: '#7a6f5f',
      heading1_size: '2em', heading2_size: '1.5em', heading3_size: '1.25em',
      heading4_size: '1.1em', heading5_size: '1em', heading6_size: '0.9em',
      code_bg: '#ede7db', code_block_bg: '#ede7db',
      link_color: '#8b7355', link_hover_color: '#a08060',
      blockquote_border: '#8b7355', blockquote_bg: '#ede7db',
      hr_color: '#d5cfc3', table_border: '#d5cfc3', table_header_bg: '#ede7db',
    },
    'theme-material-dark': {
      bg: '#212121', bg_secondary: '#262626', bg_tab_active: '#212121', bg_tab_inactive: '#2c2c2c',
      text: '#e0e0e0', text_secondary: '#9e9e9e', accent: '#82b1ff', accent_hover: '#448aff',
      border: '#3c3c3c', menu_hover_bg: '#82b1ff', menu_hover_text: '#212121', status_bg: '#262626',
      scrollbar_thumb: '#424242', highlight_bg: 'rgba(130, 177, 255, 0.15)', cell_selected_bg: 'rgba(130, 177, 255, 0.1)',
      heading1_color: '#e0e0e0', heading2_color: '#e0e0e0', heading3_color: '#e0e0e0',
      heading4_color: '#e0e0e0', heading5_color: '#e0e0e0', heading6_color: '#9e9e9e',
      heading1_size: '2em', heading2_size: '1.5em', heading3_size: '1.25em',
      heading4_size: '1.1em', heading5_size: '1em', heading6_size: '0.9em',
      code_bg: '#262626', code_block_bg: '#262626',
      link_color: '#82b1ff', link_hover_color: '#448aff',
      blockquote_border: '#82b1ff', blockquote_bg: '#262626',
      hr_color: '#3c3c3c', table_border: '#3c3c3c', table_header_bg: '#262626',
    },
  }

  async function load() {
    try {
      themes = await getThemes()
      // Select first custom theme or null
      if (themes.length > 0) {
        selectedTheme = themes[0]
        editedColors = { ...themes[0].colors }
      }
    } catch (e) {
      console.error('Failed to load themes:', e)
    }
  }

  function selectTheme(theme: Theme) {
    selectedTheme = theme
    editedColors = { ...theme.colors }
    isModified = false
  }

  function isBuiltInTheme(themeId: string): boolean {
    return !themeId.startsWith('custom_')
  }

  function cloneAndEdit(themeId: string) {
    const builtin = builtinThemeColors[themeId]
    if (!builtin) return

    // Create a new custom theme based on the built-in
    const newTheme: Theme = {
      id: `custom_${Date.now()}`,
      name: `Custom ${new Date().toLocaleDateString()}`,
      author: 'User',
      description: 'Customized theme',
      is_dark: themeId !== '',
      colors: { ...builtin } as ThemeColors,
    }
    selectedTheme = newTheme
    editedColors = { ...newTheme.colors }
    isModified = true
  }

  function handleColorChange(key: keyof ThemeColors, value: string) {
    if (!editedColors) return
    editedColors[key] = value
    isModified = true
  }

  async function handleSave() {
    if (!selectedTheme || !editedColors) return
    try {
      const toSave = { ...selectedTheme, colors: editedColors }
      await saveCustomTheme(toSave)
      selectedTheme = toSave
      isModified = false
      onThemeUpdated?.(toSave)
      // Reload themes
      await load()
    } catch (e) {
      console.error('Failed to save theme:', e)
    }
  }

  function openPreview() {
    if (!editedColors) return
    previewOpen = true
  }

  // Color categories for display
  const colorCategories = [
    {
      name: 'UI Colors',
      colors: [
        { key: 'bg', label: 'Background' },
        { key: 'bg_secondary', label: 'Secondary BG' },
        { key: 'bg_tab_active', label: 'Tab Active' },
        { key: 'bg_tab_inactive', label: 'Tab Inactive' },
        { key: 'text', label: 'Text' },
        { key: 'text_secondary', label: 'Text Secondary' },
        { key: 'accent', label: 'Accent' },
        { key: 'accent_hover', label: 'Accent Hover' },
        { key: 'border', label: 'Border' },
        { key: 'status_bg', label: 'Status Bar BG' },
        { key: 'scrollbar_thumb', label: 'Scrollbar' },
      ],
    },
    {
      name: 'Headings',
      colors: [
        { key: 'heading1_color', label: 'H1 Color' },
        { key: 'heading2_color', label: 'H2 Color' },
        { key: 'heading3_color', label: 'H3 Color' },
        { key: 'heading4_color', label: 'H4 Color' },
        { key: 'heading5_color', label: 'H5 Color' },
        { key: 'heading6_color', label: 'H6 Color' },
      ],
    },
    {
      name: 'Heading Sizes',
      colors: [
        { key: 'heading1_size', label: 'H1 Size', isSize: true },
        { key: 'heading2_size', label: 'H2 Size', isSize: true },
        { key: 'heading3_size', label: 'H3 Size', isSize: true },
        { key: 'heading4_size', label: 'H4 Size', isSize: true },
        { key: 'heading5_size', label: 'H5 Size', isSize: true },
        { key: 'heading6_size', label: 'H6 Size', isSize: true },
      ],
    },
    {
      name: 'Code',
      colors: [
        { key: 'code_bg', label: 'Inline Code BG' },
        { key: 'code_block_bg', label: 'Code Block BG' },
      ],
    },
    {
      name: 'Links',
      colors: [
        { key: 'link_color', label: 'Link Color' },
        { key: 'link_hover_color', label: 'Link Hover' },
      ],
    },
    {
      name: 'Blockquote',
      colors: [
        { key: 'blockquote_border', label: 'Border' },
        { key: 'blockquote_bg', label: 'Background' },
      ],
    },
    {
      name: 'Other',
      colors: [
        { key: 'hr_color', label: 'Horizontal Rule' },
        { key: 'table_border', label: 'Table Border' },
        { key: 'table_header_bg', label: 'Table Header BG' },
        { key: 'highlight_bg', label: 'Highlight BG' },
        { key: 'cell_selected_bg', label: 'Cell Selected BG' },
      ],
    },
  ] as { name: string; colors: { key: keyof ThemeColors; label: string; isSize?: boolean }[] }[]

  $effect(() => {
    load()
  })
</script>

<div class="theme-editor">
  <div class="editor-header">
    <h3>Theme Editor</h3>
    {#if themes.length > 0}
      <select onchange={(e) => {
        const theme = themes.find(t => t.id === (e.target as HTMLSelectElement).value)
        if (theme) selectTheme(theme)
      }}>
        {#each themes as theme}
          <option value={theme.id} selected={selectedTheme?.id === theme.id}>{theme.name}</option>
        {/each}
      </select>
    {/if}
  </div>

  {#if !selectedTheme}
    <div class="no-theme">
      <p>No custom theme selected. Import or create a theme to edit.</p>
    </div>
  {:else}
    <div class="editor-content">
      <div class="theme-info">
        <span class="theme-name">{selectedTheme.name}</span>
        <span class="theme-badge" class:dark={selectedTheme.is_dark}>
          {selectedTheme.is_dark ? 'Dark' : 'Light'}
        </span>
        {#if isBuiltInTheme(selectedTheme.id)}
          <span class="builtin-badge">Built-in</span>
        {/if}
      </div>

      {#if isBuiltInTheme(selectedTheme.id)}
        <div class="builtin-notice">
          <p>Built-in themes cannot be directly edited.</p>
          <button onclick={() => cloneAndEdit(selectedTheme!.id)}>
            Clone and Customize
          </button>
        </div>
      {/if}

      <div class="color-sections">
        {#each colorCategories as category}
          <div class="color-section">
            <h4>{category.name}</h4>
            <div class="color-grid">
              {#each category.colors as item}
                <div class="color-item">
                  <label>{item.label}</label>
                  {#if item.isSize}
                    <input
                      type="text"
                      value={editedColors?.[item.key] ?? ''}
                      onchange={(e) => handleColorChange(item.key, (e.target as HTMLInputElement).value)}
                      disabled={isBuiltInTheme(selectedTheme.id)}
                    />
                  {:else}
                    <ColorPicker
                      value={editedColors?.[item.key] ?? '#000000'}
                      onchange={(val) => handleColorChange(item.key, val)}
                    />
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>

      <div class="editor-actions">
        <button class="preview-btn" onclick={openPreview}>
          Preview
        </button>
        {#if isModified && !isBuiltInTheme(selectedTheme.id)}
          <button class="save-btn" onclick={handleSave}>
            Save Changes
          </button>
        {/if}
      </div>
    </div>
  {/if}
</div>

{#if previewOpen && editedColors}
  <div class="preview-overlay" onclick={() => previewOpen = false}>
    <div class="preview-dialog" onclick={(e) => e.stopPropagation()}>
      <div class="preview-header">
        <h3>Theme Preview</h3>
        <button class="close-btn" onclick={() => previewOpen = false}>x</button>
      </div>
      <div class="preview-content" style="
        --bg: {editedColors.bg};
        --bg-secondary: {editedColors.bg_secondary};
        --text: {editedColors.text};
        --text-secondary: {editedColors.text_secondary};
        --border: {editedColors.border};
        --accent: {editedColors.accent};
        --heading1-color: {editedColors.heading1_color};
        --heading2-color: {editedColors.heading2_color};
        --heading3-color: {editedColors.heading3_color};
        --heading4-color: {editedColors.heading4_color};
        --heading5-color: {editedColors.heading5_color};
        --heading6-color: {editedColors.heading6_color};
        --heading1-size: {editedColors.heading1_size};
        --heading2-size: {editedColors.heading2_size};
        --heading3-size: {editedColors.heading3_size};
        --heading4-size: {editedColors.heading4_size};
        --heading5-size: {editedColors.heading5_size};
        --heading6-size: {editedColors.heading6_size};
        --code-bg: {editedColors.code_bg};
        --code-block-bg: {editedColors.code_block_bg};
        --link-color: {editedColors.link_color};
        --link-hover-color: {editedColors.link_hover_color};
        --blockquote-border: {editedColors.blockquote_border};
        --blockquote-bg: {editedColors.blockquote_bg};
        --hr-color: {editedColors.hr_color};
        --table-border: {editedColors.table_border};
        --table-header-bg: {editedColors.table_header_bg};
      ">
        <h1>Heading 1</h1>
        <h2>Heading 2</h2>
        <h3>Heading 3</h3>
        <h4>Heading 4</h4>
        <h5>Heading 5</h5>
        <h6>Heading 6</h6>
        <p>Normal paragraph text with <strong>bold</strong> and <em>italic</em> and <code>inline code</code>.</p>
        <p><a href="#">This is a link</a></p>
        <blockquote>This is a blockquote</blockquote>
        <pre><code>Code block example</code></pre>
        <hr />
        <table>
          <thead>
            <tr><th>Header 1</th><th>Header 2</th></tr>
          </thead>
          <tbody>
            <tr><td>Cell 1</td><td>Cell 2</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
{/if}

<style>
  .theme-editor {
    padding: 16px;
    height: 100%;
    overflow-y: auto;
  }

  .editor-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }

  .editor-header h3 {
    font-size: 16px;
    margin: 0;
  }

  .editor-header select {
    padding: 6px 10px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
  }

  .no-theme {
    text-align: center;
    padding: 40px;
    color: var(--text-secondary);
  }

  .theme-info {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 16px;
  }

  .theme-name {
    font-weight: 600;
    font-size: 14px;
  }

  .theme-badge {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--border);
  }

  .theme-badge.dark {
    background: #333;
    color: #ccc;
  }

  .builtin-badge {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--accent);
    color: white;
  }

  .builtin-notice {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px;
    margin-bottom: 16px;
  }

  .builtin-notice p {
    margin: 0 0 8px 0;
    font-size: 13px;
    color: var(--text-secondary);
  }

  .builtin-notice button {
    padding: 6px 12px;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  }

  .color-sections {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .color-section {
    background: var(--bg-secondary);
    border-radius: 8px;
    padding: 12px;
  }

  .color-section h4 {
    margin: 0 0 8px 0;
    font-size: 12px;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .color-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 8px;
  }

  .color-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .color-item label {
    font-size: 11px;
    color: var(--text-secondary);
  }

  .color-item input[type="text"] {
    padding: 4px 8px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    font-size: 12px;
  }

  .editor-actions {
    display: flex;
    gap: 8px;
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid var(--border);
  }

  .preview-btn {
    padding: 8px 16px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    cursor: pointer;
    font-size: 13px;
  }

  .save-btn {
    padding: 8px 16px;
    background: var(--accent);
    border: none;
    border-radius: 6px;
    color: white;
    cursor: pointer;
    font-size: 13px;
  }

  /* Preview overlay */
  .preview-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 3000;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .preview-dialog {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 12px;
    width: 600px;
    max-height: 80vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .preview-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }

  .preview-header h3 {
    margin: 0;
    font-size: 14px;
  }

  .preview-header .close-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 18px;
    padding: 4px 8px;
    border-radius: 4px;
  }

  .preview-header .close-btn:hover {
    background: var(--menu-hover-bg);
    color: var(--text);
  }

  .preview-content {
    padding: 20px;
    overflow-y: auto;
    font-family: var(--editor-font-family);
    font-size: var(--editor-font-size);
    line-height: 1.7;
    color: var(--text);
    background: var(--bg);
  }

  .preview-content h1 { font-size: var(--heading1-size); font-weight: 700; margin: 1em 0 0.5em; color: var(--heading1-color); }
  .preview-content h2 { font-size: var(--heading2-size); font-weight: 600; margin: 0.8em 0 0.4em; color: var(--heading2-color); }
  .preview-content h3 { font-size: var(--heading3-size); font-weight: 600; margin: 0.6em 0 0.3em; color: var(--heading3-color); }
  .preview-content h4 { font-size: var(--heading4-size); font-weight: 600; margin: 0.5em 0 0.3em; color: var(--heading4-color); }
  .preview-content h5 { font-size: var(--heading5-size); font-weight: 600; margin: 0.4em 0 0.2em; color: var(--heading5-color); }
  .preview-content h6 { font-size: var(--heading6-size); font-weight: 600; margin: 0.4em 0 0.2em; color: var(--heading6-color); }
  .preview-content p { margin: 0.4em 0; }
  .preview-content code { background: var(--code-bg); padding: 0.15em 0.4em; border-radius: 3px; font-size: 0.88em; }
  .preview-content a { color: var(--link-color); text-decoration: none; }
  .preview-content blockquote { border-left: 4px solid var(--blockquote-border); padding: 0.3em 1em; margin: 0.5em 0; background: var(--blockquote-bg); }
  .preview-content pre { background: var(--code-block-bg); border: 1px solid var(--border); border-radius: 6px; padding: 12px; }
  .preview-content hr { border: none; border-top: 2px solid var(--hr-color); margin: 1.2em 0; }
  .preview-content table { border-collapse: collapse; width: 100%; }
  .preview-content th, .preview-content td { border: 1px solid var(--table-border); padding: 6px 12px; }
  .preview-content th { background: var(--table-header-bg); font-weight: 600; }
</style>
