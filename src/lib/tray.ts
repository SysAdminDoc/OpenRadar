import { isDesktopRuntime } from "./settings";

/**
 * The icon in the tray, and the small window beside it.
 *
 * The workspace is the only thing that knows what the weather is doing, so it
 * is the workspace that tells these. Both are best-effort: a tray that cannot
 * be reached is a tray that is not there, and nothing on screen depends on
 * either of them.
 */

/** What the small window shows. Written by the workspace, read by that window. */
export interface Glance {
  place: string;
  warning: boolean;
  headline: string;
  /** A still of the map as a data URL, or empty. */
  picture: string;
  observed: number | null;
  source: string;
  at: number;
}

async function tell<T>(command: string, args?: Record<string, unknown>) {
  if (!isDesktopRuntime()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<T>(command, args);
  } catch {
    // A tray icon that could not be reached is a tray icon that is not
    // there, and the workspace has nothing to say about it.
    return null;
  }
}

/** Says whether a warning stands at a place the reader named. */
export async function setTrayHazard(warning: boolean): Promise<void> {
  await tell("tray_hazard", { warning });
}

/** Puts the icon in the tray, or takes it out for good. */
export async function setTrayEnabled(on: boolean): Promise<void> {
  await tell("tray_enabled", { on });
}

/** Says what closing the window should do. */
export async function setCloseToTray(hide: boolean): Promise<void> {
  await tell("tray_close_behaviour", { hide });
}

/** Keeps the small window above everything else, or stops. */
export async function setGlanceOnTop(on: boolean): Promise<void> {
  await tell("glance_on_top", { on });
}

/** Opens the small window, as the tray menu does. */
export async function openGlance(): Promise<void> {
  await tell("glance_open");
}

/** Hands the small window what to show. */
export async function writeGlance(glance: Glance): Promise<void> {
  await tell("glance_write", { glance });
}
