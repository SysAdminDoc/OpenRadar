import type { ToastMessage } from "../components/ToastHost";
import type { WatchPlace } from "../lib/watch";
import type { AppSettings } from "../lib/settings";
import type { ArchiveReplay } from "./useRadarTimeline";
import type { CellReport } from "../lib/cells";
import {
  FORECAST_SMOKE_OPACITY,
  forecastSmokeCorners,
  forecastSmokeValid,
} from "../lib/forecastSmoke";
import { alertsOfKind } from "../lib/overlays/alerts";
import { approachesFor, type Approach } from "../lib/approach";
import { cellKey, livingNames, withName } from "../lib/cellNames";
import { satelliteFrameTime } from "../lib/providers";
import { SNOWFALL_OPACITY, snowfallCorners } from "../lib/snowfall";
import { type RadarFrame } from "../lib/radar";
import {
  useApproachWatch,
  approachBody,
  approachTitle,
} from "./useApproachWatch";
import { useArchiveWarnings } from "./useArchiveWarnings";
import { useCallback, useMemo } from "react";
import { useCellJournal } from "./useCellJournal";
import { useClassification } from "./useClassification";
import { useForecastSmoke } from "./useForecastSmoke";
import { useLightning } from "./useLightning";
import {
  useLightningWatch,
  lightningBody,
  lightningTitle,
} from "./useLightningWatch";
import { useGridWatch, gridBody, gridTitle } from "./useGridWatch";
import { useLightningJump } from "./useLightningJump";
import { useMelting } from "./useMelting";
import { useMrmsOverlays } from "./useMrmsOverlays";
import { useProbSevere } from "./useProbSevere";
import { useRadarTimeline } from "./useRadarTimeline";
import { useHighContrast, useSecondClock } from "./useClock";
import { useSingleSiteRadar } from "./useSingleSiteRadar";
import { useSnowfall } from "./useSnowfall";
import { useStormCells } from "./useStormCells";
import { useWind } from "./useWind";

/**
 * Everything the map draws that is not the radar picture itself.
 *
 * The cells the site's own tracker found and the names a reader gave them,
 * what the algorithm says is falling, the national grids and which of them
 * the reader chose, the lightning, the wind, that day's own warnings while a
 * replay is running, and the model's smoke. They are here together because
 * they are read together: nearly all of them are keyed on the frame the
 * playhead is on, and several are switched off outright while the reader is
 * looking at an archive.
 */
export interface WorkspaceFeedOptions {
  settings: AppSettings;
  hydrated: boolean;
  pageVisible: boolean;
  reducedMotion: boolean;
  clock: number;
  replay: ArchiveReplay | null;
  compareOffset: number;
  timeline: ReturnType<typeof useRadarTimeline>;
  singleSite: ReturnType<typeof useSingleSiteRadar>;
  watchedForJournal: WatchPlace[];
  cellNames: ReadonlyMap<string, string>;
  /** The frame on screen, small, for the row a named cell writes. */
  journalFrame: () => Promise<Uint8Array | null>;
  /** Bumped whenever a colour table changes, so the grids are drawn again. */
  paletteGeneration: number;
  setCellNames: (
    next: (was: ReadonlyMap<string, string>) => ReadonlyMap<string, string>,
  ) => void;
  pushToast: (toast: Omit<ToastMessage, "id">) => void;
}

