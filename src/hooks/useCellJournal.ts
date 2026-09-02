import { useEffect, useRef } from "react";
import { translate } from "../i18n";
import { appendJournalRow } from "../lib/journal";
import { haversineMiles } from "../lib/geo";
import { formatDistance } from "../lib/units";
import type { CellReport } from "../lib/cells";
import type { WatchPlace } from "../lib/watch";

/**
 * How near a tracked storm has to come before it is worth writing down.
 *
 * Ten miles is close enough that somebody at the place heard it. Wider and the
 * record fills with every storm in the county, which is the failure that makes
 * a journal worth nothing: a year of rows nobody would read.
 */
export const JOURNAL_PASS_MILES = 10;

/**
 * Writes down a tracked storm passing a place the reader named.
 *
 * The third of the three things that open an entry, and the only one the
 * reader could not already have seen in a toast. All three are the weather
 * doing something: a warning reaching a place, the sky changing at a place,
 * and a storm passing one. Nothing the reader does opens an entry, which is
 * the rule that keeps this a weather record rather than a record of a person.
 *
 * One row per storm per place. The algorithm's own identity for the cell is
 * what makes that possible: the same storm in the next volume is the same id,
 * so a storm sitting over somewhere for an hour is one row rather than twelve.
 *
 * What it can see is what the workspace is showing: the cells come from the
 * single site the radar is tuned to, and only while that layer is switched on.
 * A storm passing a watched place while the reader is looking somewhere else
 * is not written down. That is a gap in the record rather than a wrong row,
 * and the README says so where the three triggers are listed.
 */
export function useCellJournal(options: {
  report: CellReport | null;
  places: readonly WatchPlace[];
  enabled: boolean;
  /** The frame that was on screen, if there is one to take a picture of. */
  capture?: () => Promise<Uint8Array | null>;
  /**
   * What the reader calls each storm, by the algorithm's identifier.
   *
   * A storm somebody named and then watched pass their house is the entry
   * they will actually want to read next year, so the row carries the name
   * they gave it as well as the identifier the radar gave it.
   */
  names?: ReadonlyMap<string, string>;
}): void {
  const { report, places, enabled, capture, names } = options;
  // Held for the life of the session rather than saved. A restart writing one
  // more row about a storm that is still there is a much smaller fault than a
  // list of storm identities kept on disk beside the record.
  const seen = useRef(new Set<string>());
  const captureRef = useRef(capture);
  useEffect(() => {
    captureRef.current = capture;
  }, [capture]);

  useEffect(() => {
    if (!enabled || !report) return;
    for (const place of places) {
      // Only a place the reader named, exactly as the warning rows are. A
      // coordinate somebody never called anything is not a place they have
      // claimed.
      if (place.named === false) continue;
      const at = { lon: place.center[0], lat: place.center[1] };
      for (const cell of report.cells) {
        const miles = haversineMiles(at, {
          lon: cell.longitude,
          lat: cell.latitude,
        });
        if (miles > JOURNAL_PASS_MILES) continue;
        // The place and the storm, and deliberately not the station. Tuning
        // to a neighbouring site is something the reader did, and keying on
        // it wrote a second row about a storm already recorded, which is an
        // entry created by a person rather than by the weather.
        const key = `${place.name}|${cell.id}`;
        if (seen.current.has(key)) continue;
        seen.current.add(key);
        void appendJournalRow(
          {
            at: new Date().toISOString(),
            place: place.name,
            kind: "observation",
            source: report.station,
            // The volume's own time. A storm that passed at ten past four is
            // a row that says ten past four, whatever time the app read it.
            observed: report.observed,
            obtained: translate("journal.obtainedCells"),
            text: translate(
              names?.has(cell.id)
                ? "journal.namedCellPassed"
                : "journal.cellPassed",
              {
                id: cell.id,
                name: names?.get(cell.id) ?? "",
                distance: formatDistance(miles),
              },
            ),
          },
          captureRef.current,
        );
      }
    }
    // `names` is read rather than depended on: a reader typing a name is not
    // the weather doing something, and restarting this on every keystroke
    // would write a row the moment they began typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, places, report]);
}
