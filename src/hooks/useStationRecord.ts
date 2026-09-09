import type { AmbientState } from "./useAmbient";
import { appendJournalRow } from "../lib/journal";
import { translate } from "../i18n";
import { useEffect, useRef } from "react";

/**
 * What the station near a watched place said, into the reader's own record.
 *
 * The only observation this app takes of somewhere the reader named, and it
 * is taken only while the weather on the chrome is switched on. One row per
 * change rather than one per poll: a record of six identical rows an hour is
 * a record nobody reads.
 */
export interface StationRecordOptions {
  /** The reader's own word for home, or nothing when they have not given one. */
  place: string | undefined;
  /** Whether home is being watched at all. */
  watching: boolean;
  ambient: AmbientState;
  /** The frame on screen, small, for the row this writes. */
  journalFrame: () => Promise<Uint8Array | null>;
}

export function useStationRecord({
  place,
  watching,
  ambient,
  journalFrame,
}: StationRecordOptions): void {
  // What the station said, into the reader's own record, when it changes.
  //
  // The station near a watched place is the only observation this app takes
  // of somewhere the reader named, and it is taken only while the weather on
  // the chrome is switched on. One row per change rather than one per poll: a
  // record of six identical rows an hour is a record nobody reads.
  //
  // The key is the place, the station and the reading together, and it is not
  // cleared when the reading goes away: alt-tabbing clears what the hook is
  // holding, and resetting on that wrote a fresh identical row every time the
  // window came back. Renaming home or moving the watch does change it, which
  // is right, because that is a different place being observed.
  const lastRecorded = useRef<string | null>(null);
  useEffect(() => {
    if (!watching || !place || !ambient.seen) return;
    const home = place;
    const { condition, station, observed } = ambient.seen;
    const key = `${home}|${station}|${condition}`;
    if (lastRecorded.current === key) return;
    lastRecorded.current = key;
    void appendJournalRow(
      {
        at: new Date().toISOString(),
        place: home,
        kind: "observation",
        source: station,
        observed: new Date(observed).toISOString(),
        obtained: translate("journal.obtainedStation"),
        text: translate(`opening.${condition}`),
      },
      journalFrame,
    );
  }, [ambient.seen, journalFrame, place, watching]);
}
