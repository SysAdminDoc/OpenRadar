import { useEffect, useMemo, useRef, useState } from "react";
import { isOnline } from "../lib/online";
import { pollWhileOnline } from "../lib/poll";
import {
  CELLS_REFRESH_MS,
  CELLS_STALE_MINUTES,
  cellFeatures,
  cellsAvailable,
  fetchCells,
  rotatingCells,
  type CellReport,
} from "../lib/cells";
import { log } from "../lib/log";

export interface StormCellState {
  /** What the algorithm is tracking, or null when there is nothing to draw. */
  report: CellReport | null;
  /** The same, as the map takes it. */
  features: Record<string, unknown> | null;
  /** Which cells have a rotation inside them. */
  rotating: Set<string>;
  loading: boolean;
  error: string | null;
}

const NOTHING: Set<string> = new Set();

/**
 * The storm cells for whichever site the single-site radar is reading.
 *
 * Tied to that site rather than to the map, because the cells are the same
 * radar's own account of the same volume: showing one site's picture with
 * another's cells over it would be two different moments on one screen.
 */
export function useStormCells(options: {
  ready: boolean;
  enabled: boolean;
  station: string | null;
  pageVisible: boolean;
  /** Milliseconds, ticking once a minute, for judging what is still current. */
  clock: number;
  /**
   * What the reader calls each storm, by the algorithm's own identifier.
   *
   * Drawn on the map beside that identifier rather than instead of it: the
   * name is the reader's and the identity is the data's.
   */
  names?: ReadonlyMap<string, string>;
  /**
   * Told each time a report arrives, before anything is drawn from it.
   *
   * This is where the reader's own names for storms are pruned. It has to
   * happen when the report changes and nowhere else: doing it in an effect
   * that watches the report is a setState in an effect body, which cascades
   * a render, and doing it while rendering would mean a name reappearing on
   * whichever storm inherited the identifier.
   */
  onReport?: (report: CellReport | null) => void;
}): StormCellState {
  const { ready, enabled, station, pageVisible, clock, names } = options;
  const reportRef = useRef(options.onReport);
  useEffect(() => {
    reportRef.current = options.onReport;
  }, [options.onReport]);
  const [report, setReport] = useState<CellReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wanted = ready && enabled && cellsAvailable() && station !== null;

  useEffect(() => {
    // Nothing is cleared here. Writing state during an effect cascades a
    // render, and it is not needed: what comes back below is gated on the
    // question being asked now, so a report for a site nobody is looking at
    // is never drawn whatever is still held.
    if (!wanted || !station) return;
    let open = true;

    const refresh = async () => {
      setLoading(true);
      try {
        const next = await fetchCells(station);
        if (!open) return;
        setReport(next);
        reportRef.current?.(next);
        setError(null);
      } catch (failure: unknown) {
        if (!open) return;
        const message =
          typeof failure === "string"
            ? failure
            : failure instanceof Error
              ? failure.message
              : "The storm cells could not be read.";
        log.warn("radar", `${station} cells: ${message}`);
        // A site with nothing to track is not a failure, but a site that could
        // not be read has nothing to draw either way, and drawing the last
        // volume's cells over a newer picture would be worse than drawing
        // none.
        setReport(null);
        reportRef.current?.(null);
        setError(message);
      } finally {
        if (open) setLoading(false);
      }
    };

    // The first ask, in the place it has always been: before the
    // visibility check below, so a hidden window still reads once.
    // Not with no network, where it is one more failure in the log.
    if (isOnline()) void refresh();

    if (!pageVisible) {
      return () => {
        open = false;
      };
    }
    const stop = pollWhileOnline(() => void refresh(), CELLS_REFRESH_MS, false);
    return () => {
      open = false;
      stop();
    };
  }, [pageVisible, station, wanted]);

  // A volume from half an hour ago is not what is happening now, and cells are
  // the one layer somebody might act on.
  const current = useMemo(() => {
    if (!report || !wanted) return null;
    // A report for another site is not an answer to the question being asked
    // now, whatever it was an answer to before.
    if (report.station !== station) return null;
    const observed = Date.parse(report.observed);
    if (!Number.isFinite(observed)) return null;
    const minutes = (clock - observed) / 60_000;
    return minutes <= CELLS_STALE_MINUTES ? report : null;
  }, [clock, report, station, wanted]);

  const rotating = useMemo(
    () => (current ? rotatingCells(current) : NOTHING),
    [current],
  );

  const features = useMemo(
    () => (current ? cellFeatures(current, rotating, names) : null),
    [current, rotating, names],
  );

  return {
    report: current,
    features,
    rotating,
    loading: Boolean(wanted && loading),
    error: wanted ? error : null,
  };
}
