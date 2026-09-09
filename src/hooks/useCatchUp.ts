import type { AppSettings } from "../lib/settings";
import { catchUpFrom, type CatchUp } from "../lib/catchUp";
import { journalRows } from "../lib/journal";
import { log } from "../lib/log";
import { useEffect, useRef, useState } from "react";

/**
 * How often the app writes down that it is still running.
 *
 * Read on the next launch to work out how long it was away, and compared
 * against a four-hour threshold, so five minutes of slack costs nothing and
 * saves fifty-five settings writes an hour.
 */
const LAST_SEEN_EVERY_MS = 5 * 60_000;

/**
 * What the weather did at the reader's places while the app was closed.
 *
 * The gap is measured from the last time the app was running, which is read
 * once at hydration before the clock starts writing it again. Read out of
 * the record on the disk: nothing is fetched to answer this, so it cannot
 * claim a warning stood somewhere it did not.
 *
 * Answers with the card to show, or null once the reader has sent it away.
 */
export interface CatchUpOptions {
  hydrated: boolean;
  /** Ticks once a minute, which is what keeps the last-seen mark fresh. */
  clock: number;
  settingsRef: { current: AppSettings };
  onSettings: (next: AppSettings) => void;
}

export function useCatchUp({
  hydrated,
  clock,
  settingsRef,
  onSettings: applySettings,
}: CatchUpOptions) {
  // What the weather did at the reader's places while the app was closed.
  //
  // The gap is measured from the last time the app was running, which is read
  // once, at hydration, before the clock below starts writing it again. Read
  // out of the record on the disk: nothing is fetched to answer this, so it
  // cannot claim a warning stood somewhere it did not.
  const [catchUp, setCatchUp] = useState<CatchUp | null>(null);
  const [gone, setGone] = useState(false);
  const awaySince = useRef<number | null>(null);
  useEffect(() => {
    if (!hydrated || awaySince.current !== null) return;
    awaySince.current = settingsRef.current.lastSeen;
    if (!settingsRef.current.catchUp) return;
    const since = awaySince.current;
    void journalRows()
      .then((rows) => {
        setCatchUp(catchUpFrom(rows, since, Date.now()));
      })
      .catch((failure: unknown) => {
        // A record that cannot be read is a launch with nothing to catch up
        // on, which is what a reader who has no record sees anyway. Left
        // uncaught it was an unhandled rejection with no card and no line.
        log.warn(
          "catch-up",
          failure instanceof Error ? failure.message : String(failure),
        );
      });
  }, [hydrated, settingsRef]);

  // Written while the window is open rather than on the way out. A process
  // that is killed, crashes or loses power never runs its closing code, and a
  // summary that only survives a tidy exit is missing exactly when somebody
  // wants it. The clock ticks once a minute, so this costs one settings write
  // a minute, which is what the workspace already does.
  const lastSeenRef = useRef(0);
  useEffect(() => {
    if (!hydrated) return;
    const now = Date.now();
    // Every five minutes rather than every tick. A settings write replaces the
    // settings object, which wakes every memo and effect in the workspace that
    // is keyed on it, and doing that sixty times an hour for the life of the
    // process is a lot of work to record a figure that is compared against a
    // four-hour threshold.
    if (now - lastSeenRef.current < LAST_SEEN_EVERY_MS) return;
    lastSeenRef.current = now;
    applySettings({ ...settingsRef.current, lastSeen: now });
    // `clock` is what makes this run again; nothing else here changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock, hydrated]);
  return {
    catchUp: gone ? null : catchUp,
    dismissCatchUp: () => setGone(true),
  };
}
