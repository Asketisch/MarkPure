# Graph Report - .  (2026-05-20)

## Corpus Check
- 131 files · ~89,324 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1073 nodes · 1494 edges · 95 communities (70 shown, 25 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 74 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_IPC Command Handlers|IPC Command Handlers]]
- [[_COMMUNITY_Svelte UI Components|Svelte UI Components]]
- [[_COMMUNITY_Project Documentation|Project Documentation]]
- [[_COMMUNITY_Backend Core Crates|Backend Core Crates]]
- [[_COMMUNITY_Frontend IPC Commands|Frontend IPC Commands]]
- [[_COMMUNITY_Frontend IPC Extended|Frontend IPC Extended]]
- [[_COMMUNITY_Frontmatter Parsing|Frontmatter Parsing]]
- [[_COMMUNITY_Text Selection|Text Selection]]
- [[_COMMUNITY_NPM Dependencies|NPM Dependencies]]
- [[_COMMUNITY_Workspace Management|Workspace Management]]
- [[_COMMUNITY_Document Model|Document Model]]
- [[_COMMUNITY_Markdown Parsing & Folding|Markdown Parsing & Folding]]
- [[_COMMUNITY_Pandoc AST Processing|Pandoc AST Processing]]
- [[_COMMUNITY_Workspace Search Engine|Workspace Search Engine]]
- [[_COMMUNITY_Editor Extensions Core|Editor Extensions Core]]
- [[_COMMUNITY_Table Parsing|Table Parsing]]
- [[_COMMUNITY_Node TypeScript Config|Node TypeScript Config]]
- [[_COMMUNITY_Theme Management|Theme Management]]
- [[_COMMUNITY_Image & Asset Processing|Image & Asset Processing]]
- [[_COMMUNITY_Search Plugin Frontend|Search Plugin Frontend]]
- [[_COMMUNITY_CodeMirror Theming|CodeMirror Theming]]
- [[_COMMUNITY_Bookmark System|Bookmark System]]
- [[_COMMUNITY_Mermaid Diagrams|Mermaid Diagrams]]
- [[_COMMUNITY_Paste Handler|Paste Handler]]
- [[_COMMUNITY_App Configuration|App Configuration]]
- [[_COMMUNITY_Internationalization|Internationalization]]
- [[_COMMUNITY_Instant Render Plugin|Instant Render Plugin]]
- [[_COMMUNITY_Claude Config|Claude Config]]
- [[_COMMUNITY_App TypeScript Config|App TypeScript Config]]
- [[_COMMUNITY_Core Editor Concepts|Core Editor Concepts]]
- [[_COMMUNITY_Block Extensions|Block Extensions]]
- [[_COMMUNITY_Code Block NodeView|Code Block NodeView]]
- [[_COMMUNITY_File IO|File I/O]]
- [[_COMMUNITY_Word Export|Word Export]]
- [[_COMMUNITY_Spell Check|Spell Check]]
- [[_COMMUNITY_NPM Scripts|NPM Scripts]]
- [[_COMMUNITY_i18n Backend|i18n Backend]]
- [[_COMMUNITY_View Extensions|View Extensions]]
- [[_COMMUNITY_Editing Extensions|Editing Extensions]]
- [[_COMMUNITY_File Watcher|File Watcher]]
- [[_COMMUNITY_Quick Insert|Quick Insert]]
- [[_COMMUNITY_App Icons & Branding|App Icons & Branding]]
- [[_COMMUNITY_Keymap System|Keymap System]]
- [[_COMMUNITY_PDF Export|PDF Export]]
- [[_COMMUNITY_Tab State Persistence|Tab State Persistence]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 90|Community 90]]
- [[_COMMUNITY_Community 91|Community 91]]
- [[_COMMUNITY_Community 92|Community 92]]
- [[_COMMUNITY_Community 93|Community 93]]
- [[_COMMUNITY_Community 94|Community 94]]

## God Nodes (most connected - your core abstractions)
1. `handle_command()` - 55 edges
2. `ipc()` - 51 edges
3. `Document` - 23 edges
4. `Selection` - 19 edges
5. `compilerOptions` - 18 edges
6. `CodeBlockView` - 13 edges
7. `AppConfig` - 12 edges
8. `AGENTS.md - core-lib/ core types library` - 11 edges
9. `compilerOptions` - 10 edges
10. `main.rs - WebView creation, IPC dispatch, document registry` - 10 edges

