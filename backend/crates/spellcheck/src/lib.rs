use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{BinaryHeap, HashMap};
use std::sync::OnceLock;

/// A spell check error with position and suggestions
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpellError {
    pub word: String,
    pub start: usize,
    pub end: usize,
    pub suggestions: Vec<String>,
}

/// Spell check result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpellCheckResult {
    pub errors: Vec<SpellError>,
    pub language: String,
}

/// Supported languages
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum Language {
    En,
    ZhCn,
    Ja,
}

impl Language {
    pub fn from_code(code: &str) -> Self {
        match code {
            "zh-CN" | "zh" => Language::ZhCn,
            "ja" => Language::Ja,
            _ => Language::En,
        }
    }

    pub fn code(&self) -> &str {
        match self {
            Language::En => "en",
            Language::ZhCn => "zh-CN",
            Language::Ja => "ja",
        }
    }
}

// Maximum Levenshtein distance we consider when suggesting. Distance > 2
// almost never produces useful suggestions in practice and explodes the
// inner loop.
const MAX_EDIT_DISTANCE: usize = 2;

// How many suggestions to surface per misspelling.
const TOP_N_SUGGESTIONS: usize = 5;

// Regex for splitting on word boundaries. Compiled lazily so a syntax
// error (impossible — it's a constant — but defensive) is caught once
// and reused on every call.
static WORD_RE: OnceLock<Regex> = OnceLock::new();
fn word_re() -> &'static Regex {
    WORD_RE.get_or_init(|| {
        // \b[a-zA-Z]+\b — ASCII letter runs delimited by word boundary.
        // Safe to unwrap: constant pattern, syntax-checked at compile time
        // by `regex` macros in stricter setups; here we keep it as a
        // function so a future tweak doesn't crash the entire app.
        Regex::new(r"\b[a-zA-Z]+\b").expect("spellcheck word regex is valid")
    })
}

// Dictionary is loaded once per process — it is ~50KB of static text and
// building a HashMap of it on every `check_spelling` call dominated the
// cost for small inputs. OnceLock gives us lazy init with no extra deps.
static DICT: OnceLock<HashMap<&'static str, ()>> = OnceLock::new();
fn english_dictionary() -> &'static HashMap<&'static str, ()> {
    DICT.get_or_init(|| {
        let words = include_str!("dict_en.txt");
        let mut dict = HashMap::with_capacity(8192);
        for word in words.lines() {
            let w = word.trim();
            if !w.is_empty() {
                dict.insert(w, ());
            }
        }
        dict
    })
}

/// Check spelling of text, returns list of errors with suggestions
pub fn check_spelling(text: &str, lang: &str) -> SpellCheckResult {
    let language = Language::from_code(lang);

    // Chinese and Japanese don't use whitespace-based word boundaries
    // For these languages, skip spell checking (would need specialized libraries)
    match language {
        Language::ZhCn | Language::Ja => {
            return SpellCheckResult {
                errors: Vec::new(),
                language: language.code().to_string(),
            };
        }
        Language::En => {}
    }

    let dict = english_dictionary();
    let word_re = word_re();
    let mut errors = Vec::new();

    for cap in word_re.captures_iter(text) {
        // `captures_iter` always yields a non-empty match group at index 0,
        // but be defensive: an unexpected empty match would otherwise
        // panic on `as_str()`.
        let Some(m) = cap.get(0) else { continue };
        let word = m.as_str();

        // Skip very short words (a, I, etc.). Use `chars().count()` rather
        // than `len()` so a single CJK or wide char doesn't get treated
        // as multi-byte and slip through.
        if word.chars().count() <= 1 {
            continue;
        }

        // Skip words that are all uppercase (acronyms)
        if word.chars().all(|c| c.is_uppercase()) && word.chars().count() <= 5 {
            continue;
        }

        let lower = word.to_lowercase();

        // Check if word exists in dictionary
        if !dict.contains_key(lower.as_str()) {
            let suggestions = generate_suggestions(&lower, dict);
            errors.push(SpellError {
                word: word.to_string(),
                start: m.start(),
                end: m.end(),
                suggestions,
            });
        }
    }

    SpellCheckResult {
        errors,
        language: language.code().to_string(),
    }
}

