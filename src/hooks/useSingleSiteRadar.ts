import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchArchiveSweep,
  fetchLocalSweep,
  fetchSweep,
  isSingleSiteViewport,
  level2Available,
  LIVE_REFRESH_MS,
  nearestSite,
  pickArchiveFile,
  SWEEP_REFRESH_MS,
  sweepErrorText,
  type SweepImage,
} from "../lib/level2";
import { fetchCrossSection, type CrossSection } from "../lib/crossSection";
import type { GeoPoint } from "../lib/geo";
import { highContrastRequested } from "./useClock";
import { log } from "../lib/log";
import { isTdwrStation, supportedProduct } from "../lib/radarKinds";
import {
  dataExportAvailable,
  exportSweepData,
  type DataExportReport,
} from "../lib/dataExport";
import type { RadarSettings } from "../lib/settings";

export interface SingleSiteState {
  /** The sweep on the map, or null while the mosaic is still the picture. */
  sweep: SweepImage | null;
  /** The site being drawn or fetched, which the panel names. */
  station: string | null;
  loading: boolean;
  error: string | null;
  /** True while a single site is what the map should be showing. */
  active: boolean;
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

export function useSingleSiteRadar(options: {
  ready: boolean;
  radar: RadarSettings;
  center: [number, number];
  zoom: number;
  pageVisible: boolean;
  /** Bumped when a colour table is loaded, so the sweep is drawn again. */
  paletteGeneration: number;
}): SingleSiteState {
  const { ready, radar, center, zoom, pageVisible, paletteGeneration } =
    options;
  // The site, and the coarse position it was resolved for. A site found for
  // somewhere else is not an answer to where the map is now, which is what
  // kept KDMX on screen over Bermuda.
  const [nearby, setNearby] = useState<{ site: string; near: string } | null>(
    null,
  );
  const [sweep, setSweep] = useState<SweepImage | null>(null);
  const [loading, setLoading] = useState(false);
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
  const motionSpeed = radar.stormMotion?.speedMs ?? null;
  const motionFrom = radar.stormMotion?.fromDegrees ?? null;
  // A product this radar does not have is asked for as reflectivity, which
  // every radar has: a terminal radar held with spectrum width chosen draws
  // something true while the picker shows which products are off.
  const product = supportedProduct(station, radar.product);
  // A product with no entry is drawn whole, which is what every product does
  // until somebody asks otherwise.
  const threshold = radar.thresholds[product] ?? null;

  useEffect(() => {
    if (!wanted || radar.station) return;
    let open = true;
    const [lon, lat] = near.split(",").map(Number);
    void nearestSite(lon, lat)
      .then((found) => {
        // No answer means the view is outside every site's coverage, and the
        // position it was asked about is remembered either way so a later
        // view cannot inherit the answer.
        if (open) setNearby(found ? { site: found, near } : null);
      })
      .catch((failure: unknown) => {
        if (!open) return;
        log.warn(
          "radar",
          failure instanceof Error
            ? failure.message
            : "No radar site could be resolved.",
        );
      });
    return () => {
      open = false;
    };
  }, [near, radar.station, wanted]);

  // A reply that arrives after the view has moved on must not be drawn.
  const requestRef = useRef(0);
  const historicalRequestRef = useRef<string | null>(null);

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
      ]),
    [
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
      ] as const;
      return source.kind === "archive"
        ? fetchArchiveSweep(source.station, source.at, ...common)
        : fetchLocalSweep(source.path, ...common);
    },
    [motionFrom, motionSpeed, product, radar.dealias, radar.tilt, threshold],
  );

  const activateHistorical = useCallback(
    async (source: HistoricalSource): Promise<boolean> => {
      const request = ++requestRef.current;
      setLoading(true);
      try {
        const next = await fetchHistorical(source);
        if (request !== requestRef.current) return false;
        historicalRequestRef.current = historicalRequestKey(source);
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
    [fetchHistorical, historicalRequestKey],
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

  useEffect(() => {
    if (!historicalWanted || !historicalSource) return;
    const key = historicalRequestKey(historicalSource);
    if (historicalRequestRef.current === key) return;
    let open = true;
    const request = ++requestRef.current;
    setLoading(true);
    // Keep the last verified historical picture until its replacement is
    // decoded. Its own product and tilt travel with it, so a failed request
    // cannot expose the live mosaic underneath historical mode.
    void fetchHistorical(historicalSource)
      .then((next) => {
        if (!open || request !== requestRef.current) return;
        historicalRequestRef.current = key;
        setSweep(next);
        setError(null);
      })
      .catch((failure: unknown) => {
        if (!open || request !== requestRef.current) return;
        const message = sweepErrorText(failure);
        log.warn("radar", `Historical volume: ${message}`);
        setError(message);
      })
      .finally(() => {
        if (open && request === requestRef.current) setLoading(false);
      });
    return () => {
      open = false;
    };
  }, [
    fetchHistorical,
    historicalRequestKey,
    historicalSource,
    historicalWanted,
  ]);

  useEffect(() => {
    if (!wanted || !station) return;
    let open = true;

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
        );
        if (!open || request !== requestRef.current) return;
        setSweep(next);
        setError(null);
      } catch (failure: unknown) {
        if (!open || request !== requestRef.current) return;
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
        if (open && request === requestRef.current) setLoading(false);
      }
    };

    void refresh();
    // A hidden window keeps whatever it has rather than polling behind itself.
    if (!pageVisible) {
      return () => {
        open = false;
      };
    }
    // A volume in progress grows every eleven or twelve seconds, so waiting
    // two minutes for the next ask would leave most of what arrives unseen.
    const timer = window.setInterval(
      () => void refresh(),
      radar.live ? LIVE_REFRESH_MS : SWEEP_REFRESH_MS,
    );
    return () => {
      open = false;
      window.clearInterval(timer);
    };
    // A new colour table redraws the sweep, which is drawn natively.
  }, [
    pageVisible,
    paletteGeneration,
    radar.dealias,
    radar.live,
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
      historical: historicalWanted,
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
    available,
    error,
    historicalSource?.kind,
    historicalWanted,
    loading,
    openArchive,
    openLocal,
    product,
    radar.tilt,
    resumeRecent,
    station,
    sweep,
    takeCrossSection,
    wanted,
    writeValues,
  ]);
}
