/**
 * Slug helpers shared between the heading-id extension, the outline
 * panel, and the TOC node view.
 *
 * The GitHub-style slug is lowercased, with non-word characters
 * (including CJK characters) preserved, spaces collapsed to hyphens,
 * and capped at 60 characters. A position suffix disambiguates
 * duplicate titles — a heading's PM `pos` is unique within a document.
 */

/// Lowercase, strip non-word/non-CJK punctuation, collapse spaces
/// to hyphens, and cap the length. Returns a non-empty string or
/// the literal `"heading"` if the input is empty after normalisation.
export function slugifyBase(text: string): string {
  const base = text
    .toLowerCase()
    .replace(/[^\w一-鿿\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
  return base || 'heading'
}

/// Compose the final slug with a tie-breaking suffix. The suffix is
/// either a PM position (preferred) or a sequence number (when we
/// don't have positions, e.g. when assigning ids to multiple
/// headings that all happen to share the same title).
export function slugifyWithSuffix(text: string, suffix: number | string): string {
  return `${slugifyBase(text)}-${suffix}`
}