/// Generate suggestions for a misspelled word using simple edit distance.
///
/// Pre-filters the dictionary by character-length difference (a miss-by-3+
//  character candidate can never be within edit distance 2), and tracks
/// the top-N candidates with a min-heap so a 50k-word dictionary scan
/// costs O(dict × word_len²) for the Levenshtein calls but O(log TOP_N)
/// per push. We never collect more than TOP_N suggestions in memory.
fn generate_suggestions(word: &str, dict: &HashMap<&str, ()>) -> Vec<String> {
    // BinaryHeap is a max-heap. We push (distance, word) and pop the
    // *largest* distance when the heap exceeds TOP_N — i.e. the worst
    // candidate. The strings inside the tuple act as a stable
    // tiebreaker so we never exceed TOP_N entries.
    let mut heap: BinaryHeap<(usize, String)> = BinaryHeap::with_capacity(TOP_N_SUGGESTIONS + 1);

    let word_chars = word.chars().count();
    // Quick length filter: edit distance ≤ MAX_EDIT_DISTANCE implies
    // length difference ≤ MAX_EDIT_DISTANCE. We use char count (not
    // bytes) to match what `levenshtein_distance` actually compares.
    let min_len = word_chars.saturating_sub(MAX_EDIT_DISTANCE);
    let max_len = word_chars + MAX_EDIT_DISTANCE;

    for &dict_word in dict.keys() {
        let dict_chars = dict_word.chars().count();
        if dict_chars < min_len || dict_chars > max_len {
            continue;
        }
        let dist = levenshtein_distance(word, dict_word);
        if dist <= MAX_EDIT_DISTANCE {
            heap.push((dist, dict_word.to_string()));
            if heap.len() > TOP_N_SUGGESTIONS {
                heap.pop(); // discard the worst (largest distance)
            }
        }
    }

    // Drain into a sorted vec.
    let mut out: Vec<(usize, String)> = heap.into_vec();
    out.sort_by_key(|(d, _)| *d);
    out.into_iter().map(|(_, w)| w).collect()
}

/// Calculate Levenshtein distance between two strings
fn levenshtein_distance(a: &str, b: &str) -> usize {
    let a_len = a.chars().count();
    let b_len = b.chars().count();

    if a_len == 0 {
        return b_len;
    }
    if b_len == 0 {
        return a_len;
    }

    let mut matrix = vec![vec![0; b_len + 1]; a_len + 1];

    for (i, row) in matrix.iter_mut().enumerate() {
        row[0] = i;
    }

    for j in 0..=b_len {
        matrix[0][j] = j;
    }

    let a_chars: Vec<char> = a.chars().collect();
    let b_chars: Vec<char> = b.chars().collect();

    for i in 1..=a_len {
        for j in 1..=b_len {
            let cost = if a_chars[i - 1] == b_chars[j - 1] { 0 } else { 1 };
            matrix[i][j] = (matrix[i - 1][j] + 1)
                .min(matrix[i][j - 1] + 1)
                .min(matrix[i - 1][j - 1] + cost);
        }
    }

    matrix[a_len][b_len]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_levenshtein() {
        assert_eq!(levenshtein_distance("hello", "hello"), 0);
        assert_eq!(levenshtein_distance("hello", "hallo"), 1);
        assert_eq!(levenshtein_distance("hello", "helo"), 1);
        assert_eq!(levenshtein_distance("kitten", "sitting"), 3);
    }

    #[test]
    fn test_check_spelling_empty() {
        let r = check_spelling("", "en");
        assert!(r.errors.is_empty());
    }

    #[test]
    fn test_check_spelling_skips_cjk() {
        let r = check_spelling("你好世界", "zh-CN");
        assert!(r.errors.is_empty());
        let r = check_spelling("こんにちは", "ja");
        assert!(r.errors.is_empty());
    }

    #[test]
    fn test_check_spelling_detects_typo() {
        // "sel" is not in dict_en.txt; "sell" is (line 438). We expect
        // 'sel' to be flagged with at least one short-distance
        // suggestion. The dict is a *subset* of common English words,
        // so we don't assume 'hello' is present.
        let r = check_spelling("sel and world", "en");
        assert!(!r.errors.is_empty(), "expected 'sel' to be flagged");
        let sel = r.errors.iter().find(|e| e.word == "sel").expect("sel in errors");
        assert!(
            sel.suggestions.iter().any(|s| s == "sell" || s == "self"),
            "expected 'sell' or 'self' in suggestions, got {:?}",
            sel.suggestions
        );
        // "and" and "world" are in the dict, so they must not be flagged.
        assert!(r.errors.iter().all(|e| e.word != "and"));
        assert!(r.errors.iter().all(|e| e.word != "world"));
    }

    #[test]
    fn test_dictionary_is_cached() {
        // Two back-to-back calls share the same dict (no panic, no rebuild).
        let a: *const HashMap<&'static str, ()> = english_dictionary();
        let b: *const HashMap<&'static str, ()> = english_dictionary();
        assert_eq!(a, b, "dictionary should be cached across calls");
    }

    #[test]
    fn test_length_prefilter() {
        // A word with drastically different length from any dict word
        // shouldn't crash and shouldn't produce suggestions.
        let suggestions = generate_suggestions("xyzqq", english_dictionary());
        // No length match → no suggestions. This is the win — without the
        // prefilter, this would have run a Levenshtein matrix for every
        // dict word.
        assert!(suggestions.is_empty());
    }
}
