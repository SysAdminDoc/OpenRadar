import type { ToastMessage } from "../components/ToastHost";
import { useLatestReply } from "./useLatestReply";
import { log } from "../lib/log";
import {
  restoreWallpaper,
  wallpaperAvailable,
  wallpaperDue,
  writeWallpaperIfDue,
} from "../lib/wallpaper";
import { translate } from "../i18n";
import { useEffect, useRef, useState } from "react";

/**
 * The current view on the desktop, on the gap the reader chose.
 *
 * The same composed still the export writes, so the picture on the desktop
 * carries the frame time, the source credits and its own age exactly as a
 * saved one does. It writes nothing when there is no frame to draw or the
 * map has not come up: a wallpaper of an empty map is worse than the one
 * that is already there.
 */
export interface WallpaperOptions {
  /** Minutes between writes, or nought for not at all. */
  every: number;
  /** Ticks once a minute, which is what makes a due write happen. */
  clock: number;
  /** How many frames the timeline holds, for the cold start. */
  frameCount: number;
  writeWallpaper: () => Promise<boolean>;
  pushToast: (toast: Omit<ToastMessage, "id">) => void;
}

export function useWallpaper({
  every,
  clock,
  frameCount,
  writeWallpaper,
  pushToast,
}: WallpaperOptions): void {
  // One token per effect run, so an answer that arrives after a newer
  // question is recognised and dropped.
  const latestWallpaper = useLatestReply();
  /**
   * The current view on the desktop, on the gap the reader chose.
   *
   * The same composed still the export writes, so the picture on the desktop
   * carries the frame time, the source credits and its own age exactly as a
   * saved one does. It writes nothing when there is no frame to draw or the
   * map has not come up: a wallpaper of an empty map is worse than the one
   * that is already there.
   */
  const wallpaperAt = useRef(0);
  const wallpaperBusy = useRef(false);
  // Asked once. Whether this machine can have its wallpaper set does not
  // change while the app is running, and without the question a settings file
  // carried over from a Windows machine has a Mac writing a picture nothing
  // can apply, every hour, for ever.
  const [wallpaperOk, setWallpaperOk] = useState(false);
  useEffect(() => {
    const reply = latestWallpaper();
    void wallpaperAvailable().then((ok) => {
      if (reply.current()) setWallpaperOk(ok);
    });
    return reply.close;
  }, [latestWallpaper]);
  useEffect(() => {
    if (!wallpaperOk || wallpaperBusy.current) return;
    if (!wallpaperDue(every, wallpaperAt.current, clock)) {
      return;
    }
    wallpaperBusy.current = true;
    void (async () => {
      try {
        wallpaperAt.current = await writeWallpaperIfDue({
          everyMinutes: every,
          lastAt: wallpaperAt.current,
          now: clock,
          write: writeWallpaper,
          onFailure: (failure) => {
            // Said out loud rather than leaving a stale picture up and saying
            // nothing. The log gets the reason, which comes from the
            // operating system and is in English; the reader gets their own
            // words.
            log.warn(
              "wallpaper",
              failure instanceof Error
                ? failure.message
                : "It was not written.",
            );
            pushToast({
              title: translate("wallpaper.failed"),
              detail: translate("wallpaper.failedDetail"),
            });
          },
        });
      } finally {
        wallpaperBusy.current = false;
      }
    })();
    // `clock` and the arrival of frames are what make this run again. The
    // second one matters on a cold start: the clock ticks once a minute, and
    // without it a launch that had nothing to draw waited a whole minute
    // after the first frames landed before trying again.
    // depended on rather than the whole of it.
  }, [clock, frameCount, pushToast, every, wallpaperOk, writeWallpaper]);

  // Switched off puts the reader's own wallpaper back, which is the whole
  // reason this is safe to have at all.
  const hadWallpaper = useRef(false);
  useEffect(() => {
    if (every > 0) {
      hadWallpaper.current = true;
      return;
    }
    if (!hadWallpaper.current) return;
    hadWallpaper.current = false;
    void restoreWallpaper();
  }, [every]);
}
