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
 * `refused` is only ever set by a request that came back without a grant,
 * because the plugin cannot tell a refusal from a question never asked: it
 * offers a boolean and the only way to learn more is to prompt, which is not
 * something a report may do on the reader's behalf. So a run that has not
 * needed a notification yet says `unasked` rather than guessing, and the
 * word means what it says.
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
  try {
    const { isPermissionGranted } =
      await import("@tauri-apps/plugin-notification");
    if (await isPermissionGranted()) return "granted";
  } catch {
    // No native side to ask, which is the browser preview. The remembered
    // answer is still the honest one.
    return lastAnswer;
  }
  return lastAnswer === "granted" ? "unasked" : lastAnswer;
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
