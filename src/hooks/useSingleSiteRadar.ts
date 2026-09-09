import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isOnline } from "../lib/online";
import { pollWhileOnline } from "../lib/poll";
import {
  fetchArchiveSweep,
  fetchLocalSweep,
  fetchSweep,
  isSingleSiteViewport,
  level2Available,
  LIVE_REFRESH_MS,
  nearestSite,
  pickArchiveFile,
  recentVolumeTimes,
  sitesInReach,
  SWEEP_REFRESH_MS,
  sweepDetailBox,
  sweepErrorText,
  type SiteInReach,
  type SweepImage,
} from "../lib/level2";
import { fetchCrossSection, type CrossSection } from "../lib/crossSection";
import type { GeoPoint } from "../lib/geo";
import { highContrastRequested, reducedMotionRequested } from "./useClock";
import { log } from "../lib/log";
import { isTdwrStation, supportedProduct } from "../lib/radarKinds";
import { loopKey, trimHeld, volumeForTime } from "../lib/siteLoop";
import {
  dataExportAvailable,
  exportSweepData,
  type DataExportReport,
} from "../lib/dataExport";
import type { RadarSettings } from "../lib/settings";
import { useLatestReply } from "./useLatestReply";

export interface SingleSiteState {
  /** The sweep on the map, or null while the mosaic is still the picture. */
  sweep: SweepImage | null;
  /** The site being drawn or fetched, which the panel names. */
  station: string | null;
  loading: boolean;
  error: string | null;
  /** True while a single site is what the map should be showing. */
  active: boolean;
  /**
   * Where the volume on screen sits in the site's loop, or null when it is
   * the newest one and the legend's own live wording covers it.
   *
   * Only ever set while the reader has scrubbed back, which is exactly the
   * state nothing else on screen announces: the map keeps its context layers,
   * the panel keeps its site, and without this the legend would say a tilt
   * and leave the reader to guess how far back they are.
   */
  loop: { index: number; count: number } | null;
  /**
   * The volume the sweep ON SCREEN was fetched for, as opposed to the one the
   * scrubber is asking for.
   *
   * The two differ for as long as a fetch takes, which for a ten megabyte
   * archive object is seconds. Anything that has to act on the picture rather
   * than on the request has to wait for this to catch up: a saved loop that
   * captured each frame as soon as the map went idle wrote the previous
   * volume's pixels under the next volume's caption and its record, silently,
   * for every frame of the file.
   */
  drawnVolume: number | null;
  /**
   * The volume the compare pane is showing, and which one it is.
   *
   * The second pane draws the same moment minus an offset, and it was handed
   * the same sweep as the first: with a held site the two panes showed one
   * volume between them and the offset meant nothing at all. Null whenever
   * there is nothing to compare, which is every view but a held site with the
   * scrubber stopped and the pane open.
   */
  compare: { sweep: SweepImage | null; at: number | null };
  /**
   * When a volume's bytes reached this machine, or null for one never fetched.
   *
   * Asked rather than captured, for the same reason `drawnVolume` is: an
   * export walks the loop and each volume arrives while the walk is running.
   * What it answers is the difference between a picture that came off the
   * network a moment ago and one the loop has been holding for ten minutes,
   * which is the whole of what a record's cache age is for.
   */
  arrivedAt: (volume: number) => number | null;
  /**
   * Every radar whose coverage reaches the view, nearest first.
   *
   * Asked for on the same coarse position the nearest-site search uses, so
   * panning within one site's coverage does not ask again.
   */
  inReach: SiteInReach[];
  /**
   * The site's recent volume times, oldest first, or empty when it has no
   * loop. The export walks these rather than the mosaic's steps, so a saved
   * loop of a held site is that site's volumes.
   */
  volumes: number[];
  /** Historical data is deliberately isolated from current context layers. */
  historical: boolean;
  mode: "recent" | "archive" | "local";
  openLocal: () => Promise<boolean>;
  openArchive: (station: string, at: string) => Promise<boolean>;
  resumeRecent: () => void;
  /**
   * Cuts the volume on screen between two points.
   *
   * The hook does this rather than the panel because only the hook knows which
   * volume is on screen and how it got there. A chosen file in particular is
   * held here and nowhere else: its path never reaches a component, an export,
   * or a workspace backup.
   *
   * Null when there is no site to cut, which is a mosaic view rather than a
   * failure.
   */
  crossSection:
    ((from: GeoPoint, to: GeoPoint) => Promise<CrossSection>) | null;
  /**
   * Writes the gates of the sweep on screen as numbers rather than colours.
   *
   * Here for the same reason the slice is: only the hook knows how the volume
   * on screen arrived, and a chosen file's path is held here and nowhere else.
   * Null when there is no sweep to write.
   */
  exportValues: (() => Promise<DataExportReport>) | null;
}

