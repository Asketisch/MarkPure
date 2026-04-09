use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocaleConfig {
    pub current: String,
}

impl Default for LocaleConfig {
    fn default() -> Self {
        Self {
            current: "en".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranslationEntry {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Locale {
    pub code: String,
    pub name: String,
    pub translations: HashMap<String, String>,
}

impl Locale {
    pub fn new(code: &str, name: &str) -> Self {
        Self {
            code: code.to_string(),
            name: name.to_string(),
            translations: HashMap::new(),
        }
    }

    pub fn with_translations(mut self, translations: Vec<(&str, &str)>) -> Self {
        for (k, v) in translations {
            self.translations.insert(k.to_string(), v.to_string());
        }
        self
    }
}

pub fn get_all_locales() -> Vec<Locale> {
    vec![
        Locale::new("en", "English")
            .with_translations(vec![
                ("app.name", "MarkPure"),
                ("app.description", "A WYSIWYG Markdown Editor"),
                ("menu.file", "File"),
                ("menu.edit", "Edit"),
                ("menu.view", "View"),
                ("menu.workspace", "Workspace"),
                ("menu.export", "Export"),
                ("menu.export_html", "Export HTML"),
                ("menu.export_pdf", "Export PDF"),
                ("menu.export_word", "Export Word"),
                ("menu.search", "Search"),
                ("menu.settings", "Settings"),
                ("action.new_tab", "New Tab"),
                ("action.open", "Open"),
                ("action.save", "Save"),
                ("action.close", "Close"),
                ("action.cancel", "Cancel"),
                ("action.confirm", "Confirm"),
                ("action.delete", "Delete"),
                ("action.rename", "Rename"),
                ("action.search", "Search"),
                ("action.add", "Add"),
                ("action.edit", "Edit"),
                ("action.ok", "OK"),
                ("sidebar.files", "Files"),
                ("sidebar.outline", "Outline"),
                ("sidebar.bookmarks", "Bookmarks"),
                ("sidebar.settings", "Settings"),
                ("sidebar.expand", "Expand"),
                ("sidebar.collapse", "Collapse"),
                ("sidebar.toggle", "Toggle Sidebar"),
                ("search.placeholder", "Search files..."),
                ("search.no_results", "No results"),
                ("search.matches", "matches"),
                ("search.in_files", "in"),
                ("search.files", "files"),
                ("search.workspace_title", "Search in Workspace"),
                ("search.find_in_file", "Find in File"),
                ("search.match_case", "Match Case"),
                ("search.whole_word", "Whole Word"),
                ("search.regex", "Regex"),
                ("settings.general", "General"),
                ("settings.appearance", "Appearance"),
                ("settings.shortcuts", "Keyboard Shortcuts"),
                ("settings.about", "About"),
                ("settings.theme", "Theme"),
                ("settings.language", "Language"),
                ("settings.font_family", "Font Family"),
                ("settings.font_size", "Font Size"),
                ("settings.tab_size", "Tab Size"),
                ("settings.soft_tabs", "Soft Tabs"),
                ("settings.line_numbers", "Line Numbers"),
                ("settings.word_wrap", "Word Wrap"),
                ("settings.builtin_theme", "Built-in Theme"),
                ("settings.custom_themes", "Custom Themes"),
                ("settings.import_theme", "Import Theme"),
                ("settings.reset_to_default", "Reset to Default"),
                ("settings.press_keys", "Press keys..."),
                ("settings.loading", "Loading..."),
                ("status.lines", "lines"),
                ("status.words", "words"),
                ("status.chars", "chars"),
                ("status.saving", "Saving..."),
                ("tab.untitled", "Untitled"),
                ("tab.close_others", "Close Others"),
                ("tab.close_to_right", "Close to the Right"),
                ("tab.close_all", "Close All"),
                ("bookmarks.add", "Add Bookmark"),
                ("bookmarks.file_path", "File path"),
                ("bookmarks.title", "Title"),
                ("bookmarks.tags_placeholder", "Tags (comma separated)"),
                ("bookmarks.all", "All"),
                ("bookmarks.no_bookmarks", "No bookmarks"),
                ("bookmarks.edit_tags", "Edit Tags"),
                ("empty.welcome", "Welcome to MarkPure"),
                ("empty.open_folder", "Open Folder"),
                ("empty.open_file", "Open File"),
                ("dialog.new_file", "New File"),
                ("dialog.open_file", "Open File"),
                ("dialog.save_file", "Save File"),
                ("dialog.delete_confirm", "Are you sure you want to delete this file?"),
                ("dialog.ok", "OK"),
            ]),
        Locale::new("zh-CN", "简体中文")
            .with_translations(vec![
                ("app.name", "MarkPure"),
                ("app.description", "所见即所得 Markdown 编辑器"),
                ("menu.file", "文件"),
                ("menu.edit", "编辑"),
                ("menu.view", "视图"),
                ("menu.workspace", "工作区"),
                ("menu.export", "导出"),
                ("menu.export_html", "导出 HTML"),
                ("menu.export_pdf", "导出 PDF"),
                ("menu.export_word", "导出 Word"),
                ("menu.search", "搜索"),
                ("menu.settings", "设置"),
                ("action.new_tab", "新建标签"),
                ("action.open", "打开"),
                ("action.save", "保存"),
                ("action.close", "关闭"),
                ("action.cancel", "取消"),
                ("action.confirm", "确认"),
                ("action.delete", "删除"),
                ("action.rename", "重命名"),
                ("action.search", "搜索"),
                ("action.add", "添加"),
                ("action.edit", "编辑"),
                ("action.ok", "确定"),
                ("sidebar.files", "文件"),
                ("sidebar.outline", "大纲"),
                ("sidebar.bookmarks", "书签"),
                ("sidebar.settings", "设置"),
                ("sidebar.expand", "展开"),
                ("sidebar.collapse", "收起"),
                ("sidebar.toggle", "切换侧边栏"),
                ("search.placeholder", "搜索文件..."),
                ("search.no_results", "无结果"),
                ("search.matches", "个匹配"),
                ("search.in_files", "在"),
                ("search.files", "个文件中"),
                ("search.workspace_title", "在工作区中搜索"),
                ("search.find_in_file", "在文件中查找"),
                ("search.match_case", "区分大小写"),
                ("search.whole_word", "全词匹配"),
                ("search.regex", "正则表达式"),
                ("settings.general", "通用"),
                ("settings.appearance", "外观"),
                ("settings.shortcuts", "键盘快捷键"),
                ("settings.about", "关于"),
                ("settings.theme", "主题"),
                ("settings.language", "语言"),
                ("settings.font_family", "字体"),
                ("settings.font_size", "字体大小"),
                ("settings.tab_size", "Tab 宽度"),
                ("settings.soft_tabs", "空格替代 Tab"),
                ("settings.line_numbers", "行号"),
                ("settings.word_wrap", "自动换行"),
                ("settings.builtin_theme", "内置主题"),
                ("settings.custom_themes", "自定义主题"),
                ("settings.import_theme", "导入主题"),
                ("settings.reset_to_default", "恢复默认"),
                ("settings.press_keys", "按下快捷键..."),
                ("settings.loading", "加载中..."),
                ("status.lines", "行"),
                ("status.words", "词"),
                ("status.chars", "字符"),
                ("status.saving", "保存中..."),
                ("tab.untitled", "未命名"),
                ("tab.close_others", "关闭其他"),
                ("tab.close_to_right", "关闭右侧"),
                ("tab.close_all", "关闭全部"),
                ("bookmarks.add", "添加书签"),
                ("bookmarks.file_path", "文件路径"),
                ("bookmarks.title", "标题"),
                ("bookmarks.tags_placeholder", "标签（逗号分隔）"),
                ("bookmarks.all", "全部"),
                ("bookmarks.no_bookmarks", "暂无书签"),
                ("bookmarks.edit_tags", "编辑标签"),
                ("empty.welcome", "欢迎使用 MarkPure"),
                ("empty.open_folder", "打开文件夹"),
                ("empty.open_file", "打开文件"),
                ("dialog.new_file", "新建文件"),
                ("dialog.open_file", "打开文件"),
                ("dialog.save_file", "保存文件"),
                ("dialog.delete_confirm", "确定要删除此文件吗？"),
                ("dialog.ok", "确定"),
            ]),
        Locale::new("ja", "日本語")
            .with_translations(vec![
                ("app.name", "MarkPure"),
                ("app.description", "WYSIWYG Markdown エディター"),
                ("menu.file", "ファイル"),
                ("menu.edit", "編集"),
                ("menu.view", "表示"),
                ("menu.workspace", "ワークスペース"),
                ("menu.export", "エクスポート"),
                ("menu.export_html", "HTML エクスポート"),
                ("menu.export_pdf", "PDF エクスポート"),
                ("menu.export_word", "Word エクスポート"),
                ("menu.search", "検索"),
                ("menu.settings", "設定"),
                ("action.new_tab", "新しいタブ"),
                ("action.open", "開く"),
                ("action.save", "保存"),
                ("action.close", "閉じる"),
                ("action.cancel", "キャンセル"),
                ("action.confirm", "確認"),
                ("action.delete", "削除"),
                ("action.rename", "名前変更"),
                ("action.search", "検索"),
                ("action.add", "追加"),
                ("action.edit", "編集"),
                ("action.ok", "OK"),
                ("sidebar.files", "ファイル"),
                ("sidebar.outline", "アウトライン"),
                ("sidebar.bookmarks", "ブックマーク"),
                ("sidebar.settings", "設定"),
                ("sidebar.expand", "展開"),
                ("sidebar.collapse", "折りたたむ"),
                ("sidebar.toggle", "サイドバー切替"),
                ("search.placeholder", "ファイルを検索..."),
                ("search.no_results", "結果なし"),
                ("search.matches", "件の一致"),
                ("search.in_files", "ファイル"),
                ("search.files", "ファイル"),
                ("search.workspace_title", "ワークスペース内を検索"),
                ("search.find_in_file", "ファイル内検索"),
                ("search.match_case", "大文字小文字を区別"),
                ("search.whole_word", "単語全体"),
                ("search.regex", "正規表現"),
                ("settings.general", "一般"),
                ("settings.appearance", "外観"),
                ("settings.shortcuts", "キーボードショートカット"),
                ("settings.about", "バージョン情報"),
                ("settings.theme", "テーマ"),
                ("settings.language", "言語"),
                ("settings.font_family", "フォント"),
                ("settings.font_size", "フォントサイズ"),
                ("settings.tab_size", "タブサイズ"),
                ("settings.soft_tabs", "ソフトタブ"),
                ("settings.line_numbers", "行番号"),
                ("settings.word_wrap", "折り返し"),
                ("settings.builtin_theme", "内蔵テーマ"),
                ("settings.custom_themes", "カスタムテーマ"),
                ("settings.import_theme", "テーマをインポート"),
                ("settings.reset_to_default", "デフォルトに戻す"),
                ("settings.press_keys", "キーを押してください..."),
                ("settings.loading", "読み込み中..."),
                ("status.lines", "行"),
                ("status.words", "語"),
                ("status.chars", "文字"),
                ("status.saving", "保存中..."),
                ("tab.untitled", "無題"),
                ("tab.close_others", "他を閉じる"),
                ("tab.close_to_right", "右側を閉じる"),
                ("tab.close_all", "すべて閉じる"),
                ("bookmarks.add", "ブックマークを追加"),
                ("bookmarks.file_path", "ファイルパス"),
                ("bookmarks.title", "タイトル"),
                ("bookmarks.tags_placeholder", "タグ（カンマ区切り）"),
                ("bookmarks.all", "すべて"),
                ("bookmarks.no_bookmarks", "ブックマークなし"),
                ("bookmarks.edit_tags", "タグを編集"),
                ("empty.welcome", "MarkPure へようこそ"),
                ("empty.open_folder", "フォルダーを開く"),
                ("empty.open_file", "ファイルを開く"),
                ("dialog.new_file", "新規ファイル"),
                ("dialog.open_file", "ファイルを開く"),
                ("dialog.save_file", "ファイルを保存"),
                ("dialog.delete_confirm", "このファイルを削除してもよろしいですか？"),
                ("dialog.ok", "OK"),
            ]),
    ]
}

/// Get available locale codes and names
pub fn get_locale_codes() -> Vec<(String, String)> {
    get_all_locales()
        .into_iter()
        .map(|l| (l.code, l.name))
        .collect()
}

/// Get translations for a specific locale
pub fn get_translations(locale: &str) -> HashMap<String, String> {
    get_all_locales()
        .into_iter()
        .find(|l| l.code == locale)
        .map(|l| l.translations)
        .unwrap_or_else(|| {
            // Fallback to English
            get_all_locales()
                .into_iter()
                .find(|l| l.code == "en")
                .map(|l| l.translations)
                .unwrap_or_default()
        })
}
