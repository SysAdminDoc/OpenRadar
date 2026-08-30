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

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

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
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}
