/**
 * Stateless helpers shared across App.svelte handlers.
 *
 * Topic: small string/path utilities that the various
 * handlers need. Pulled out so App.svelte doesn't have to
 * carry a couple of dozen lines of pure-function noise.
 */

/** Extract a friendly page name from a file path.
 *
 *  Examples:
 *    "/Users/x/notes/welcome.md"  → "welcome"
 *    "/Users/x/notes/welcome"     → "welcome"
 *    null                          → fallback ("Untitled")
 *    ""                            → fallback ("Untitled")
 */
export function pageNameFromPath(
  path: string | null,
  fallback: string,
): string {
  if (!path) return fallback
  const base = path.split('/').pop() ?? path
  return base.replace(/\.(md|markdown|mdx|txt)$/i, '') || fallback
}
