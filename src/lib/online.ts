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
