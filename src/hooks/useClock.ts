import { useSyncExternalStore } from "react";

const TICK_MS = 60_000;

let now = Date.now();
let timer: number | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    // A gap since the last subscriber leaves the cached value stale.
    now = Date.now();
    timer = window.setInterval(() => {
      now = Date.now();
      for (const each of listeners) each();
    }, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };
}

/**
 * Wall clock as a value that changes once a minute. Reading the clock during
 * render would make a component's output depend on when it happened to run.
 */
export function useMinuteClock(): number {
  return useSyncExternalStore(subscribe, () => now);
}

const SECOND_TICK_MS = 1_000;

let second = Date.now();
let secondTimer: number | null = null;
const secondListeners = new Set<() => void>();

function subscribeSecond(listener: () => void): () => void {
  secondListeners.add(listener);
  if (secondTimer === null) {
    second = Date.now();
    secondTimer = window.setInterval(() => {
      second = Date.now();
      for (const each of secondListeners) each();
    }, SECOND_TICK_MS);
  }
  return () => {
    secondListeners.delete(listener);
    if (!secondListeners.size && secondTimer !== null) {
      window.clearInterval(secondTimer);
      secondTimer = null;
    }
  };
}

/**
 * The same, ticking every second, for the one thing measured in seconds.
 *
 * The legend over a live sweep says how many seconds old the picture is, and a
 * piece of the volume arrives every eleven or twelve. Read off the minute
 * clock it said nought seconds for everything collected since the last tick,
 * and then jumped a minute at a time when the radar stalled, which is the
 * opposite of what the number is for.
 *
 * `wanted` is false everywhere else, and the timer is only running while
 * somebody is subscribed, so nothing re-renders every second for a picture
 * that changes every five minutes.
 */
export function useSecondClock(wanted: boolean): number {
  const at = useSyncExternalStore(wanted ? subscribeSecond : subscribe, () =>
    wanted ? second : now,
  );
  return at;
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** Read at the moment an animation starts, so a live preference change wins. */
export function reducedMotionRequested(): boolean {
  // Guarded for the same reason `highContrastRequested` is, and found the
  // same way: this is now read on the way into fetching a radar sweep, and an
  // environment with no media query at all, which includes a plain jsdom,
  // would otherwise take the whole picture down over a question about
  // animation. A preference nobody can answer is not a preference.
  if (typeof window.matchMedia !== "function") return false;
  return window.matchMedia(REDUCED_MOTION).matches;
}

/** MapLibre animation options that never override the reader's preference. */
export function cameraMotion(duration: number): {
  duration: number;
  essential: false;
} {
  return {
    duration: reducedMotionRequested() ? 0 : duration,
    essential: false,
  };
}

function subscribeMotion(listener: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

/**
 * Whether the viewer has asked for less movement. Read as a live value rather
 * than once at startup, because it can be changed while the app is open and a
 * layer that animates should stop when it is.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeMotion,
    reducedMotionRequested,
    () => false,
  );
}

const MORE_CONTRAST = "(prefers-contrast: more)";

/**
 * Whether the reader has asked their system for more contrast.
 *
 * Read at the moment a sweep is requested rather than held in state, for the
 * same reason the motion preference is: the picture is drawn natively and the
 * request carries the answer, so what matters is what was true when it was
 * asked. The native side has no view of a media query, which is why this
 * travels as an argument.
 */
export function highContrastRequested(): boolean {
  // A preference nobody can answer is not a preference for more contrast, and
  // it is certainly not a reason to fail. This is read on the way into
  // fetching a radar sweep, and an environment without the media query, which
  // includes a plain jsdom, would otherwise take the whole picture down over a
  // question about colour.
  if (typeof window.matchMedia !== "function") return false;
  return window.matchMedia(MORE_CONTRAST).matches;
}

function subscribeContrast(listener: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(MORE_CONTRAST);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

const FORCED_COLOURS = "(forced-colors: active)";

/**
 * Whether the system has taken the colours over.
 *
 * A Windows contrast theme is not the same request as "more contrast": the
 * system repaints every background, border and text in its own small palette
 * and there is nothing to negotiate. The workspace's own light and dark are
 * not drawn while it is on, so offering the choice would be offering a button
 * that does nothing.
 */
function forcedColoursActive(): boolean {
  // The same guard as the contrast query above, and for the same reason: a
  // plain jsdom has no `matchMedia`, and a question about colour must never
  // be able to take a panel down.
  if (typeof window.matchMedia !== "function") return false;
  return window.matchMedia(FORCED_COLOURS).matches;
}

function subscribeForcedColours(listener: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(FORCED_COLOURS);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

/** The same answer as a value a render can follow. */
export function useForcedColours(): boolean {
  return useSyncExternalStore(
    subscribeForcedColours,
    forcedColoursActive,
    () => false,
  );
}

/**
 * The same preference as a value a render can follow.
 *
 * Some of this is not a picture that was already drawn: a tile address, a
 * legend, the width a warning outline is stroked at. Those have to change when
 * the reader changes their mind rather than at the next fetch, so they read the
 * preference through here and re-render on it.
 */
export function useHighContrast(): boolean {
  return useSyncExternalStore(
    subscribeContrast,
    highContrastRequested,
    () => false,
  );
}
