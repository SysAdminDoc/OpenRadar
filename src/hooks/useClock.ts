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
