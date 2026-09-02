import { isDesktopRuntime } from "./settings";

/**
 * The current view on the desktop, refreshed on a schedule.
 *
 * A composed radar picture of the reader's own area, behind whatever they are
 * working on. It needs no new data path: the still export already draws the
 * frame with its time and its credits burned in, and this puts those bytes on
 * the desktop rather than in a file somebody has to go and find.
 *
 * What keeps it from being a nuisance:
 *
 * - **It has a floor.** A wallpaper that refreshed every minute would be a
 *   loop asking a public service for a frame every minute, for ever, behind
 *   somebody's spreadsheet.
 * - **It stops when there is nothing to draw.** Offline, or with no frame
 *   yet, it leaves the last picture up rather than writing an empty map.
 * - **It gives back what it took.** The reader's own wallpaper is recorded
 *   before the first write and put back the moment this is switched off.
 */

/** The shortest gap between writes, in minutes. */
export const WALLPAPER_FLOOR_MINUTES = 15;

/** The gaps worth offering, in minutes. Zero is off. */
export const WALLPAPER_EVERY = [0, 15, 30, 60, 180] as const;

/** Whether this machine can have its wallpaper set at all. */
export async function wallpaperAvailable(): Promise<boolean> {
  if (!isDesktopRuntime()) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<boolean>("wallpaper_available");
  } catch {
    return false;
  }
}

/**
 * Whether it is time to write another one.
 *
 * The floor is applied here as well as in the settings, because a stored
 * number from an older build, or from a file somebody edited, must not be
 * able to ask for a picture a minute.
 */
export function wallpaperDue(
  everyMinutes: number,
  lastAt: number,
  now: number,
): boolean {
  if (everyMinutes <= 0) return false;
  const gap = Math.max(WALLPAPER_FLOOR_MINUTES, everyMinutes) * 60_000;
  return now - lastAt >= gap;
}

/**
 * Writes one if it is time, and answers when the next gap starts counting.
 *
 * The whole rule in one place, because the half that was wrong lived as a
 * single line in the workspace where nothing could reach it. The gap counts
 * from a picture that went up, not from an attempt: a launch fires this
 * before the map has come up and before the first frames land, and counting
 * that as a write spent the slot and left the desktop untouched for the whole
 * of the reader's chosen gap. On three hours, that is three hours of nothing
 * after every launch.
 *
 * A failure does spend the slot. A machine that refused once refuses every
 * time, and a reader told about it every fifteen minutes is a reader who
 * switches the app off rather than the feature.
 */
export async function writeWallpaperIfDue(options: {
  everyMinutes: number;
  lastAt: number;
  now: number;
  /** Answers true when a picture actually went up. */
  write: () => Promise<boolean>;
  onFailure: (failure: unknown) => void;
}): Promise<number> {
  const { everyMinutes, lastAt, now } = options;
  if (!wallpaperDue(everyMinutes, lastAt, now)) return lastAt;
  try {
    return (await options.write()) ? now : lastAt;
  } catch (failure) {
    options.onFailure(failure);
    return now;
  }
}

/** Writes the picture and puts it on the desktop. Throws with why it failed. */
export async function setWallpaper(bytes: Uint8Array): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("wallpaper_set", { bytes: Array.from(bytes) });
}

/** Puts back whatever was on the desktop before. */
export async function restoreWallpaper(): Promise<void> {
  if (!isDesktopRuntime()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("wallpaper_restore");
}
