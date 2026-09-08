/**
 * What the reader has asked their system for, read at the moment it matters.
 *
 * Read rather than held in state, because the picture is drawn natively and
 * the request carries the answer: what matters is what was true when the
 * sweep was asked for. The native side has no view of a media query, which is
 * why these travel as arguments.
 *
 * A leaf in `lib/` rather than a hook, because two modules under `lib/` want
 * the answer and reaching up into `hooks/` for it inverts the layering: a
 * library that depends on the hooks above it cannot be read, tested or moved
 * without them. `useClock.ts` still exports these names for its own callers
 * and takes them from here.
 */
const MORE_CONTRAST = "(prefers-contrast: more)";
const LESS_MOTION = "(prefers-reduced-motion: reduce)";

/** Whether a media query holds, and false wherever nothing can answer. */
function asked(query: string): boolean {
  // A preference nobody can answer is not a preference, and it is certainly
  // not a reason to fail. This is read on the way into fetching a radar
  // sweep, and an environment without the media query, which includes a plain
  // jsdom, would otherwise take the whole picture down over a question about
  // colour.
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia !== "function") return false;
  return window.matchMedia(query).matches;
}

/** Whether the reader has asked their system for more contrast. */
export function highContrastRequested(): boolean {
  return asked(MORE_CONTRAST);
}

/** Whether the reader has asked their system for less movement. */
export function reducedMotionRequested(): boolean {
  return asked(LESS_MOTION);
}
