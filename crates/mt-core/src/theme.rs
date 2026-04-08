use serde::{Deserialize, Serialize};

/// Available theme IDs
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ThemeId {
    Light,
    Dark,
    OneDark,
    Graphite,
    Ulysses,
    MaterialDark,
}

impl ThemeId {
    pub fn label(&self) -> &str {
        match self {
            ThemeId::Light => "Cadmium Light",
            ThemeId::Dark => "Dark",
            ThemeId::OneDark => "One Dark",
            ThemeId::Graphite => "Graphite",
            ThemeId::Ulysses => "Ulysses",
            ThemeId::MaterialDark => "Material Dark",
        }
    }

    pub fn is_dark(&self) -> bool {
        matches!(
            self,
            ThemeId::Dark | ThemeId::OneDark | ThemeId::Graphite | ThemeId::MaterialDark
        )
    }

    /// All available themes
    pub fn all() -> &'static [ThemeId] {
        &[
            ThemeId::Light,
            ThemeId::Dark,
            ThemeId::OneDark,
            ThemeId::Graphite,
            ThemeId::Ulysses,
            ThemeId::MaterialDark,
        ]
    }

    /// Cycle to the next theme
    pub fn cycle(&self) -> Self {
        let all = Self::all();
        let idx = all.iter().position(|t| *t == *self).unwrap_or(0);
        all[(idx + 1) % all.len()]
    }
}

impl std::fmt::Display for ThemeId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.label())
    }
}