/** A site's whole reach, in the corners the native side answers with. */
interface Disc {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** A decoded volume, and when this app took delivery of it. */
interface Held {
  /**
   * The picture, or null for a volume known to have arrived whose picture is
   * not kept. A live composite is not a finished volume and must never be
   * served back to a reader who scrubbed onto that volume.
   */
  image: SweepImage | null;
  arrivedAt: number;
}

type HistoricalSource =
  | { kind: "archive"; station: string; at: string }
  | { kind: "local"; path: string };

/**
 * Level II is a close-in view of one site. This decides which site that is,
 * asks the native side for the sweep, and keeps it fresh while the view stays
 * close in.
 */
/**
 * Whether a fetched sweep is an answer to what is being asked for now.
 *
 * A product or tilt change leaves the last picture on screen until the next
 * one arrives, and everything downstream has to agree about which of the two
 * it is looking at: the panel names one and an export must not write the
 * other.
 */
function answersTheRequest(
  sweep: SweepImage | null,
  station: string | null,
  tilt: number,
  product: string,
): boolean {
  return (
    sweep !== null &&
    sweep.station === station &&
    sweep.tiltIndex === tilt &&
    sweep.productId === product
  );
}

/**
 * How many historical pictures to keep, keyed by the whole request.
 *
 * Small on purpose. The case this exists for is a reader panning around one
 * archived volume, which is a handful of boxes, and each of these is a decoded
 * sweep rather than a tile.
 */
const HISTORICAL_HELD = 8;

/** One shared empty list, so a site with no loop is a stable identity. */
const EMPTY_TIMES: number[] = [];

/** The same, for a view no radar reaches. */
const EMPTY_SITES: SiteInReach[] = [];

export function useSingleSiteRadar(options: {
  ready: boolean;
  radar: RadarSettings;
  center: [number, number];
  zoom: number;
  /**
   * The longest side of the window the map is drawn in, in CSS pixels.
   *
   * Whether a box covers what the reader can see depends on the window as
   * much as on the zoom, and on a low-latitude disc more than either. The
   * longer side rather than the width, because the two axes reduce to one
   * test; see `sweepDetailBox`.
   */
  windowPx: number;
  pageVisible: boolean;
  /** Bumped when a colour table is loaded, so the sweep is drawn again. */
  paletteGeneration: number;
  /**
   * The moment the timeline is showing, in milliseconds, or null while it has
   * nothing to show.
   *
   * A site's own volumes are five minutes apart and the timeline runs on the
   * mosaic's two-minute steps, so this is what says which volume belongs to
   * the step on screen. Scrubbing back draws the volume that was true then
   * rather than the newest one; the newest step keeps the live path exactly
   * as it was.
   *
   * Optional, and null means no loop: a caller with no timeline of its own
   * gets exactly the behaviour it had before the loop existed.
   */
  showingTime?: number | null;
  /**
   * The moment the compare pane is showing, in milliseconds, or null when it
   * is closed. Resolved to one of the site's volumes the same way the first
   * pane's moment is.
   */
  compareTime?: number | null;
  /**
   * Whether the site's listing should be left exactly as it is.
   *
   * A refresh answers with the last N volumes, so a volume landing during a
   * long walk pushes the oldest one out of the list. Anything holding a
   * position in that list then loses it: a saved loop of thirty volumes runs
   * longer than the refresh interval, and the frames it had left to write
   * were volumes the hook had just stopped knowing about.
   *
   * A function rather than a flag, because the caller that knows this is
   * built after this hook is.
   */
  listingHeld?: () => boolean;
}): SingleSiteState {
  const {
    ready,
    radar,
    center,
    zoom,
    windowPx,
    pageVisible,
    paletteGeneration,
    showingTime = null,
    compareTime = null,
    listingHeld,
  } = options;
  /**
   * Each site's whole reach, from the first sweep of it drawn over all of it.
   *
   * The box below is measured against this, and it cannot come from the sweep
   * on screen: once one has been drawn over less ground, its corners are the
   * box rather than the disc, and measuring the next box against the last one
   * would walk the picture inwards a step at a time. A site's reach does not
   * move, so the first whole-disc sweep of a site is the answer for all of
   * them.
   *
   * One per site rather than one at a time. A file from disk carries whatever
   * site it was recorded at, which may be nowhere near the map, and with a
   * single disc there was nothing to measure its box against: it drew over its
   * whole 460 kilometres at 449 metres a pixel however far the reader zoomed.
   * Sending it the map's own site's box instead is worse and was the defect
   * this replaced, because two discs that overlap in both axes clip to a
   * sliver of the intersection. Its own first answer carries its own corners,
   * so after one whole-disc fetch the site is known and the next one can be
   * measured properly.
   */
  const [discs, setDiscs] = useState<Record<string, Disc>>({});
  /**
   * Which site each file on disk was recorded at, learned from its own answer.
   *
   * Keyed on the path being asked for rather than read off the sweep on
   * screen. Those are the same file most of the time and are not during the
   * moment that matters: opening a second file leaves the first one on screen
   * until the new answer lands, so a station taken from the picture is the
   * previous file's, and the new file was measured on the previous file's
   * disc. That is the intersection sliver this whole arrangement exists to
   * avoid, moved from the first open to every open after it.
   */
  const [fileSites, setFileSites] = useState<Record<string, string>>({});
  /**
   * Records a site's reach, from an answer that covered all of it, and which
   * site a file carries when the answer came from one.
   */
  const rememberDisc = useCallback((answer: SweepImage) => {
    setDiscs((now) =>
      now[answer.station]
        ? now
        : {
            ...now,
            [answer.station]: {
              west: answer.west,
              south: answer.south,
              east: answer.east,
              north: answer.north,
            },
          },
    );
  }, []);

  /**
   * Notes which site a file carries, and corrects the note when it changes.
   *
   * Called for every local answer rather than only the unboxed ones. Written
   * once and never revisited, a path whose file had been replaced on disk
   * with a volume from a different station kept the old station's disc for
   * the life of the window, and every ask for it was measured on ground it
   * does not cover. A station that disagrees drops the note, which takes the
   * box with it, so the next ask is unboxed and teaches the file its site
   * again.
   */
  const noteFileSite = useCallback((path: string, station: string) => {
    setFileSites((now) =>
      now[path] === station ? now : { ...now, [path]: station },
    );
  }, []);

  // The site, and the coarse position it was resolved for. A site found for
  // somewhere else is not an answer to where the map is now, which is what
  // kept KDMX on screen over Bermuda.
  const [nearby, setNearby] = useState<{ site: string; near: string } | null>(
    null,
  );
  // The sites the view can see, and the coarse position they were listed for.
  // Travels with its position for the same reason the resolved site does: a
  // list for somewhere else is not an answer about where the map is now.
  const [reach, setReach] = useState<{ near: string; sites: SiteInReach[] }>({
    near: "",
    sites: [],
  });
  const [sweep, setSweep] = useState<SweepImage | null>(null);
  const [loading, setLoading] = useState(false);

  // The site's recent volume times, oldest first, and the pictures already
  // decoded for them. Held rather than refetched, because scrubbing back and
  // forth over the same stretch of a storm is what a loop is for.
  //
  // The site they were listed for travels with them, the same way the
  // resolved site above carries the position it was resolved for: a list of
  // KDMX's volumes is not an answer about KTLX, and clearing it from inside
  // an effect would be a state write on every render that changed the site.
  const [listed, setListed] = useState<{ site: string; times: number[] }>({
    site: "",
    times: [],
  });
  /**
   * A volume the loop has decoded, and when this app took delivery of it.
   *
   * One entry rather than a picture here and a time somewhere else. The two
   * were kept apart at first, the pictures under the full fetch key and the
   * times under the volume alone, and they disagreed in both directions: a
   * product switch overwrote the time while the earlier product's picture was
   * still held and still exportable, and the two maps evicted on different
   * orders, so a held picture could be served with no time at all. Together
   * they cannot drift, because there is nothing to drift.
   *
   * `image` is null for a volume known to have arrived whose picture is not
   * kept: the live path takes delivery of the newest volume every refresh and
   * what it draws is not always a finished volume.
   */
  const heldRef = useRef<Map<string, Held>>(new Map());
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
  // The volumes being fetched right now. Both panes resolve their own moment
  // and the two often land on one volume, and without this they each asked
  // the archive for the same ten megabyte object at the same time.
  const fetchingRef = useRef<Set<string>>(new Set());
  // Which volume the picture on screen answers. Null over a live sweep that
  // belongs to no listed volume, and over the mosaic.
  const [drawnVolume, setDrawnVolume] = useState<number | null>(null);
  // The compare pane's picture, once one has been fetched for it. Held under
  // the key it was fetched for, so a stale one cannot be shown for a volume
  // it is not.
  const [fetchedCompare, setFetchedCompare] = useState<{
    sweep: SweepImage;
    key: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historicalSource, setHistoricalSource] =
    useState<HistoricalSource | null>(null);

  const available =
    ready && level2Available() && radar.enabled && radar.singleSite;
  const wanted =
    available && historicalSource === null && isSingleSiteViewport(zoom);
  // A selected volume is useful at any zoom. It is already bounded to its
  // site's coverage, and zooming out must not silently replace history with now.
  const historicalWanted = available && historicalSource !== null;

  // Panning within a site's coverage must not restart the fetch, so the site
  // is resolved from a coarse position rather than the exact centre.
  const near = `${center[0].toFixed(1)},${center[1].toFixed(1)}`;

  // A held site wins outright, so nothing has to be resolved or stored for it.
  const station = historicalSource
    ? historicalSource.kind === "archive"
      ? historicalSource.station
      : (sweep?.station ?? null)
    : (radar.station ?? (nearby?.near === near ? nearby.site : null));

  // Pulled out of the settings object so the effect below can depend on the
  // values instead of the identity of the object carrying them.
  const loopVolumes = radar.loopVolumes;
  /**
   * How many decoded volumes to keep, read where a dependency would cost a
   * refetch. The live effect pulls a whole volume when anything it depends on
   * changes, and the loop length is a slider.
   */
  const heldBoundRef = useRef(loopVolumes * 2);
  useEffect(() => {
    heldBoundRef.current = loopVolumes * 2;
  }, [loopVolumes]);
  const motionSpeed = radar.stormMotion?.speedMs ?? null;
  const motionFrom = radar.stormMotion?.fromDegrees ?? null;
  // A product this radar does not have is asked for as reflectivity, which
  // every radar has: a terminal radar held with spectrum width chosen draws
  // something true while the picker shows which products are off.
  const product = supportedProduct(station, radar.product);
  // A product with no entry is drawn whole, which is what every product does
  // until somebody asks otherwise.
  const threshold = radar.thresholds[product] ?? null;

  const volumeTimes =
    station && listed.site === station ? listed.times : EMPTY_TIMES;

  /**
   * The ground the live sweep is drawn over, or null for the site's whole
   * reach.
   *
   * One raster over 460 kilometres is 449 metres a pixel against gates a
   * quarter of a kilometre long, so past about zoom ten a reader is looking
   * at this app's sampling and not at the radar. Spending the same pixels on
   * less ground is what a single image can do about that.
   *
   * Every path that draws this site, so a frame the loop holds covers the
   * same place as the live sweep beside it. It is in the loop's own key too:
   * a frame drawn over a sixteenth of the disc is not an answer for a reader
   * who has zoomed back out.
   */
  // Worked out fresh every render, which is a subtraction and two rounds, and
  // then rebuilt from its own key. The key is what decides whether anything
  // asks again: the box is quantised, so a pan inside the picture produces
  // the same four numbers, and rebuilding from the string is what keeps the
  // array's identity as steady as the numbers are. Everything that draws this
  // site can then simply depend on it.
  const asking = station
    ? (discs[station] &&
        sweepDetailBox(discs[station], center, zoom, windowPx)) ||
      null
    : null;
  const withinKey = asking ? asking.join(",") : "";
  const within = useMemo(
    () =>
      withinKey
        ? (withinKey.split(",").map(Number) as [number, number, number, number])
        : null,
    [withinKey],
  );

  /**
   * The box for every file whose site is known, by the path it was opened at.
   *
   * One entry per file rather than one for the file on screen. Keyed on the
   * source being asked about, a reader going back to a file they had open a
   * moment ago was asked for unboxed all over again, because the only box in
   * hand belonged to whichever file was current: a whole ten megabyte volume
   * on every switch back and forth, for a site this already knows the reach
   * of. The comment here used to say that ask was what teaches the file its
   * site, which is true the first time and false every time after.
   *
   * Rebuilt from a key the way `within` is, because `historicalWithin`'s
   * identity decides when the historical effect runs, and an object rebuilt
   * on every render made it a new function each time: the effect then asked
   * twice for the same box, once on the first run and again before the first
   * answer had come back to write the request key.
   */
  const fileBoxKey = JSON.stringify(
    Object.fromEntries(
      Object.entries(fileSites).map(([path, site]) => [
        path,
        discs[site]
          ? sweepDetailBox(discs[site], center, zoom, windowPx)
          : null,
      ]),
    ),
  );
  const fileBoxes = useMemo(
    () =>
      JSON.parse(fileBoxKey) as Record<
        string,
        [number, number, number, number] | null
      >,
    [fileBoxKey],
  );

  // The volume the step on screen belongs to, and whether the reader has
  // scrubbed off the newest one. Everything about the live picture, including
  // the volume in progress and its persistence, belongs to the newest step
  // and is left exactly as it was.
  const newestVolume = volumeTimes.at(-1) ?? null;
  // Held in a ref so the live effect can read it without depending on it.
  const newestVolumeRef = useRef<number | null>(null);
  useEffect(() => {
    newestVolumeRef.current = newestVolume;
  }, [newestVolume]);
  const shownVolume =
    showingTime === null ? null : volumeForTime(volumeTimes, showingTime);
  const scrubbedBack =
    shownVolume !== null &&
    newestVolume !== null &&
    shownVolume !== newestVolume;

  const compareVolume =
    compareTime === null ? null : volumeForTime(volumeTimes, compareTime);
  // What that volume would be held under, which is also what says whether
  // there is anything to fetch. Derived rather than stored: writing it from
  // inside an effect would be a state change on every step of the scrubber.
  const compareKey =
    !wanted || !station || compareVolume === null
      ? null
      : loopKey({
          station,
          at: compareVolume,
          product,
          tilt: radar.tilt,
          dealias: radar.dealias,
          motion:
            motionSpeed !== null && motionFrom !== null
              ? [motionSpeed, motionFrom]
              : null,
          threshold,
          palette: paletteGeneration,
          highContrast: highContrastRequested(),
          within,
        });
  // Whatever has been settled for the key being asked about now. A reply for
  // a key the pane has moved off is not an answer to the question it is
  // asking, and showing one is how a pane ends up a volume behind itself.
  const compareSweep =
    compareKey !== null && fetchedCompare?.key === compareKey
      ? fetchedCompare.sweep
      : null;

  // The compare pane's volume. Taken from the loop's own cache of decoded
  // volumes where it is there, which is the ordinary case at a small offset,
  // and fetched where it is not. Both go through the same resolved promise so
  // the answer always arrives after the render rather than during the effect.
  const latestCoverage = useLatestReply();
  useEffect(() => {
    if (compareKey === null || compareVolume === null || !station) return;
    const reply = latestCoverage();
    const motion: [number, number] | null =
      motionSpeed !== null && motionFrom !== null
        ? [motionSpeed, motionFrom]
        : null;
    const held = heldRef.current.get(compareKey)?.image ?? null;
    if (!held && fetchingRef.current.has(compareKey)) return;
    if (!held) fetchingRef.current.add(compareKey);
    void (
      held
        ? Promise.resolve(held)
        : fetchArchiveSweep(
            station,
            new Date(compareVolume).toISOString(),
            product,
            radar.tilt,
            radar.dealias,
            motion,
            threshold,
            highContrastRequested(),
            within,
          )
    )
      .then((next) => {
        if (!held) {
          fetchingRef.current.delete(compareKey);
          heldRef.current.set(compareKey, {
            image: next,
            arrivedAt: Date.now(),
          });
          heldRef.current = trimHeld(heldRef.current, loopVolumes * 2);
        }
        if (reply.current())
          setFetchedCompare({ sweep: next, key: compareKey });
      })
      .catch((failure: unknown) => {
        // The pane draws the mosaic rather than the wrong volume, and says so
        // in the log; the first pane is untouched either way.
        fetchingRef.current.delete(compareKey);
        if (reply.current()) {
          log.warn("radar", `${station} compare: ${sweepErrorText(failure)}`);
        }
      });
    return () => {
      reply.close();
    };
  }, [
    latestCoverage,
    compareKey,
    compareVolume,
    loopVolumes,
    motionFrom,
    motionSpeed,
    product,
    radar.dealias,
    radar.tilt,
    station,
    threshold,
    // The compare pane is placed beside the live sweep, so it follows the
    // same ground. `compareKey` carries the box as well, so a frame held for
    // one is never handed to the other.
    within,
  ]);

  // The list for the picker. Asked for whether or not a site is pinned,
  // because the picker is how somebody unpins one, and on the same coarse
  // position the nearest-site search uses.
  //
  // Only where a site would actually draw. Zoomed out, nothing resolves a
  // station, so nothing polls the office either: the list would have been
  // offered with no fault reasons on any of it, and a radar the office is
  // reporting as restarting would have looked like every other choice.
  const latestStatus = useLatestReply();
  useEffect(() => {
    if (!available || !isSingleSiteViewport(zoom)) return;
    const reply = latestStatus();
    const [lon, lat] = near.split(",").map(Number);
    void sitesInReach(lon, lat)
      .then((found) => {
        if (reply.current()) setReach({ near, sites: found });
      })
      .catch((failure: unknown) => {
        // No list is the picker as it was before this existed: follow the
        // map, hold what is on screen, or name an airport.
        if (!reply.current()) return;
        log.warn(
          "radar",
          failure instanceof Error
            ? failure.message
            : "The radars in reach could not be listed.",
        );
      });
    return () => {
      reply.close();
    };
  }, [available, latestStatus, near, zoom]);

  const latestNearest = useLatestReply();
  useEffect(() => {
    if (!wanted || radar.station) return;
    const reply = latestNearest();
    const [lon, lat] = near.split(",").map(Number);
    void nearestSite(lon, lat)
      .then((found) => {
        // No answer means the view is outside every site's coverage, and the
        // position it was asked about is remembered either way so a later
        // view cannot inherit the answer.
        if (reply.current()) setNearby(found ? { site: found, near } : null);
      })
      .catch((failure: unknown) => {
        if (!reply.current()) return;
        log.warn(
          "radar",
          failure instanceof Error
            ? failure.message
            : "No radar site could be resolved.",
        );
      });
    return () => {
      reply.close();
    };
  }, [latestNearest, near, radar.station, wanted]);

  // The times themselves, asked for once per site and refreshed on the same
  // cadence a finished volume lands on. A terminal radar has no archive to
  // list, and neither has a historical view, which is its own moment.
  const latestListing = useLatestReply();
  useEffect(() => {
    // A terminal radar publishes no Level II archive, so it has no loop to
    // list; its picture is unaffected.
    if (!wanted || !station || isTdwrStation(station)) return;
    const reply = latestListing();
    const site = station;
    const ask = () => {
      void recentVolumeTimes(site, loopVolumes)
        .then((found) => {
          if (reply.current()) setListed({ site, times: found });
        })
        .catch(() => {
          // A site with no listing is a site with no loop, and the live
          // picture is unaffected: this is the only thing that reads it.
          if (reply.current()) setListed({ site, times: [] });
        });
    };
    // Held means held, including the ask this effect makes on its way in.
    // Its other dependencies move on their own — the window being hidden and
    // shown again is enough — and a refresh during a walk drops the oldest
    // volume out of the list the walk is standing on.
    if (isOnline() && (!listingHeld?.() || listed.site !== station)) ask();
    if (!pageVisible) {
      return () => {
        reply.close();
      };
    }
    // The first ask always happens; only the refreshes are held. A site with
    // no listing at all has no loop, which is worse than a slightly old one.
    const stop = pollWhileOnline(
      () => {
        if (!listingHeld?.()) ask();
      },
      SWEEP_REFRESH_MS,
      // The line above already made this mount's ask, under a condition of
      // its own.
      false,
    );
    return () => {
      reply.close();
      stop();
    };
    // `listed` is deliberately not a dependency: this effect writes it, and
    // depending on it would restart the timer every time an answer arrived.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingHeld, loopVolumes, pageVisible, station, wanted]);

  // A reply that arrives after the view has moved on must not be drawn.
  const requestRef = useRef(0);
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
        radar.tilt,
        radar.dealias,
        motionSpeed,
        motionFrom,
        threshold,
        paletteGeneration,
        highContrastRequested(),
        // Without this the effect below early-returned on an unchanged key
        // however far the reader zoomed, so an archived volume stayed clipped
        // to whatever box it was opened with until the product or tilt moved.
        historicalWithin(source),
      ]),
    [
      historicalWithin,
      motionFrom,
      motionSpeed,
      paletteGeneration,
      product,
      radar.dealias,
      radar.tilt,
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
        radar.tilt,
        radar.dealias,
        motion,
        threshold,
        highContrastRequested(),
        historicalWithin(source),
      ] as const;
      return source.kind === "archive"
        ? fetchArchiveSweep(source.station, source.at, ...common)
        : fetchLocalSweep(source.path, ...common);
    },
    [
      historicalWithin,
      motionFrom,
      motionSpeed,
      product,
      radar.dealias,
      radar.tilt,
      threshold,
    ],
  );

  const activateHistorical = useCallback(
    async (source: HistoricalSource): Promise<boolean> => {
      const request = ++requestRef.current;
      setLoading(true);
      try {
        const asked = historicalWithin(source);
        const next = await fetchHistorical(source);
        if (request !== requestRef.current) return false;
        // A whole-disc answer says what this site's reach is, wherever the
        // site is. That is the only way a file recorded at a station the map
        // has never been near ever gets a box of its own.
        if (asked === null) rememberDisc(next);
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
        if (request === requestRef.current) setLoading(false);
      }
    },
    [
      fetchHistorical,
      historicalRequestKey,
      historicalWithin,
      noteFileSite,
      rememberDisc,
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
  }, [activateHistorical]);

  const openArchive = useCallback(
    (askedStation: string, at: string) =>
      activateHistorical({
        kind: "archive",
        station: askedStation.trim().toUpperCase(),
        at,
      }),
    [activateHistorical],
  );

  /**
   * What a volume would be held under, right now.
   *
   * The same key both effects build, in one place, because `arrivedAt` has to
   * ask the same question they answer: a picture decoded under one product is
   * a different entry from the same volume under another, and reading the
   * arrival by volume alone reported the newer fetch's time for the older
   * picture that was still on screen.
   */
  const keyFor = useCallback(
    (volume: number) =>
      station === null
        ? null
        : loopKey({
            station,
            at: volume,
            product,
            tilt: radar.tilt,
            dealias: radar.dealias,
            motion:
              motionSpeed !== null && motionFrom !== null
                ? [motionSpeed, motionFrom]
                : null,
            threshold,
            palette: paletteGeneration,
            highContrast: highContrastRequested(),
            within,
          }),
    [
      motionFrom,
      motionSpeed,
      paletteGeneration,
      product,
      radar.dealias,
      radar.tilt,
      station,
      threshold,
      // Rebuilt from its own key, so this only moves when the ground does.
      within,
    ],
  );

  /**
   * When this app took delivery of a volume, as it is drawn now.
   *
   * Read from the same entry the picture is in, so an eviction takes both and
   * a picture served from the hold can never come back without a time.
   */
  const arrivedAt = useCallback(
    (volume: number) => {
      const key = keyFor(volume);
      return key === null
        ? null
        : (heldRef.current.get(key)?.arrivedAt ?? null);
    },
    [keyFor],
  );

  const takeCrossSection = useCallback(
    (from: GeoPoint, to: GeoPoint) => {
      const source = historicalSource
        ? historicalSource.kind === "archive"
          ? ({
              kind: "archive",
              station: historicalSource.station,
              at: historicalSource.at,
            } as const)
          : ({ kind: "local", path: historicalSource.path } as const)
        : ({ kind: "recent", station: station ?? "" } as const);
      return fetchCrossSection(
        source,
        from,
        to,
        product,
        radar.dealias,
        threshold,
        // Read now rather than held, the same way a sweep reads it: the slice
        // is drawn when it is asked for.
        highContrastRequested(),
      );
    },
    [historicalSource, product, radar.dealias, station, threshold],
  );

  // The same volume the picture came from, as readings. The product, tilt and
  // derivation are the ones on screen; the display threshold is not sent,
  // because an export of what the radar measured is not a drawing.
  //
  // The product is the sweep's own rather than the setting's. They differ
  // while a switch is in flight, and on a radar that does not have what the
  // setting asks for, and writing a file for a product the reader is not
  // looking at is the kind of mismatch an export exists to rule out.
  const writeValues = useCallback(() => {
    const from = historicalSource;
    return exportSweepData({
      station: from?.kind === "archive" ? from.station : (station ?? ""),
      product:
        answersTheRequest(sweep, station, radar.tilt, product) && sweep
          ? sweep.productId
          : product,
      tilt: radar.tilt,
      dealias: radar.dealias,
      motion:
        motionSpeed !== null && motionFrom !== null
          ? [motionSpeed, motionFrom]
          : null,
      at: from?.kind === "archive" ? from.at : null,
      path: from?.kind === "local" ? from.path : null,
    });
  }, [
    historicalSource,
    motionFrom,
    motionSpeed,
    product,
    radar.dealias,
    radar.tilt,
    station,
    sweep,
  ]);

  const resumeRecent = useCallback(() => {
    requestRef.current += 1;
    historicalRequestRef.current = null;
    setHistoricalSource(null);
    setSweep(null);
    setError(null);
    setLoading(false);
  }, []);

  const latestHistorical = useLatestReply();
  useEffect(() => {
    if (!historicalWanted || !historicalSource) return;
    const key = historicalRequestKey(historicalSource);
    if (historicalRequestRef.current === key) return;
    // A box this reader has already been at. Panning away and back is the
    // ordinary thing to do with an archived volume open, and it cost a fetch
    // and a decode every time.
    const already = historicalHeldRef.current.get(key)?.image;
    if (already) {
      historicalRequestRef.current = key;
      requestRef.current += 1;
      setSweep(already);
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
        if (asked === null) rememberDisc(next);
        if (historicalSource.kind === "local") {
          noteFileSite(historicalSource.path, next.station);
        }
        historicalRequestRef.current = key;
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
  ]);

  const latestLive = useLatestReply();
  useEffect(() => {
    // Not while the reader is looking at an older volume: this effect draws
    // what the radar is doing now, on a timer, and it would overwrite the
    // frame under the scrubber a few seconds after they moved it.
    if (!wanted || !station || scrubbedBack) return;
    const reply = latestLive();

    const refresh = async () => {
      const request = ++requestRef.current;
      setLoading(true);
      try {
        const next = await fetchSweep(
          station,
          product,
          radar.tilt,
          radar.dealias,
          motionSpeed !== null && motionFrom !== null
            ? [motionSpeed, motionFrom]
            : null,
          threshold,
          radar.live,
          // Read now rather than held, so a preference changed while the app is
          // open reaches the next sweep the reader asks for.
          highContrastRequested(),
          // Only over a live composite: a finished volume has nothing behind
          // it to fade and no beam position to mark.
          radar.live && radar.persistence,
          reducedMotionRequested(),
          radar.smoothSweep,
          within,
        );
        if (!reply.current() || request !== requestRef.current) return;
        // The site's whole reach, learned from the one sweep that covers it.
        // Recorded whether or not this answer is still the one on screen: it
        // is true about the site rather than about this request, and without
        // it there is nothing to measure the next box against.
        if (within === null) rememberDisc(next);
        setSweep(next);
        // Read from a ref rather than a dependency: this effect refetches on
        // every value it depends on, and the listing refreshes on its own
        // timer, so depending on the newest volume would pull a fresh sweep
        // every time the archive published one.
        setDrawnVolume(newestVolumeRef.current);
        setError(null);
      } catch (failure: unknown) {
        if (!reply.current() || request !== requestRef.current) return;
        // A Tauri command rejects with what the error serialized to, which
        // is a code the page has its own wording for.
        const message = sweepErrorText(failure);
        log.warn("radar", `${station}: ${message}`);
        // The previous sweep is a different product, tilt, or moment. Leaving
        // it drawn under a label that now says something else is worse than
        // handing the map back to the mosaic.
        setSweep(null);
        setError(message);
      } finally {
        if (reply.current() && request === requestRef.current)
          setLoading(false);
      }
    };

    // The first ask, before the visibility check, so a hidden window still
    // reads once. Not with no network, where it is one more failure in the
    // log and nothing on screen.
    if (isOnline()) void refresh();
    // A hidden window keeps whatever it has rather than polling behind itself.
    if (!pageVisible) {
      return () => {
        reply.close();
      };
    }
    // A volume in progress grows every eleven or twelve seconds, so waiting
    // two minutes for the next ask would leave most of what arrives unseen.
    const stop = pollWhileOnline(
      () => void refresh(),
      radar.live ? LIVE_REFRESH_MS : SWEEP_REFRESH_MS,
      // The line above already made this mount's ask.
      false,
    );
    return () => {
      reply.close();
      stop();
    };
    // A new colour table redraws the sweep, which is drawn natively.
  }, [
    latestLive,
    rememberDisc,
    pageVisible,
    paletteGeneration,
    radar.dealias,
    radar.live,
    radar.persistence,
    radar.smoothSweep,
    product,
    // The two numbers rather than the object holding them. A settings object is
    // rebuilt whenever anything in it changes, including the map centre, so
    // depending on the object refetched the sweep on every pan.
    motionSpeed,
    motionFrom,
    threshold,
    radar.tilt,
    station,
    wanted,
    scrubbedBack,
    // The box rather than the zoom: it is quantised, so a pan or a zoom that
    // lands on the same ground asks for nothing.
    within,
  ]);

  /**
   * Delivery of the volume the live path drew, once it is known which one.
   *
   * That path is the only one that draws the newest volume, and it recorded
   * nothing, so the last frame of every saved loop was the one frame with no
   * arrival time. It cannot record it itself: it reads the newest volume from
   * a ref on purpose, so its first fetch runs before the listing has landed
   * and would file the delivery under nothing. Watched from the listing's
   * side instead, where a sweep drawn with the scrubber at the front is the
   * newest volume by definition.
   *
   * No picture is kept. What that path draws over a live composite is a
   * volume still being written, and serving it back to a reader who scrubbed
   * onto that volume would be a partial picture under a finished volume's
   * label. An entry already there is left alone: the volume arrived when it
   * first arrived.
   */
  useEffect(() => {
    if (scrubbedBack || newestVolume === null || sweep === null) return;
    const key = keyFor(newestVolume);
    if (key === null || heldRef.current.has(key)) return;
    heldRef.current.set(key, { image: null, arrivedAt: Date.now() });
    heldRef.current = trimHeld(heldRef.current, heldBoundRef.current);
  }, [keyFor, newestVolume, scrubbedBack, sweep]);

  // The volume under the scrubber, decoded once and kept.
  const latestVolume = useLatestReply();
  useEffect(() => {
    if (!wanted || !station || !scrubbedBack || shownVolume === null) return;
    const reply = latestVolume();
    const motion: [number, number] | null =
      motionSpeed !== null && motionFrom !== null
        ? [motionSpeed, motionFrom]
        : null;
    const contrast = highContrastRequested();
    const key = loopKey({
      station,
      at: shownVolume,
      product,
      tilt: radar.tilt,
      dealias: radar.dealias,
      motion,
      threshold,
      palette: paletteGeneration,
      highContrast: contrast,
      within,
    });

    const already = heldRef.current.get(key)?.image;
    if (already) {
      // Including the spinner. A fetch left in flight by the previous frame
      // has already been closed as a reply, so its `finally` will not
      // clear this, and a reader scrubbing over volumes they have already
      // seen kept a spinner that never stopped.
      requestRef.current += 1;
      setSweep(already);
      setDrawnVolume(shownVolume);
      setError(null);
      setLoading(false);
      return;
    }

    const request = ++requestRef.current;
    setLoading(true);
    void fetchArchiveSweep(
      station,
      new Date(shownVolume).toISOString(),
      product,
      radar.tilt,
      radar.dealias,
      motion,
      threshold,
      contrast,
      within,
    )
      .then((next) => {
        // Kept whether or not it is still the frame on screen. Decoding is
        // the expensive half and the answer is true about that volume
        // whatever the scrubber has moved on to; discarding it because the
        // reader moved first meant almost nothing was ever cached.
        heldRef.current.set(key, { image: next, arrivedAt: Date.now() });
        heldRef.current = trimHeld(heldRef.current, loopVolumes * 2);
        if (!reply.current() || request !== requestRef.current) return;
        setSweep(next);
        setDrawnVolume(shownVolume);
        setError(null);
      })
      .catch((failure: unknown) => {
        if (!reply.current() || request !== requestRef.current) return;
        const message = sweepErrorText(failure);
        log.warn("radar", `${station} loop: ${message}`);
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
    latestVolume,
    motionFrom,
    motionSpeed,
    paletteGeneration,
    product,
    radar.dealias,
    radar.tilt,
    loopVolumes,
    scrubbedBack,
    shownVolume,
    station,
    threshold,
    wanted,
    // The ground the frame under the scrubber is drawn over, so it covers the
    // same place as the live sweep the reader zoomed in for.
    within,
  ]);

  return useMemo(() => {
    // A recent sweep of a different site, product, or tilt is not an answer to
    // the question being asked now. History keeps its last verified picture
    // while another cut is being decoded, because that picture still names its
    // own product, tilt, source, and collection time.
    const asked = answersTheRequest(sweep, station, radar.tilt, product);
    const showing = wanted || historicalWanted;
    const current = showing && (historicalWanted || asked) ? sweep : null;
    return {
      sweep: current,
      station: showing ? station : null,
      loading: Boolean(available && loading),
      error: available ? error : null,
      active: Boolean(current),
      // Never in historical mode, for the same reason the series below is
      // not: a chosen file or a chosen moment is one volume the reader picked
      // and not a step of any loop. Without this guard, scrubbing back and
      // then opening an archive volume left a loop position set, which told
      // the chrome the view had not left the present: the legend read
      // "VOLUME 2 OF 3" over a volume from 2011, the archive credit vanished,
      // and the scrubber was re-enabled over a picture it does not drive.
      loop:
        showing && !historicalWanted && scrubbedBack && shownVolume !== null
          ? {
              index: volumeTimes.indexOf(shownVolume) + 1,
              count: volumeTimes.length,
            }
          : null,
      // Never in historical mode: a chosen file or a chosen archive moment
      // is one volume the reader picked, and the recent listing behind the
      // loop is not a series it belongs to.
      volumes: showing && !historicalWanted ? volumeTimes : EMPTY_TIMES,
      inReach: reach.near === near ? reach.sites : EMPTY_SITES,
      historical: historicalWanted,
      // The same guard: a hand-picked volume is not one of the loop's, so
      // nothing may wait on it as though it were.
      drawnVolume: showing && !historicalWanted ? drawnVolume : null,
      // Never in historical mode, for the same reason the series is not: a
      // hand-picked volume is one moment the reader chose and has no offset.
      compare:
        showing && !historicalWanted
          ? { sweep: compareSweep, at: compareSweep ? compareVolume : null }
          : { sweep: null, at: null },
      arrivedAt,
      mode: historicalSource?.kind ?? "recent",
      openLocal,
      openArchive,
      resumeRecent,
      // A slice needs a site whichever way the volume arrived. A held local
      // file carries its own, and the mosaic has none.
      // And never for a terminal radar, which has no volume to cut.
      crossSection:
        showing &&
        !isTdwrStation(station) &&
        (historicalSource?.kind === "local" || station)
          ? takeCrossSection
          : null,
      // A terminal radar's picture comes from a Level III product rather than
      // a volume, so there are no gates of it to write.
      // The sweep on screen rather than whatever was fetched last: during a
      // product switch those are two different pictures, and the button is
      // named after the one the reader is looking at.
      exportValues:
        showing &&
        current !== null &&
        !isTdwrStation(station) &&
        dataExportAvailable() &&
        (historicalSource?.kind === "local" || station)
          ? writeValues
          : null,
    };
  }, [
    arrivedAt,
    available,
    compareSweep,
    compareVolume,
    error,
    historicalSource?.kind,
    historicalWanted,
    loading,
    near,
    openArchive,
    reach,
    openLocal,
    product,
    radar.tilt,
    drawnVolume,
    resumeRecent,
    scrubbedBack,
    shownVolume,
    station,
    sweep,
    takeCrossSection,
    volumeTimes,
    wanted,
    writeValues,
  ]);
}