## Surprising Connections (you probably didn't know these)
- `README Project Overview` --semantically_similar_to--> `Frontend-Only-Rendering Architecture Principle`  [INFERRED] [semantically similar]
  README.md → CLAUDE.md
- `Search and Replace (regex support)` --conceptually_related_to--> `Custom IPC JSON Protocol`  [INFERRED]
  README.md → CLAUDE.md
- `Multi-Tab System` --conceptually_related_to--> `Document Registry (Rust Rope)`  [INFERRED]
  README.md → CLAUDE.md
- `CodeMirror 6 Code Blocks` --conceptually_related_to--> `Tiptap (ProseMirror) WYSIWYG Editor`  [INFERRED]
  README.md → CLAUDE.md
- `KaTeX Math Formula Rendering` --conceptually_related_to--> `Tiptap (ProseMirror) WYSIWYG Editor`  [INFERRED]
  README.md → CLAUDE.md

## Hyperedges (group relationships)
- **Edit Data Flow: User Input to Rust Document Registry** —  [EXTRACTED 1.00]
- **Security Layer: Multiple defenses across IPC boundary** —  [EXTRACTED 1.00]
- **File Open Data Flow: Rust read to Tiptap render** —  [EXTRACTED 1.00]
- **AGENTS.md three-tier navigation hierarchy for backend** —  [EXTRACTED 1.00]
- **Export formats (HTML, PDF, Word) depend on markdown parser for content conversion** —  [INFERRED 0.85]
- **core-lib defines shared types used across all backend crates** —  [INFERRED 0.85]
- **CodeMirror 6 integration spans extensions, nodeviews, and source editor** — extensions_blocks_code_block_cm_extension_ts, extensions_blocks_cm_theme_ts, nodeviews_code_block_view_ts, components_workspace_sourceeditor_svelte [INFERRED 0.95]
- **Search functionality spans plugin, extension, SearchBar, and WorkspaceSearch** — plugins_search_ts, extensions_editing_search_extension_ts, components_workspace_searchbar_svelte, components_workspace_workspacesearch_svelte [INFERRED 0.85]
- **Theme editing spans ThemeEditor, ColorPicker, Settings, and CSS variables** — features_settings_themeeditor_svelte, components_ui_colorpicker_svelte, features_settings_settings_svelte, concept_css_variables [INFERRED 0.85]

## Communities (95 total, 25 thin omitted)

### Community 0 - "IPC Command Handlers"
Cohesion: 0.07
Nodes (61): AppState, Assets, cmd_check_spelling(), cmd_create_directory(), cmd_create_file(), cmd_delete_file(), cmd_delete_theme(), cmd_doc_close() (+53 more)

### Community 1 - "Svelte UI Components"
Cohesion: 0.05
Nodes (33): content, existing, handleQISelect(), nodeText, previewTab, t, Tab, timerId (+25 more)

### Community 2 - "Project Documentation"
Cohesion: 0.05
Nodes (45): Root AGENTS.md Navigation, CLAUDE.md Project Instructions, SPA Entry Point (index.html), AGENTS.md Navigation System, Frontend-Only-Rendering Architecture Principle, CJK Support, CodeMirror 6 Code Blocks, mt-assets Crate (+37 more)

### Community 3 - "Backend Core Crates"
Cohesion: 0.07
Nodes (42): AGENTS.md - assets/ image resource management, assets lib.rs - save_pasted_image, upload_image_remote, detect_image_format, AGENTS.md - bookmark/ bookmark CRUD, bookmark lib.rs - load_bookmarks, add_bookmark, update_bookmark, remove_bookmark, AGENTS.md - core-lib/ core types library, config.rs - AppConfig, EditorConfig, dirs.rs - directory utilities, document.rs - Document (rope text buffer) (+34 more)

### Community 4 - "Frontend IPC Commands"
Cohesion: 0.05
Nodes (39): checkSpelling(), copyToClipboard(), createDirectory(), createFile(), docClose(), docGetStats(), docOpen(), docSearch() (+31 more)

### Community 5 - "Frontend IPC Extended"
Cohesion: 0.05
Nodes (37): AppConfig, AppInfo, deleteFile(), deleteTheme(), DocStats, DroppedFile, exportPdf(), FileChangeEvent (+29 more)

### Community 6 - "Frontmatter Parsing"
Cohesion: 0.09
Nodes (32): CompletionKind, find_frontmatter(), find_json_end(), find_toml_end(), find_yaml_end(), Frontmatter, FrontmatterBounds, FrontmatterCompletion (+24 more)

