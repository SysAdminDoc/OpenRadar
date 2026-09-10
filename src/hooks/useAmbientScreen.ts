import { log } from "../lib/log";
import { useDisplayAwake } from "./useDisplayAwake";

/**
 * Whether the full-screen view is on, and the screen held awake while it is.
 */
export interface AmbientScreenOptions {
  /** Whether the reader asked for it outright. */
  asked: boolean;
  /** Minutes of nobody there before it comes on by itself, or nought. */
  idleMinutes: number;
  /** How long since anybody touched anything. */
  idleMs: number;
  alertActive: boolean;
  displayAwake: boolean;
}

export function useAmbientScreen({
  asked,
  idleMinutes,
  idleMs,
  alertActive,
  displayAwake,
}: AmbientScreenOptions): boolean {
  /**
   * Whether the full-screen view is actually on, worked out rather than kept.
   *
   * Three things decide it and all three are already known during a render:
   * whether the reader asked for it, whether they have been away long enough
   * to have asked for it by default, and whether a warning is standing at a
   * place they watch. Writing it into state from an effect would cascade a
   * render for each of them, and the warning case would then have to be
   * undone by hand when the warning cleared.
   *
   * A warning takes it down and puts the workspace back, because the whole
   * point of the app is the thing that just happened, and a second monitor
   * showing a clean loop through it is the app hiding its own reason to
   * exist. It comes back when the warning does not stand any more.
   */
  const ambientScreen =
    (asked || (idleMinutes > 0 && idleMs >= idleMinutes * 60_000)) &&
    !alertActive;

  // The screen kept on while that view is showing, if the reader asked for
  // it. Logged and left alone when the system refuses: a screen that sleeps
  // anyway is a disappointment rather than a fault, and a toast over a view
  // somebody walked away from helps nobody.
  useDisplayAwake({
    wanted: displayAwake,
    showing: ambientScreen,
    onFailure: (failure) =>
      log.warn(
        "display",
        failure instanceof Error ? failure.message : "The hold was refused.",
      ),
  });
  return ambientScreen;
}
