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
