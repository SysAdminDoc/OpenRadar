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
  if (!granted) return false;
  sendNotification({ title, body });
  return true;
}
