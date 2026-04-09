use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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

// Built-in common English words dictionary (subset for basic spell checking)
fn english_dictionary() -> HashMap<&'static str, ()> {
    let words = include_str!("dict_en.txt");
    let mut dict = HashMap::new();
    for word in words.lines() {
        let w = word.trim();
        if !w.is_empty() {
            dict.insert(w, ());
        }
    }
    dict
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
    let word_re = Regex::new(r"\b[a-zA-Z]+\b").unwrap();
    let mut errors = Vec::new();

    for cap in word_re.captures_iter(text) {
        let m = cap.get(0).unwrap();
        let word = m.as_str();

        // Skip very short words (a, I, etc.) and single letters
        if word.len() <= 1 {
            continue;
        }

        // Skip words that are all uppercase (acronyms)
        if word.chars().all(|c| c.is_uppercase()) && word.len() <= 5 {
            continue;
        }

        let lower = word.to_lowercase();

        // Check if word exists in dictionary
        if !dict.contains_key(lower.as_str()) {
            let suggestions = generate_suggestions(&lower, &dict);
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

/// Generate suggestions for a misspelled word using simple edit distance
fn generate_suggestions(word: &str, dict: &HashMap<&str, ()>) -> Vec<String> {
    let mut candidates: Vec<(String, usize)> = Vec::new();

    for &dict_word in dict.keys() {
        let dist = levenshtein_distance(word, dict_word);
        if dist <= 2 {
            candidates.push((dict_word.to_string(), dist));
        }
    }

    // Sort by distance, take top 5
    candidates.sort_by_key(|(_, d)| *d);
    candidates.truncate(5);
    candidates.into_iter().map(|(w, _)| w).collect()
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
}
