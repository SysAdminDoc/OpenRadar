import { isDesktopRuntime } from "./settings";

/**
 * Starting with Windows.
 *
 * The watch only runs while the app does, so a reader who set up ten places
 * and quiet hours is unwatched from the moment they reboot until they
 * remember to open the workspace again. This is the switch that fixes that.
 *
 * It goes through Tauri's autostart plugin, which writes a Run entry under
 * the current user and nowhere else: no service, no scheduled task, nothing
 * for another account. The entry carries `--hidden`, which the native side
 * reads to open to the tray rather than putting the map across somebody's
 * screen on every boot.
 *
 * Every call is best-effort and answers rather than throwing. A machine that
 * refuses the registry write is a machine where the switch says off, which is
 * the truth about what will happen at the next boot.
 */

async function plugin() {
  if (!isDesktopRuntime()) return null;
  try {
    return await import("@tauri-apps/plugin-autostart");
  } catch {
    return null;
  }
}

/**
 * Whether the app is registered to start with the machine, or `null` when
 * nobody can say.
 *
 * Three answers rather than two. A browser preview and a machine that would
 * not answer are not the same as an entry that is not there: reported as off,
 * the switch draws itself as a working control that does nothing, and the copy
 * written for exactly that case is never shown.
 */
export async function startsWithMachine(): Promise<boolean | null> {
  const api = await plugin();
  if (!api) return null;
  try {
    return await api.isEnabled();
  } catch {
    return null;
  }
}

/**
 * Registers or removes the entry, and answers with what is actually true
 * afterwards.
 *
 * Read back rather than assumed. A switch that reports what it asked for
 * rather than what happened is a switch that says a reader is watched when
 * they are not.
 */
export async function setStartWithMachine(
  on: boolean,
): Promise<boolean | null> {
  const api = await plugin();
  if (!api) return null;
  try {
    if (on) await api.enable();
    else await api.disable();
  } catch {
    // Fall through to the read: the plugin may have done the work and failed
    // on the way back, and the entry is the only thing that settles it.
  }
  try {
    return await api.isEnabled();
  } catch {
    return null;
  }
}
