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
import { log } from "./log";

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
 * The longest one sentence may hold the queue before it is given up on.
 *
 * `speechSynthesis` promises an `end` event and does not always deliver one:
 * Chromium drops it on an utterance it cut off, and WebView2 is Chromium.
 * Without a ceiling the first sentence that goes quiet stops every warning
 * after it for the life of the run, which is the failure this whole queue
 * exists to avoid, arrived at from the other side.
 */
const SPEAKING_CEILING_MS = 20_000;

/**
 * How old a sentence may be when its turn comes.
 *
 * A warning read out four minutes late is worse than one not read at all:
 * it is about a storm that has moved. The queue is short in practice, so
 * this only fires after the ceiling above has released a wedged engine.
 */
const STALE_MS = 60_000;

/**
 * What is waiting to be read aloud, in the order it arrived.
 *
 * A queue rather than a call. `speechSynthesis.speak` starts a second
 * utterance over the first, and three warnings landing in one poll would be
 * three voices reading three county names at once, which is worse than any
 * one of them alone.
 *
 * Nothing is dropped for being about the same place as something else. The
 * first shape of this replaced a waiting sentence with a newer one for the
 * same place, on the reasoning that an upgrade supersedes a watch; what it
 * actually did, given three warnings for one place in one poll, was read the
 * first and the third and silently lose the middle one, which the feed order
 * makes arbitrary and which was the tornado warning in the case that found
 * it. Age is the only thing that takes a sentence out of this queue.
 */
const waiting: Array<{ sentence: string; at: number }> = [];

/** When the sentence being read started, or null when nothing is being read. */
let saying: number | null = null;

/** One pending look at a wedged engine, so the check is not a loop. */
let lookAgain: ReturnType<typeof setTimeout> | null = null;

/**
 * Which sentence is the one being read, counted up.
 *
 * An utterance goes on raising events after it has stopped mattering: a cut
 * one raises `error`, and a refused one may raise either. Both handlers are
 * the same closure, and without this the late event clears the queue's hold
 * on a sentence that is already being read over.
 */
let reading = 0;

/** Whether a listener is already waiting for the voice list to fill. */
let waitingForVoices = false;

/**
 * Reads a sentence aloud, in the language the catalogue is in.
 *
 * Silent where there is no speech engine at all, which is a browser preview
 * with the API switched off and every test that has not asked for one.
 *
 * Total on purpose. It is called from the watch's own loop, between the tone
 * and the notification, and a throw from here would take the announcement,
 * the record and the rest of the batch with it: an addition that suppresses
 * the thing it was added to. Whatever the engine does, this returns.
 */
export function speak(sentence: string): void {
  try {
    if (!globalThis.speechSynthesis || !globalThis.SpeechSynthesisUtterance) {
      return;
    }
    waiting.push({ sentence, at: Date.now() });
    sayNext();
  } catch (failure) {
    log.warn(
      "watch",
      failure instanceof Error ? failure.message : "The voice refused.",
    );
  }
}

function sayNext(): void {
  const engine = globalThis.speechSynthesis;
  if (!engine) return;
  const now = Date.now();
  if (saying !== null) {
    const held = now - saying;
    // The sentence being read has its own ceiling armed against it, so there
    // is nothing to arm here and nothing to wait for.
    if (held < SPEAKING_CEILING_MS) return;
    // `cancel` fires `error` on the utterance it cuts, and that utterance's
    // handler is the `done` below. Left to run it would clear `saying` after
    // the sentence underneath had already started, and the one after that
    // would be spoken over it: two voices at once, reachable only through
    // this line, which is the one written to stop exactly that.
    reading += 1;
    engine.cancel();
    saying = null;
    stopWatching();
  }
  while (waiting.length && now - waiting[0].at > STALE_MS) waiting.shift();
  if (!waiting.length) return;
  // The voice list fills asynchronously and speaking before it has is
  // silent. WebView2 offers the machine's SAPI voices and nothing else:
  // Microsoft disabled its cloud Natural voices there by design, so this is
  // whatever Windows has installed and it may take a moment to say so.
  if (engine.getVoices().length === 0) {
    // One listener however many sentences are waiting. `once` deduplicates
    // nothing, because each call would hand it a new function.
    if (!waitingForVoices) {
      waitingForVoices = true;
      engine.addEventListener(
        "voiceschanged",
        () => {
          waitingForVoices = false;
          sayNext();
        },
        { once: true },
      );
    }
    return;
  }
  const next = waiting.shift();
  if (!next) return;
  const said = new globalThis.SpeechSynthesisUtterance(next.sentence);
  said.lang = locale();
  const mine = (reading += 1);
  // Both, because an engine that fails partway through leaves the queue
  // stopped otherwise and nothing is ever read again this run. Ignored when
  // this is no longer the sentence being read: an utterance that was cut, or
  // one the engine refused, still gets to raise its event afterwards.
  const done = () => {
    if (mine !== reading) return;
    saying = null;
    stopWatching();
    sayNext();
  };
  said.onend = done;
  said.onerror = done;
  // Before the call rather than after. Chromium dispatches `end`
  // asynchronously, but an engine that dispatches it from inside `speak`
  // would have its `saying = null` overwritten by the assignment underneath,
  // and the queue would be marked as reading a sentence that had finished.
  saying = now;
  // Armed against the sentence that is about to be read rather than against
  // the one waiting behind it. Armed where the reading starts, so every
  // sentence has one: it used to be armed only when a caller happened to
  // arrive while one was being read, which meant the queue was watched until
  // the first ceiling fired and never again. An engine that then went silent
  // took every sentence after the second with it, neither read nor dropped.
  stopWatching();
  lookAgain = setTimeout(() => {
    lookAgain = null;
    sayNext();
  }, SPEAKING_CEILING_MS);
  try {
    engine.speak(said);
  } catch (failure) {
    log.warn(
      "watch",
      failure instanceof Error ? failure.message : "The voice refused.",
    );
    // An engine may raise `end` from inside `speak` and throw afterwards, in
    // which case the sentence after this one is already being read and none of
    // what follows is about it. Tearing down regardless would orphan that one
    // and start a third over the top of it.
    if (mine !== reading) return;
    // Nothing this utterance says afterwards counts, and the queue is not
    // held by a sentence that was never started.
    reading += 1;
    saying = null;
    stopWatching();
    sayNext();
  }
}

/** Puts out the ceiling armed against whatever was being read. */
function stopWatching(): void {
  if (lookAgain === null) return;
  clearTimeout(lookAgain);
  lookAgain = null;
}
