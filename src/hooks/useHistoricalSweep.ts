import { useCallback, useEffect, useRef } from "react";
import {
  fetchArchiveSweep,
  fetchLocalSweep,
  pickArchiveFile,
  sweepErrorText,
  type Level2ProductId,
  type SweepImage,
} from "../lib/level2";
import { log } from "../lib/log";
import { trimHeld } from "../lib/siteLoop";
import { highContrastRequested } from "./useClock";
import { useLatestReply } from "./useLatestReply";

/** A decoded volume, and when this app took delivery of it. */
export interface Held {
  /**
   * The picture, or null for a volume known to have arrived whose picture is
   * not kept. A live composite is not a finished volume and must never be
   * served back to a reader who scrubbed onto that volume.
   */
  image: SweepImage | null;
  arrivedAt: number;
}

export type HistoricalSource =
  | { kind: "archive"; station: string; at: string }
  | { kind: "local"; path: string };

/**
 * How many historical pictures to keep, keyed by the whole request.
 *
 * Small on purpose. The case this exists for is a reader panning around one
 * archived volume, which is a handful of boxes, and each of these is a decoded
 * sweep rather than a tile.
 */
const HISTORICAL_HELD = 8;

/**
 * A volume from the archive or the reader's own disk, opened and kept on
 * screen, for `useSingleSiteRadar`.
 *
 * Its own hook because it is its own job: the live path draws what the radar
 * is doing now and this draws a moment the reader chose, and the two meet
 * only in the state they both write and the request number that decides
 * which answer is current. Both of those are the parent's and are handed in,
 * so there is still one request number for every path.
 */
