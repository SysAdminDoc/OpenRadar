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
 * When the workspace last failed to reach anything, or null while it can.
 *
 * Two different questions, and this is the second one.
 *
 * `isOnline` above answers whether the machine believes it has a network,
 * which is the right question for "should anything bother asking". This
 * answers whether anything has actually come back, which is the right
 * question for "tell the reader what they are looking at". A laptop on a
 * captive portal answers yes to the first and no to the second, and the file
 * header has said so since it was written: clearing the line on the browser's
 * `online` event put the workspace straight back into polling and failing
 * with a reader who had just been told everything was fine.
 *
 * So: the moment is recorded when the machine says the network went, or when
 * a workspace opens with none. It is cleared by a fetch coming back, and by
 * nothing else.
 *
 * Held in the module rather than in a component because more than one surface
 * says it and they have to agree: a chrome line reading one time and a health
 * line another is worse than neither.
 */
let wentOffline: number | null = null;
const changed = new Set<Listener>();

function announce() {
  for (const listener of changed) listener();
}

function noteChange() {
  // Going offline is a fact the machine is sure of. Coming back is only a
  // claim, and it is settled by `noteReached` when something answers.
  if (isOnline()) return;
  if (wentOffline !== null) return;
  wentOffline = Date.now();
  announce();
}

/**
 * Something came back. Called from wherever a fetch succeeds.
 *
 * This is the one thing that clears the line, because it is the one thing
 * that proves the workspace can see. Cheap enough to call on every success:
 * it does nothing at all unless there is something to clear.
 */
export function noteReached(): void {
  if (wentOffline === null) return;
  wentOffline = null;
  announce();
}

// Watched from the moment the module loads rather than lazily from the
// getter. `useSyncExternalStore` calls the getter while rendering, and a
// getter that registers window listeners and writes module state is a side
// effect in a render.
if (typeof window !== "undefined") {
  wentOffline = isOnline() ? null : Date.now();
  window.addEventListener("online", noteChange);
  window.addEventListener("offline", noteChange);
}

/** Subscribes to the moment, which is the thing surfaces read. */
export function subscribeOffline(listener: Listener): () => void {
  changed.add(listener);
  return () => {
    changed.delete(listener);
  };
}

/** The moment, as a value a render can follow. Null while it can see. */
export function offlineSince(): number | null {
  return wentOffline;
}

/** Server rendering is never offline. */
export function offlineSinceOnServer(): number | null {
  return null;
}

/**
 * For tests, which cannot make a real network come and go.
 *
 * The module remembers a moment for the life of a session on purpose, which
 * is exactly what makes it awkward to exercise twice in one process.
 */
export function forgetOfflineForTests(): void {
  wentOffline = isOnline() ? null : Date.now();
  changed.clear();
}