### Community 7 - "Text Selection"
Cohesion: 0.11
Nodes (11): delete_at_selections(), DeleteDirection, get_word_at_position(), get_word_range(), is_word_char(), Selection, SelectionRange, test_merge_overlapping() (+3 more)

### Community 8 - "NPM Dependencies"
Cohesion: 0.05
Nodes (37): dependencies, @codemirror/commands, @codemirror/lang-cpp, @codemirror/lang-css, @codemirror/lang-go, @codemirror/lang-html, @codemirror/lang-java, @codemirror/lang-javascript (+29 more)

### Community 9 - "Workspace Management"
Cohesion: 0.10
Nodes (9): FolderInfo, Orientation, Pane, test_pane_creation(), test_workspace_add_folder(), test_workspace_remove_folder(), test_workspace_state_split(), Workspace (+1 more)

### Community 10 - "Document Model"
Cohesion: 0.11
Nodes (3): Document, Encoding, LineEnding

### Community 11 - "Markdown Parsing & Folding"
Cohesion: 0.10
Nodes (17): compute_folding_ranges(), FoldRange, HeadingInfo, test_compute_folding_ranges_empty(), test_compute_folding_ranges_simple(), test_toggle_fold(), toggle_fold(), export_html() (+9 more)

### Community 12 - "Pandoc AST Processing"
Cohesion: 0.10
Nodes (17): DefinitionItem, ExampleItem, ExtendedCellAlign, Footnote, parse_definition_list(), parse_footnotes(), parse_markdown_extensions(), parse_task_items() (+9 more)

### Community 13 - "Workspace Search Engine"
Cohesion: 0.13
Nodes (20): build_pattern(), is_binary_file(), read_file_content(), search_file(), search_workspace(), SearchMatch, SearchOptions, SearchResult (+12 more)

### Community 14 - "Editor Extensions Core"
Cohesion: 0.12
Nodes (11): MathExtension, SearchExtension, SelectSameWordExtension, Commands, WikiLinkExtension, WikiLinkOptions, EditorOptions, MultiCursorExtension (+3 more)

### Community 15 - "Table Parsing"
Cohesion: 0.16
Nodes (16): CellAlign, find_tables(), parse_delimiter_row(), parse_table(), parse_table_row(), render_table(), TableOpType, TableStructure (+8 more)

### Community 16 - "Node TypeScript Config"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, moduleResolution, noEmit (+11 more)

### Community 17 - "Theme Management"
Cohesion: 0.15
Nodes (10): delete_custom_theme(), export_theme_to_path(), import_theme_from_path(), load_custom_themes(), save_custom_theme(), Theme, ThemeColors, ThemeId (+2 more)

### Community 18 - "Image & Asset Processing"
Cohesion: 0.16
Nodes (12): detect_image_format_from_bytes(), extension_from_mime(), FileInfo, get_file_info(), image_to_base64(), ImagePasteMode, is_file_readonly(), RemoteUploadResult (+4 more)

### Community 19 - "Search Plugin Frontend"
Cohesion: 0.14
Nodes (9): escapeRegex(), findMatches(), findNext(), findPrev(), getDocText(), scrollCurrentMatchIntoView(), SearchOptions, searchPluginKey (+1 more)

### Community 20 - "CodeMirror Theming"
Cohesion: 0.19
Nodes (12): createThemeExtension(), detectDarkTheme(), $lib/extensions/blocks/cm-theme, @codemirror/lang-markdown, getLanguageExtension(), languageAliases, languageExtensions, normalizeLanguage() (+4 more)

### Community 21 - "Bookmark System"
Cohesion: 0.22
Nodes (15): add_bookmark(), Bookmark, bookmarks_path(), BookmarkStore, Error, generate_id(), get_all_tags(), get_bookmark() (+7 more)

### Community 22 - "Mermaid Diagrams"
Cohesion: 0.17
Nodes (10): are_brackets_balanced(), DiagramType, extract_mermaid_blocks(), MermaidCompletion, MermaidError, MermaidResult, parse_mermaid(), render_mermaid_with_cli() (+2 more)

### Community 23 - "Paste Handler"
Cohesion: 0.14
Nodes (9): PasteHandlerExtension, pasteHandlerPluginKey, @tiptap/core, ./Outline.svelte, $lib/plugins/search, Commands, FocusModeExtension, FocusModeOptions (+1 more)

### Community 24 - "App Configuration"
Cohesion: 0.13
Nodes (3): AppConfig, EditorConfig, WindowConfig