export function useHistoricalSweep(options: {
  station: string | null;
  within: [number, number, number, number] | null;
  fileBoxes: Record<string, [number, number, number, number] | null>;
  product: Level2ProductId;
  tilt: number;
  dealias: boolean;
  motionSpeed: number | null;
  motionFrom: number | null;
  threshold: number | null;
  /** Hide the echo that is not weather, as the live sweep does. */
  echoMask: boolean;
  paletteGeneration: number;
  airGeneration: number;
  historicalSource: HistoricalSource | null;
  setHistoricalSource: (source: HistoricalSource | null) => void;
  historicalWanted: boolean;
  requestRef: { current: number };
  rememberDisc: (answer: SweepImage, whole: boolean) => void;
  noteFileSite: (path: string, station: string) => void;
  setSweep: (sweep: SweepImage | null) => void;
  setError: (error: string | null) => void;
  setLoading: (loading: boolean) => void;
}): {
  openLocal: () => Promise<boolean>;
  openArchive: (station: string, at: string) => Promise<boolean>;
  resumeRecent: () => void;
} {
  const {
    station,
    within,
    fileBoxes,
    product,
    tilt,
    dealias,
    motionSpeed,
    motionFrom,
    threshold,
    echoMask,
    paletteGeneration,
    airGeneration,
    historicalSource,
    setHistoricalSource,
    historicalWanted,
    requestRef,
    rememberDisc,
    noteFileSite,
    setSweep,
    setError,
    setLoading,
  } = options;
  /**
   * The same idea for historical mode, keyed by the whole request.
   *
   * The scrubber has held its frames since it was written and this path never
   * learned to: it compared one string and kept nothing, so a reader who
   * panned off a grid cell and back re-fetched the archived volume and
   * re-rendered it. The two were written months apart and the asymmetry was
   * nobody's decision.
   *
   * `historicalRequestKey` already carries the product, the tilt, the
   * dealiasing, the storm motion, the threshold, the palette, the contrast and
   * the box, so a change to any of them is a different key and the old picture
   * falls out on its own rather than needing to be cleared.
   */
  const historicalHeldRef = useRef<Map<string, Held>>(new Map());

  // The held pictures go whenever historical mode does, not only when the
  // reader presses the way out of it. `resumeRecent` is one exit and turning
  // the radar off or leaving single site is another: both drop
  // `historicalWanted` without it running, and eight decoded sweeps stayed
  // pinned for the life of the window through that door.
  useEffect(() => {
    if (historicalWanted) return;
    historicalHeldRef.current = new Map();
  }, [historicalWanted]);

  /**
   * The request number of an open the reader asked for, while it is in
   * flight, or null.
   *
   * `activateHistorical` takes a number before it fetches and drops its
   * answer if the number has moved on. Serving a box out of the hold moves
   * it, to stop a fetch the reader has panned past from repainting, and that
   * landed between an open taking its number and its answer arriving: the
   * picker closed, the file was read, and the picture was thrown away as
   * stale. `openLocal` returns false for that, which is also what a cancelled
   * dialog looks like, so nothing was said and the press did nothing.
   */
  const openingRef = useRef<number | null>(null);
  const historicalRequestRef = useRef<string | null>(null);

  /**
   * The ground a historical sweep may be drawn over.
   *
   * An archived volume of the live station sits on that station's disc and
   * gets the same box the live sweep does. A file from disk carries whatever
   * site it was recorded at, which may be nowhere near, so it gets a box
   * measured on its own site's disc: sending it the live station's box drew
   * it over the intersection of two discs, a sliver, whenever the two
   * happened to overlap, and sending it nothing left it the one sweep that
   * never followed the reader's zoom.
   *
   * Named once because two things have to agree about it. `fetchHistorical`
   * asks with it and `historicalRequestKey` decides from it whether the answer
   * in hand is stale, and a key that disagrees with the request either
   * re-fetches for ever or never follows the reader at all.
   */
  const historicalWithin = useCallback(
    (source: HistoricalSource) => {
      if (source.kind === "archive") {
        return source.station === station ? within : null;
      }
      // A file from disk. Its site is whatever it was recorded at, which its
      // own first answer is what says, so this is null until that answer is
      // in hand and its disc has been recorded.
      //
      // Looked up by the path being asked about, not by the file on screen.
      // Handing over whichever box was current drew a newly opened file on
      // the previous file's disc, which is the intersection sliver this whole
      // arrangement exists to avoid; keying it to the current file instead
      // made every return to a file already seen pay for a whole disc again.
      // By path, both are right: a file nobody has opened is unboxed once,
      // and a file already known is boxed straight away.
      return fileBoxes[source.path] ?? null;
    },
    [fileBoxes, station, within],
  );

  const historicalRequestKey = useCallback(
    (source: HistoricalSource) =>
      JSON.stringify([
        source,
        product,
        tilt,
        dealias,
        motionSpeed,
        motionFrom,
        threshold,
        paletteGeneration,
        airGeneration,
        highContrastRequested(),
        echoMask,
        // Without this the effect below early-returned on an unchanged key
        // however far the reader zoomed, so an archived volume stayed clipped
        // to whatever box it was opened with until the product or tilt moved.
        historicalWithin(source),
      ]),
    [
      airGeneration,
      echoMask,
      historicalWithin,
      motionFrom,
      motionSpeed,
      paletteGeneration,
      product,
      dealias,
      tilt,
      threshold,
    ],
  );

  const fetchHistorical = useCallback(
    (source: HistoricalSource) => {
      const motion: [number, number] | null =
        motionSpeed !== null && motionFrom !== null
          ? [motionSpeed, motionFrom]
          : null;
      const common = [
        product,
        tilt,
        dealias,
        motion,
        threshold,
        highContrastRequested(),
        echoMask,
        historicalWithin(source),
      ] as const;
      return source.kind === "archive"
        ? fetchArchiveSweep(source.station, source.at, ...common)
        : fetchLocalSweep(source.path, ...common);
    },
    [
      echoMask,
      historicalWithin,
      motionFrom,
      motionSpeed,
      product,
      dealias,
      tilt,
      threshold,
    ],
  );

  const activateHistorical = useCallback(
    async (source: HistoricalSource): Promise<boolean> => {
      const request = ++requestRef.current;
      openingRef.current = request;
      setLoading(true);
      try {
        const asked = historicalWithin(source);
        const next = await fetchHistorical(source);
        if (request !== requestRef.current) return false;
        // A whole-disc answer says what this site's reach is, wherever the
        // site is. That is the only way a file recorded at a station the map
        // has never been near ever gets a box of its own.
        rememberDisc(next, asked === null);
        if (source.kind === "local") {
          noteFileSite(source.path, next.station);
          // Everything held for this path goes, because a path is not a
          // volume. The reader picked this file from a dialog just now, and
          // the file behind a name can be a different volume from the one
          // that was there an hour ago: the held pictures are keyed on the
          // path, so the old file's decode was served back for the new one
          // and the site never changed on screen.
          for (const [held] of historicalHeldRef.current) {
            if (held.includes(JSON.stringify(source.path))) {
              historicalHeldRef.current.delete(held);
            }
          }
        }
        const key = historicalRequestKey(source);
        historicalRequestRef.current = key;
        // Held here as well as in the effect below, or the very first box a
        // reader opens is the one box that is never kept: they zoom away, the
        // effect fetches and holds the new one, and coming back to where they
        // started is the only move that still costs a round trip.
        // Deleted first, because `Map.set` on a key already present keeps its
        // position: re-holding a box the map already carries left that entry
        // at its oldest place and shed it first despite having just been
        // used, which is the defect the cache hit above exists to fix.
        historicalHeldRef.current.delete(key);
        historicalHeldRef.current.set(key, {
          image: next,
          arrivedAt: Date.now(),
        });
        historicalHeldRef.current = trimHeld(
          historicalHeldRef.current,
          HISTORICAL_HELD,
        );
        setHistoricalSource(source);
        setSweep(next);
        setError(null);
        return true;
      } catch (failure: unknown) {
        if (request !== requestRef.current) return false;
        const message = sweepErrorText(failure);
        log.warn("radar", `Historical volume: ${message}`);
        // The previous picture remains the active view. In particular, a bad
        // local file never replaces good radar with an empty historical mode.
        setError(message);
        return false;
      } finally {
        // Only this open's own mark, so a second press that overtook this one
        // keeps its protection rather than having it cleared underneath it.
        if (openingRef.current === request) openingRef.current = null;
        if (request === requestRef.current) setLoading(false);
      }
    },
    [
      fetchHistorical,
      historicalRequestKey,
      historicalWithin,
      noteFileSite,
      rememberDisc,
      requestRef,
      setError,
      setHistoricalSource,
      setLoading,
      setSweep,
    ],
  );

  const openLocal = useCallback(async (): Promise<boolean> => {
    try {
      const path = await pickArchiveFile();
      return path ? activateHistorical({ kind: "local", path }) : false;
    } catch (failure: unknown) {
      const message = sweepErrorText(failure);
      log.warn("radar", `Archive II picker: ${message}`);
      setError(message);
      return false;
    }
  }, [activateHistorical, setError]);

  const openArchive = useCallback(
    (askedStation: string, at: string) =>
      activateHistorical({
        kind: "archive",
        station: askedStation.trim().toUpperCase(),
        at,
      }),
    [activateHistorical],
  );

  const resumeRecent = useCallback(() => {
    requestRef.current += 1;
    historicalRequestRef.current = null;
    // The held pictures belong to historical mode and go with it. Up to eight
    // decoded sweeps, several megabytes each, stayed pinned for the life of
    // the window after the reader went back to live, and none of them could
    // be reached again without re-entering historical mode and re-choosing
    // the same volume anyway.
    historicalHeldRef.current = new Map();
    setHistoricalSource(null);
    setSweep(null);
    setError(null);
    setLoading(false);
  }, [requestRef, setError, setHistoricalSource, setLoading, setSweep]);

  const latestHistorical = useLatestReply();
  useEffect(() => {
    if (!historicalWanted || !historicalSource) return;
    const key = historicalRequestKey(historicalSource);
    if (historicalRequestRef.current === key) return;
    // A box this reader has already been at. Panning away and back is the
    // ordinary thing to do with an archived volume open, and it cost a fetch
    // and a decode every time.
    const already = historicalHeldRef.current.get(key);
    if (already?.image) {
      // Put back at the end, so the map's order is when each box was last
      // wanted rather than when it first arrived. `trimHeld` keeps the last
      // entries by insertion order and a `get` does not move a key, so a
      // reader working between two boxes lost whichever they had opened
      // first the moment a ninth box arrived: the two in use were the two
      // evicted.
      historicalHeldRef.current.delete(key);
      historicalHeldRef.current.set(key, already);
      historicalRequestRef.current = key;
      // Not while an open the reader asked for is waiting on an answer. That
      // press outranks a box being served out of memory, and taking the
      // request number from under it is what dropped the file they chose.
      if (openingRef.current === null) requestRef.current += 1;
      setSweep(already.image);
      setError(null);
      setLoading(false);
      return;
    }
    const reply = latestHistorical();
    const request = ++requestRef.current;
    const asked = historicalWithin(historicalSource);
    setLoading(true);
    // Keep the last verified historical picture until its replacement is
    // decoded. Its own product and tilt travel with it, so a failed request
    // cannot expose the live mosaic underneath historical mode.
    void fetchHistorical(historicalSource)
      .then((next) => {
        if (!reply.current() || request !== requestRef.current) return;
        rememberDisc(next, asked === null);
        if (historicalSource.kind === "local") {
          noteFileSite(historicalSource.path, next.station);
        }
        historicalRequestRef.current = key;
        // Deleted first, because `Map.set` on a key already present keeps its
        // position: re-holding a box the map already carries left that entry
        // at its oldest place and shed it first despite having just been
        // used, which is the defect the cache hit above exists to fix.
        historicalHeldRef.current.delete(key);
        historicalHeldRef.current.set(key, {
          image: next,
          arrivedAt: Date.now(),
        });
        historicalHeldRef.current = trimHeld(
          historicalHeldRef.current,
          HISTORICAL_HELD,
        );
        setSweep(next);
        setError(null);
      })
      .catch((failure: unknown) => {
        if (!reply.current() || request !== requestRef.current) return;
        const message = sweepErrorText(failure);
        log.warn("radar", `Historical volume: ${message}`);
        setError(message);
      })
      .finally(() => {
        if (reply.current() && request === requestRef.current)
          setLoading(false);
      });
    return () => {
      reply.close();
    };
  }, [
    latestHistorical,
    fetchHistorical,
    historicalWithin,
    noteFileSite,
    rememberDisc,
    historicalRequestKey,
    historicalSource,
    historicalWanted,
    requestRef,
    setError,
    setLoading,
    setSweep,
  ]);

  return { openLocal, openArchive, resumeRecent };
}
