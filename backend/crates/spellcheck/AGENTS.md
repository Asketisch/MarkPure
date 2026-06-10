# AGENTS.md — spellcheck/ 拼写检查

## 目录

| 文件 | 说明 |
|------|------|
| `lib.rs` | check_spelling 路由分发（English fallback / 平台自检） |
| `types.rs` | SpellError / SpellCheckResult / Language enum |
| `english.rs` | 内置英文字典 + Levenshtein 建议生成 |
| `macos.rs` | NSSpellChecker 主线程桥接（仅 macOS，支持 CJK） |
| `dict_en.txt` | 内置英文词典（~1.8K 词，编译期嵌入） |
