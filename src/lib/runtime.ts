/**
 * Which of the two places the app is running in.
 *
 * A leaf with nothing under it, because forty-odd modules ask this question
 * and almost none of them care about anything else in the settings file. While
 * it lived there, every one of those asks was an edge back into the module the
 * whole tree already depends on, and four of them closed a ring: `level2.ts`,
 * `cells.ts`, `log.ts` and `tileCache.ts` each imported `settings.ts` for this
 * one two-line function, and `settings.ts` reaches all four the long way round
 * through the watch rules and the overlay adapters. Twenty-four modules were
 * inside that ring, and whether it worked depended on the order the bundler
 * happened to evaluate them in.
 */

/** True inside the Tauri window, false in a browser preview. */
export function isDesktopRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
