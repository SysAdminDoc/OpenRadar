/**
 * One desktop notification, and the checks that have to sit around it.
 *
 * Three watches raise these: a warning at a watched place, a storm heading
 * for one, and lightning falling near one. All three had their own copy of
 * this, identical but for the two strings, which meant a change to the
 * permission flow was a change in three places. The Windows application
 * identifier problem recorded in the blocked notes is exactly that kind of
 * change.
 *
 * The awaits are what make it worth writing down rather than inlining. The
 * plugin is imported on demand, the permission may be asked for, and either
 * can outlive the component: `isMounted` is checked between every one of
 * them, and it must answer for a real unmount rather than for a run of the
 * effect, or a notice recorded as delivered is abandoned halfway through a
 * permission prompt and never said again.
 */
/**
 * What Windows has said about notifications, as far as this run can tell.
 *
 * All three are readable without prompting. `Notification.permission` is a
 * tri-state and the plugin reads it before it asks the native side at all, so
 * a refusal standing from a previous run is visible on a cold start. The
 * remembered answer is only needed for the case that tri-state calls
 * `default` while the native side still says no.
 */
import { locale } from "../i18n";

export type NotifyPermission = "granted" | "refused" | "unasked";

let lastAnswer: NotifyPermission = "unasked";

/**
 * The permission, read rather than remembered where that is possible.
 *
 * A watch that never raised a notice leaves nothing to remember, and a
 * reader whose warning did not arrive is asking about this run. Reading
 * `isPermissionGranted` costs one call and does not prompt; the remembered
 * refusal is what distinguishes "Windows said no" from "nobody has asked".
 */
export async function notificationPermission(): Promise<NotifyPermission> {
  // The window's own answer first, because it is the one that survives a
  // relaunch: a reader who switched notifications off in Windows Settings
  // last week is refused before any watch has run, and reading only the
  // remembered answer would call that "nobody has asked".
  const said = globalThis.Notification?.permission;
  if (said === "denied") return "refused";
  if (said === "granted") return "granted";

  try {
    const { isPermissionGranted } =
      await import("@tauri-apps/plugin-notification");
    if (await isPermissionGranted()) return "granted";
  } catch {
    // No native side to ask, which is the browser preview.
    return lastAnswer;
  }
  // Not granted, and the window called it undecided. Any answer already on
  // record makes this a refusal rather than a question nobody has asked: a
  // grant that has since stopped being one is exactly what a reader whose
  // warning went missing is looking at.
  return lastAnswer === "unasked" ? "unasked" : "refused";
}

export async function announceOnDesktop(
  title: string,
  body: string,
  isMounted: () => boolean,
): Promise<boolean> {
  const { isPermissionGranted, requestPermission, sendNotification } =
    await import("@tauri-apps/plugin-notification");
  if (!isMounted()) return false;
  let granted = await isPermissionGranted();
  if (!isMounted()) return false;
  if (!granted) {
    granted = (await requestPermission()) === "granted";
    if (!isMounted()) return false;
  }
  // Remembered so the report and the watch settings can say which of the two
  // silences this is: a refusal, or a question nobody has asked yet.
  lastAnswer = granted ? "granted" : "refused";
  if (!granted) return false;
  sendNotification({ title, body });
  return true;
}

/**
 * What is waiting to be read aloud, newest sentence per place.
 *
 * A queue rather than a call. `speechSynthesis.speak` starts a second
 * utterance over the first, and three warnings landing in one poll would be
 * three voices reading three county names at once, which is worse than any
 * one of them alone.
 *
 * Keyed, and the key is the places the alert reached. A second warning for
 * the same place replaces the first while it is still waiting: somebody
 * whose watch has been upgraded to a warning wants the warning, not both in
 * the order they arrived.
 */
const waiting: Array<{ key: string; sentence: string }> = [];
let saying = false;

/**
 * Reads a sentence aloud, in the language the catalogue is in.
 *
 * Silent where there is no speech engine at all, which is a browser preview
 * with the API switched off and every test that has not asked for one.
 */
export function speak(sentence: string, key: string): void {
  if (!globalThis.speechSynthesis || !globalThis.SpeechSynthesisUtterance) {
    return;
  }
  const at = waiting.findIndex((one) => one.key === key);
  if (at === -1) waiting.push({ key, sentence });
  else waiting[at] = { key, sentence };
  sayNext();
}

function sayNext(): void {
  if (saying || !waiting.length) return;
  const engine = globalThis.speechSynthesis;
  // The voice list fills asynchronously and speaking before it has is
  // silent. WebView2 offers the machine's SAPI voices and nothing else:
  // Microsoft disabled its cloud Natural voices there by design, so this is
  // whatever Windows has installed and it may take a moment to say so.
  if (engine.getVoices().length === 0) {
    engine.addEventListener("voiceschanged", () => sayNext(), { once: true });
    return;
  }
  const next = waiting.shift();
  if (!next) return;
  const said = new globalThis.SpeechSynthesisUtterance(next.sentence);
  said.lang = locale();
  saying = true;
  // Both, because an engine that fails partway through leaves the queue
  // stopped otherwise and nothing is ever read again this run.
  const done = () => {
    saying = false;
    sayNext();
  };
  said.onend = done;
  said.onerror = done;
  engine.speak(said);
}