### Community 25 - "Internationalization"
Cohesion: 0.19
Nodes (6): getLocale(), getTranslations(), setLocale(), I18n, I18N_KEY, Translations

### Community 26 - "Instant Render Plugin"
Cohesion: 0.19
Nodes (8): createInstantRenderPlugin(), createMarkerWidget(), decorateNode(), instantRenderPluginKey, InstantRenderState, isNearCursor(), WidgetDecorationSpec, InstantRenderExtension

### Community 27 - "Claude Config"
Cohesion: 0.15
Nodes (12): SEARXNG_URL, args, command, env, type, mcpServers, fetch, searxng (+4 more)

### Community 28 - "App TypeScript Config"
Cohesion: 0.15
Nodes (12): compilerOptions, allowJs, checkJs, module, moduleDetection, noEmit, target, tsBuildInfoFile (+4 more)

### Community 29 - "Core Editor Concepts"
Cohesion: 0.20
Nodes (12): Component Communication (Props/Context), IPC Commands Pattern, Svelte 5 Runes Pattern, IPC Command Wrapper, Editor Core, createEditor / getMarkdown / setContent, TypeScript Type Definitions, App.svelte (Main Container ~43KB) (+4 more)

### Community 30 - "Block Extensions"
Cohesion: 0.20
Nodes (12): CodeMirror 6 Integration, Block Extensions, CodeMirror Theme, CodeMirror 6 Code Block Node, Drop Handler (File/Image Drag), KaTeX Math Formula, Paste Handler (Smart Paste), Quick Insert (@ Trigger) (+4 more)

### Community 32 - "File I/O"
Cohesion: 0.26
Nodes (8): detect_and_decode(), encoding_to_doc(), read_file(), rename_file(), test_read_utf8_file(), test_write_and_read_roundtrip(), validate_file_name(), write_file()

### Community 33 - "Word Export"
Cohesion: 0.30
Nodes (10): create_blockquote(), create_code_paragraph(), create_document_xml(), create_heading(), create_list_item(), create_paragraph(), create_simple_docx(), export_word() (+2 more)

### Community 34 - "Spell Check"
Cohesion: 0.27
Nodes (7): check_spelling(), english_dictionary(), generate_suggestions(), Language, levenshtein_distance(), SpellCheckResult, SpellError

### Community 35 - "NPM Scripts"
Cohesion: 0.20
Nodes (9): name, private, scripts, build, check, dev, preview, type (+1 more)

### Community 36 - "i18n Backend"
Cohesion: 0.27
Nodes (6): get_all_locales(), get_locale_codes(), get_translations(), Locale, LocaleConfig, TranslationEntry

### Community 37 - "View Extensions"
Cohesion: 0.25
Nodes (9): Tiptap Extensions, Focus Mode Styles, Instant Render Registration, Typewriter Scroll Behavior, View Enhancements, Frontend (Svelte 5 + Tiptap), Instant Render (Typora-Style), Multi-Cursor Editing (Alt+Click) (+1 more)

### Community 38 - "Editing Extensions"
Cohesion: 0.22
Nodes (9): Auto-Close Brackets/Quotes, Editing Enhancements, Search Highlight Extension, Select Same Word, #Tag Syntax Support, Undo Tree Management, [[Wikilink]] Syntax Support, SearchBar.svelte (~6KB) (+1 more)

### Community 39 - "File Watcher"
Cohesion: 0.31
Nodes (3): FileChangeEvent, FileWatcher, WatcherHandle

### Community 40 - "Quick Insert"
Cohesion: 0.32
Nodes (4): QuickInsertExtension, QuickInsertItem, quickInsertItems, searchQuickInsert()

### Community 41 - "App Icons & Branding"
Cohesion: 0.32
Nodes (8): MarkPure Application Favicon / App Icon, Bluesky Icon Symbol, Discord Icon Symbol, Documentation Icon Symbol, GitHub Icon Symbol, Social/User Icon Symbol, Social and Documentation Icon Sprite, X (Twitter) Icon Symbol

### Community 42 - "Keymap System"
Cohesion: 0.50
Nodes (7): default_keybindings(), KeyBinding, keybindings_path(), load_keybindings(), reset_keybindings(), save_keybindings(), update_keybinding()

### Community 43 - "PDF Export"
Cohesion: 0.46
Nodes (7): add_page(), create_document(), export_pdf(), get_font_paths(), strip_markdown(), test_font_paths_exist(), wrap_text()

