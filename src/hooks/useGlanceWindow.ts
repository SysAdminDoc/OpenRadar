import { useEffect, useState } from "react";
import { pictureDataUrl, thumbnailFrom } from "../lib/journal";
import {
  glanceIsShowing,
  observedMsFrom,
  setTrayHazard,
  whenGlanceOpens,
  writeGlance,
} from "../lib/tray";
import { WATCH_FAILURES_BEFORE_SAYING } from "../lib/watch";
import type { RadarFrame } from "../lib/radar";
import { useLatestReply } from "./useLatestReply";

export interface GlanceWindowOptions {
  /** Whether the tray icon is on at all, which is what makes any of this. */
  tray: boolean;
  /** The reader's own word for the place, or empty for the built-in one. */
  place: string;
  /** Ticks once a minute, which is how often the window is asked about. */
  clock: number;
  alertActive: boolean;
  watchFailing: number;
  headline: string;
  observed: RadarFrame | undefined;
  sourceLabel: string | null;
  /** The frame on screen, for the picture that window shows. */
  canvas: () => HTMLCanvasElement | null;
}

/**
 * The tray icon and the small window beside it.
 *
 * Answers whether that window is actually showing, which is not something
 * the workspace can decide: the tray menu opens it and closes it and says
 * nothing to the page. So it is asked on the clock, which is fine for
 * noticing it has gone and far too slow for noticing it arrived, and the
 * window says so itself besides.
 */
export function useGlanceWindow({
  tray,
  place,
  clock,
  alertActive,
  watchFailing,
  headline,
  observed,
  sourceLabel,
  canvas,
}: GlanceWindowOptions): void {
  const latestGlance = useLatestReply();
  // The icon says one thing: whether a warning stands at a place the reader
  // named. Not how many, not what the app is doing.
  useEffect(() => {
    if (tray) {
      // A watch that has stopped hearing back says so under the icon.
      // Not in its colour: the colour means weather, and an amber dot
      // for "the app is having trouble" would compete with that.
      void setTrayHazard(
        alertActive,
        watchFailing < WATCH_FAILURES_BEFORE_SAYING,
      );
    }
  }, [alertActive, watchFailing, tray]);

  // Whether the small window is actually open. Asked on the clock rather
  // than assumed, because it can be opened from the tray menu, which the
  // workspace never hears about.
  const [glanceOpen, setGlanceOpen] = useState(false);
  useEffect(() => {
    const reply = latestGlance();
    void glanceIsShowing().then((showing) => {
      if (reply.current()) setGlanceOpen(showing);
    });
    return reply.close;
  }, [clock, tray, latestGlance]);
  // The poll is once a minute, which is fine for noticing the window has gone
  // and far too slow for noticing it arrived: opened from the tray menu, the
  // reader watched a small window with words and no map. The window says so
  // itself now, and the write below runs on the same render.
  useEffect(() => {
    let stop: (() => void) | null = null;
    let alive = true;
    // Letting go of a listener is asynchronous and it can fail, which is the
    // part that took a while to see. `unlisten` from the event plugin returns
    // a promise and reaches into `window.__TAURI_EVENT_PLUGIN_INTERNALS__` to
    // do its work, so on a page without that object it rejects rather than
    // throwing where the caller stands. Calling it as a bare statement drops
    // that promise on the floor, which is where fifty of a green run's
    // unhandled rejections came from. Both calls are chained now.
    const release = (unlisten: () => void | Promise<void>) => {
      void Promise.resolve()
        .then(() => unlisten())
        .catch(() => {
          // Nothing to do and nobody to tell. The listener is going away with
          // the page either way, and a preview has no bridge to let go of.
        });
    };
    void whenGlanceOpens(() => setGlanceOpen(true))
      .then((unlisten) => {
        if (alive) {
          stop = unlisten;
          return;
        }
        // Unmounted before the listener was registered, so let it go at once.
        release(unlisten);
      })
      .catch(() => {
        // No bridge to listen through, which is every browser preview.
      });
    return () => {
      alive = false;
      if (stop) release(stop);
    };
  }, []);
  // With no tray there is no way to have opened it, whatever the last answer
  // was. Derived rather than written back, so the answer arriving late cannot
  // undo the switch.
  const glanceShowing = tray && glanceOpen;

  /**
   * What the small window shows, handed over rather than drawn again.
   *
   * A second live map would be a second WebGL context and a few hundred
   * megabytes for a window whose whole job is one glance, so the workspace
   * puts the frame it has already drawn where that window can read it. On the
   * clock, because that window is asking on a clock of its own.
   */
  useEffect(() => {
    if (!tray) return;
    void (async () => {
      // The picture only when there is a window to look at it. Reading the
      // map back, rescaling it and encoding a PNG once a minute is real work,
      // and the tray is on by default, so every reader was paying it for a
      // window most of them have never opened. The words are cheap and go
      // either way, so the window has something to show the moment it opens.
      const drawn = glanceShowing ? canvas() : null;
      const picture = drawn ? await thumbnailFrom(drawn) : null;
      await writeGlance({
        place: place,
        warning: alertActive,
        headline: headline,
        picture: picture ? pictureDataUrl(picture) : "",
        observedMs: observedMsFrom(observed),
        source: sourceLabel ?? "",
        at: Date.now(),
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock, glanceShowing, alertActive, tray]);
}
