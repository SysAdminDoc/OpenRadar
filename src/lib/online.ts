/**
 * Whether the machine has a network, as far as the webview can tell.
 *
 * This is a hint rather than a fact: a laptop joined to a captive portal reads
 * as online and can reach nothing. It is still worth having, because when it
 * says offline it is right, and that is the case where the map is showing
 * yesterday's weather and has to say so.
 */

type Listener = () => void;

export function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine !== false;
}

/** Server rendering has no navigator, and no network state to report. */
export function isOnlineOnServer(): boolean {
  return true;
}

export function subscribeOnline(listener: Listener): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

/**
 * When the machine went offline, or null while it is on.
 *
 * The event says the state changed and nothing else, so the moment is
 * recorded the first time it is seen. Held in the module rather than in a
 * component because more than one surface says it and they have to agree: a
 * chrome line reading one time and a health line another is worse than
 * neither.
 *
 * A workspace that starts with no network has no event to hear, so the moment
 * is the moment it started looking. "Since you opened this" is honest and
 * "since never" is not.
 */
let wentOffline: number | null = null;
const changed = new Set<Listener>();

function noteChange() {
  const now = isOnline();
  wentOffline = now ? null : (wentOffline ?? Date.now());
  for (const listener of changed) listener();
}

function watchOnce() {
  if (typeof window === "undefined") return;
  if (started) return;
  started = true;
  wentOffline = isOnline() ? null : Date.now();
  window.addEventListener("online", noteChange);
  window.addEventListener("offline", noteChange);
}
let started = false;

/** Subscribes to the state AND to the moment, which change together. */
export function subscribeOffline(listener: Listener): () => void {
  watchOnce();
  changed.add(listener);
  return () => {
    changed.delete(listener);
  };
}

/** The moment, as a value a render can follow. Null while the network is on. */
export function offlineSince(): number | null {
  watchOnce();
  return wentOffline;
}

/** Server rendering is never offline. */
export function offlineSinceOnServer(): number | null {
  return null;
}

/**
 * For tests, which cannot make a real network come and go.
 *
 * The module remembers a moment across a whole session on purpose, which is
 * exactly what makes it awkward to test twice in one process.
 */
export function forgetOfflineForTests(): void {
  started = false;
  wentOffline = null;
  changed.clear();
  if (typeof window !== "undefined") {
    window.removeEventListener("online", noteChange);
    window.removeEventListener("offline", noteChange);
  }
}