### Community 44 - "Tab State Persistence"
Cohesion: 0.36
Nodes (4): load_tabs(), save_tabs(), TabState, WindowTabs

### Community 45 - "Community 45"
Cohesion: 0.33
Nodes (7): Outline (ProseMirror Heading Extraction), OutlinePanel (Outline Panel Wrapper), SearchBar (Search/Replace Bar), SourceEditor (CodeMirror 6 Source Mode), Workspace Components, WorkSpace (File Tree Browser), WorkspaceSearch (Full-Text Search + i18n)

### Community 46 - "Community 46"
Cohesion: 0.29
Nodes (3): DropHandlerExtension, DropHandlerOptions, dropHandlerPluginKey

### Community 47 - "Community 47"
Cohesion: 0.29
Nodes (7): devDependencies, svelte-check, @sveltejs/vite-plugin-svelte, @tsconfig/svelte, @types/node, typescript, vite

### Community 48 - "Community 48"
Cohesion: 0.57
Nodes (5): get_file_preview(), get_search_preview(), read_file_content(), SearchPreview, test_preview_structure()

### Community 49 - "Community 49"
Cohesion: 0.33
Nodes (6): Svelte Components, ContextMenu (Right-Click Menu), Dialog (Modal Confirm/Input), EmptyState (Welcome Page), UI Components, WorkSpace.svelte (~10KB)

### Community 50 - "Community 50"
Cohesion: 0.40
Nodes (6): ColorPicker (Theme Color Editing), CSS Variables (Theme System), Settings Panel, Settings (General/Appearance/Shortcuts/About), ThemeEditor (Custom Theme Editing), ThemeEditor.svelte (~22KB)

### Community 51 - "Community 51"
Cohesion: 0.33
Nodes (4): AutoCloseExtension, AutoClosePair, MD_BLOCK_PAIRS, PAIRS

### Community 52 - "Community 52"
Cohesion: 0.33
Nodes (5): Commands, UndoTreeExtension, UndoTreeOptions, undoTreePluginKey, UndoTreeState

### Community 53 - "Community 53"
Cohesion: 0.40
Nodes (3): Commands, TagExtension, TagOptions

### Community 54 - "Community 54"
Cohesion: 0.40
Nodes (4): Commands, TypewriterScrollExtension, TypewriterScrollOptions, typewriterScrollPluginKey

### Community 56 - "Community 56"
Cohesion: 0.40
Nodes (5): Leaf-level function indexing rules (pub API only, <=10 entries), Three-tier AGENTS.md hierarchy (root -> navigation -> leaf), Trigger conditions for AGENTS.md updates, Upward chain propagation after changes, agents-md-guardian skill

### Community 57 - "Community 57"
Cohesion: 0.60
Nodes (4): FileEntry, is_markdown_file(), walk_dir_sync(), walk_directory()

### Community 58 - "Community 58"
Cohesion: 0.83
Nodes (3): app_config_dir(), config_dir(), home_dir()

### Community 59 - "Community 59"
Cohesion: 0.67
Nodes (4): MarkPure App Icon Set (16x16 to 1024x1024), Rounded square shape with softly curved corners, Light blue gradient background (deeper blue top to pale white-blue bottom), Stylized minimalist letter M composed of horizontal white lines and dots

### Community 60 - "Community 60"
Cohesion: 1.00
Nodes (3): MarkPure Hero / Marketing Screenshot, Svelte Logo SVG, Vite Logo SVG

## Knowledge Gaps
- **307 isolated node(s):** `tsBuildInfoFile`, `target`, `lib`, `module`, `types` (+302 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **25 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `NPM Dependencies` to `NPM Scripts`, `Community 70`, `Community 71`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Why does `lucide-svelte` connect `Community 71` to `NPM Dependencies`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **Why does `devDependencies` connect `Community 47` to `Svelte UI Components`, `NPM Scripts`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **What connects `tsBuildInfoFile`, `target`, `lib` to the rest of the system?**
  _307 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `IPC Command Handlers` be split into smaller, more focused modules?**
  _Cohesion score 0.06875 - nodes in this community are weakly interconnected._
- **Should `Svelte UI Components` be split into smaller, more focused modules?**
  _Cohesion score 0.04875886524822695 - nodes in this community are weakly interconnected._
- **Should `Project Documentation` be split into smaller, more focused modules?**
  _Cohesion score 0.052525252525252523 - nodes in this community are weakly interconnected._