export function useWorkspaceFeeds({
  settings,
  hydrated,
  pageVisible,
  reducedMotion,
  clock,
  replay,
  compareOffset,
  timeline,
  singleSite,
  watchedForJournal,
  cellNames,
  setCellNames,
  journalFrame,
  paletteGeneration,
  pushToast,
}: WorkspaceFeedOptions) {
  // Tied to whichever site the single-site radar is reading, because the cells
  // are that radar's own account of that volume.
  const stormCells = useStormCells({
    ready: hydrated,
    // The watch keeps its own feed. Tying it to the layer meant a reader
    // who switched the cells off had the approach notice stop with them,
    // while its switch stayed on in the settings and re-armed itself weeks
    // later when the layer came back. A watch runs whether or not anybody is
    // looking at what it is watching.
    enabled:
      (settings.layers.stormCells || settings.approach.enabled) &&
      !singleSite.historical,
    station: singleSite.station,
    pageVisible,
    // The approach notice is derived from this report and exists to reach
    // somebody who is not looking at the map, so the report has to keep
    // arriving while the window is hidden or in the tray.
    keepPollingWhileHidden: settings.approach.enabled,
    clock,
    names: cellNames,
    // Names follow the identity the algorithm gives, so when it stops
    // tracking a storm the name goes with it. Identifiers are reused: a name
    // left behind would reappear on a different storm, which is worse than
    // losing it. Done as the report lands rather than in an effect watching
    // it, which would be a setState in an effect body.
    onReport: useCallback(
      (report: CellReport | null) =>
        setCellNames((held) =>
          held.size
            ? livingNames(
                held,
                report?.station ?? null,
                report?.cells.map((cell) => cell.id) ?? [],
              )
            : held,
        ),
      [setCellNames],
    ),
  });

  const nameCell = useCallback(
    (id: string, name: string) => {
      const station = stormCells.report?.station;
      if (!station) return;
      setCellNames((held) => withName(held, cellKey(station, id), name));
    },
    [setCellNames, stormCells.report?.station],
  );

  // Keyed by the algorithm's identifier alone, for the surfaces that are
  // already looking at one radar's report.
  const namesHere = useMemo(() => {
    const station = stormCells.report?.station;
    if (!station) return new Map<string, string>();
    const out = new Map<string, string>();
    for (const cell of stormCells.report?.cells ?? []) {
      const name = cellNames.get(cellKey(station, cell.id));
      if (name) out.set(cell.id, name);
    }
    return out;
  }, [cellNames, stormCells.report]);

  useCellJournal({
    report: stormCells.report,
    places: watchedForJournal,
    enabled: settings.watch.enabled,
    capture: journalFrame,
    names: namesHere,
  });
  // The same site's own account of what is falling, read from Level III
  // beside the cells and tied to the site for the same reason.
  const classification = useClassification({
    ready: hydrated,
    enabled: settings.layers.classification && !singleSite.historical,
    station: singleSite.station,
    product: settings.radar.classificationProduct,
    pageVisible,
    clock,
  });
  // One object, so the map is handed something new only when the answer is.
  const drawnClassification = useMemo(
    () =>
      classification.report && classification.features
        ? {
            features: classification.features,
            legend: classification.report.legend,
          }
        : null,
    [classification.features, classification.report],
  );
  // One reading covers the whole country, so there is nothing to key on the
  // view: what is on screen is whatever part of it the map is over.
  const probSevere = useProbSevere({
    ready: hydrated,
    enabled: settings.layers.probSevere && !singleSite.historical,
    pageVisible,
    clock,
  });
  // The live legend counts in seconds, and nothing else on screen does. The
  // ticking starts only while a live sweep is drawn.
  const liveClock = useSecondClock(singleSite.sweep?.live === true);

  // Which grid each of the three switches that stands for several is pointing
  // at. Held together because the hook and the provenance records both need
  // all three, and a caller that passed two would silently report the default
  // window as the one on screen.
  const mrmsChoices = useMemo(
    () => ({
      gaugeQpePeriod: settings.gaugeQpePeriod,
      rotationPeriod: settings.rotationPeriod,
      lightningWindow: settings.lightningWindow,
      lightningForecastWindow: settings.lightningForecastWindow,
      lightningJumpWindow: settings.lightningJumpWindow,
      isothermLevel: settings.isothermLevel,
      azShearLevel: settings.azShearLevel,
      cappiField: settings.cappiField,
      cappiLevel: settings.cappiLevel,
    }),
    [
      settings.azShearLevel,
      settings.cappiField,
      settings.cappiLevel,
      settings.gaugeQpePeriod,
      settings.rotationPeriod,
      settings.lightningWindow,
      settings.lightningForecastWindow,
      settings.lightningJumpWindow,
      settings.isothermLevel,
    ],
  );

  const mrms = useMrmsOverlays({
    ready: hydrated,
    layers: settings.layers,
    pageVisible,
    paletteGeneration,
    choices: mrmsChoices,
    smooth: settings.radar.smoothGrids,
  });
  // What the radar’s own tracker says is heading for each watched place.
  // Not a warning, and never worded as one: the panel lists it, the notice
  // says it is a track, and both are off until asked for.
  const approaching = useMemo(
    () => approachesFor(stormCells.report, watchedForJournal, clock),
    [clock, stormCells.report, watchedForJournal],
  );
  useApproachWatch({
    report: stormCells.report,
    places: watchedForJournal,
    settings: settings.approach,
    clock,
    // The toast is the announcement on the browser path and the fallback on
    // the desktop one, and it sits in a polite live region either way. The
    // desktop notification is what a screen reader hears when it lands.
    onFallback: (coming: Approach) =>
      pushToast({
        title: approachTitle(coming),
        detail: approachBody(coming),
      }),
  });

  const lightning = useLightning({
    ready: hydrated,
    enabled:
      settings.layers.lightningFlashes || settings.lightningWatch.enabled,
    pageVisible,
    // Same reason as the cells above: the lightning notice is derived from
    // this window, and a watch that only works while somebody is watching
    // is not a watch.
    keepPollingWhileHidden: settings.lightningWatch.enabled,
    clock,
  });
  // Lightning near a watched place, from the window the map already holds.
  // Two notices per storm: come in, and half an hour after the last flash it
  // is over. Nothing here is a warning and every line of it says so.
  const placeLightning = useLightningWatch({
    window: lightning.window,
    places: watchedForJournal,
    rule: settings.lightningWatch,
    clock,
    onFallback: (notice) =>
      pushToast({
        title: lightningTitle(notice),
        detail: lightningBody(notice),
      }),
  });

  // The band the held volume can see, for the one product whose answer is
  // worked out against a freezing level. Asked for only while that product
  // is on screen: answering decodes a volume.
  const melting = useMelting({
    station: singleSite.station,
    ready: hydrated && settings.radar.product === "hail-size",
  });

  // A sudden rise in a tracked storm's flash rate, which is the two halves
  // the app already had with nothing joining them. Nothing is announced: a
  // jump is a signal that a storm is intensifying, and the panel says so.
  const cellJumps = useLightningJump({
    report: stormCells.report,
    window: lightning.window,
  });

  // The two rules set on a grid rather than on a warning. Each asks the
  // native side for one number per watched place, on the network's own two
  // minute cadence, and says the same two things per storm the lightning
  // rule does. Held back over a replay like every other current reading:
  // hail falling in 2005 is not hail falling now.
  useGridWatch({
    rule: "hail",
    settings: settings.hailWatch,
    places: watchedForJournal,
    ready: hydrated && !singleSite.historical,
    onFallback: (notice) =>
      pushToast({ title: gridTitle(notice), detail: gridBody(notice) }),
  });
  useGridWatch({
    rule: "rotation",
    settings: settings.rotationWatch,
    places: watchedForJournal,
    ready: hydrated && !singleSite.historical,
    onFallback: (notice) =>
      pushToast({ title: gridTitle(notice), detail: gridBody(notice) }),
  });

  // Animated particles are motion for its own sake, so a viewer who has asked
  // for less of it does not get them at all.
  const wind = useWind({
    ready: hydrated,
    enabled: settings.layers.wind && !reducedMotion,
    pageVisible,
  });
  const { frames, frameIndex, source } = timeline;
  const activeFrame = frames[frameIndex];

  // The warnings that were in force while the archived storm was on the map.
  // The live layer is switched off during a replay, because today's polygon
  // over yesterday's storm is a claim nobody made; this puts that day's own
  // polygons back, from the archive, one request for the whole window.
  const archiveWarnings = useArchiveWarnings({
    replay,
    enabled: settings.layers.weatherAlerts,
    frameTime: activeFrame?.time ?? null,
  });
  const replayedAlerts = useMemo(
    () =>
      archiveWarnings.data
        ? alertsOfKind(archiveWarnings.data, settings.alertTypes)
        : null,
    [archiveWarnings.data, settings.alertTypes],
  );
  // A comparison that asks for more history than exists is left empty. Using
  // the first frame while labelling it "12 back" gave a precise label to a
  // different moment.
  const compareFrame =
    frameIndex >= compareOffset
      ? frames[frameIndex - compareOffset]
      : undefined;

  // The model's smoke for the hour the playhead is on, and only on the
  // forecast tail: an observed frame has nothing from a model on it.
  const smokeWanted = settings.layers.forecastSmoke && !singleSite.historical;
  const forecastSmoke = useForecastSmoke({
    ready: hydrated,
    enabled: smokeWanted,
    valid: smokeWanted ? forecastSmokeValid(activeFrame) : null,
    preferredInit: activeFrame?.forecast?.initUtc ?? null,
  });
  const drawnForecastSmoke = useMemo(
    () =>
      forecastSmoke.field
        ? {
            url: forecastSmoke.field.image,
            coordinates: forecastSmokeCorners(forecastSmoke.field),
            opacity: FORECAST_SMOKE_OPACITY,
          }
        : null,
    [forecastSmoke.field],
  );

  // How much snow has already landed, which is one national picture rather
  // than anything to do with the frame on screen. The contrast preference is
  // read here because the grid is coloured natively: the picture arrives
  // already painted, so a reader turning contrast on has to be answered with
  // a different one rather than with a different stylesheet.
  const highContrast = useHighContrast();
  const snowfall = useSnowfall({
    ready: hydrated,
    enabled: settings.layers.snowfall,
    window: settings.snowfallWindow,
    highContrast,
  });
  const drawnSnowfall = useMemo(
    () =>
      snowfall.analysis
        ? {
            url: snowfall.analysis.image,
            coordinates: snowfallCorners(snowfall.analysis),
            opacity: SNOWFALL_OPACITY,
          }
        : null,
    [snowfall.analysis],
  );

  // The satellite image that stands for a frame, held back to the newest slot
  // the archive has actually published.
  const satelliteFor = (frame: RadarFrame | undefined) =>
    settings.layers.satellite && !singleSite.historical && frame
      ? satelliteFrameTime(frame.time, Math.floor(clock / 1000))
      : null;
  const satelliteTime = satelliteFor(activeFrame);
  return {
    stormCells,
    nameCell,
    namesHere,
    classification,
    drawnClassification,
    probSevere,
    liveClock,
    mrmsChoices,
    mrms,
    approaching,
    lightning,
    placeLightning,
    cellJumps,
    melting,
    wind,
    frames,
    frameIndex,
    source,
    activeFrame,
    archiveWarnings,
    replayedAlerts,
    compareFrame,
    forecastSmoke,
    drawnForecastSmoke,
    snowfall,
    drawnSnowfall,
    satelliteTime,
    // The same question about the frame a comparison is showing, which is
    // the only other frame on screen.
    compareSatelliteTime: satelliteFor(compareFrame),
  };
}
