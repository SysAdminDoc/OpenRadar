import { LoaderCircle, Radar } from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { SurfaceId, ToolMode } from "./components/CommandBar";
import { MapStage } from "./components/MapStage";
import { useAppearance } from "./hooks/useAppearance";
import { FirstRunReveal } from "./components/FirstRunReveal";
import { CatchUpCard } from "./components/CatchUpCard";
import { CuriosityCard } from "./components/CuriosityCard";
import { AmbientReadout } from "./components/AmbientReadout";
import { useCuriosities } from "./hooks/useCuriosities";
import type { Curiosity } from "./lib/curiosities";
import { useAmbient } from "./hooks/useAmbient";
import {
  appendJournalRow,
  journalRows,
  setJournalWriting,
  pictureDataUrl,
  thumbnailFrom,
} from "./lib/journal";
import { catchUpFrom, type CatchUp } from "./lib/catchUp";
import type { MapViewportHandle } from "./components/MapViewport";
import { CaptureBar } from "./components/CaptureBar";
import { WorkspaceChrome } from "./components/WorkspaceChrome";
import { useArchiveWarnings } from "./hooks/useArchiveWarnings";
import { alertsOfKind } from "./lib/overlays/alerts";
import { EMPTY_OVERLAY } from "./lib/overlays";
import {
  useMinuteClock,
  useReducedMotion,
  useSecondClock,
} from "./hooks/useClock";
import { useExport, type DataExportSource } from "./hooks/useExport";
import { useWorkspaceOverlays } from "./hooks/useWorkspaceOverlays";
import { useRadarTimeline } from "./hooks/useRadarTimeline";
import { useSettings } from "./hooks/useSettings";
import { useToasts, UNDO_LIFETIME_MS } from "./hooks/useToasts";
import type { UndoableRemoval } from "./components/ToastHost";
import { useAutostart } from "./hooks/useAutostart";
import { notificationPermission, type NotifyPermission } from "./lib/notify";
import {
  useApproachWatch,
  approachBody,
  approachTitle,
} from "./hooks/useApproachWatch";
import { approachesFor, type Approach } from "./lib/approach";
import {
  useLightningWatch,
  lightningBody,
  lightningTitle,
} from "./hooks/useLightningWatch";
import {
  loadAlertSound,
  keepSoundPath,
  setAlertSound,
  setAlertVolume,
  SOUND_EXTENSIONS,
} from "./lib/sound";
import {
  setCloseToTray,
  setGlanceOnTop,
  setTrayEnabled,
  glanceIsShowing,
  observedMsFrom,
  setTrayCopy,
  setTrayHazard,
  whenGlanceOpens,
  writeGlance,
} from "./lib/tray";
import {
  restoreWallpaper,
  wallpaperAvailable,
  wallpaperDue,
  writeWallpaperIfDue,
} from "./lib/wallpaper";
import { useWelcomeHint } from "./hooks/useWelcomeHint";
import { mrmsTimeFor, useMrmsOverlays } from "./hooks/useMrmsOverlays";
import { COUNTY_VINTAGE, loadCounties } from "./lib/counties";
import {
  crashReportAvailable,
  lastCrash as lastCrashDump,
  lastWebviewReport,
  rememberWebviewVersion,
  webviewVersion,
  type CrashRecord,
} from "./lib/crashReport";
import { useLightning } from "./hooks/useLightning";
import { usePalette } from "./hooks/usePalette";
import { useWind } from "./hooks/useWind";
import { useSingleSiteRadar } from "./hooks/useSingleSiteRadar";
import { useRadarStatus } from "./hooks/useRadarStatus";
import { statusFor } from "./lib/radarStatus";
import { useUpdates } from "./hooks/useUpdates";
import { useWorkspaceActions } from "./hooks/useWorkspaceActions";
import type { CommandAction } from "./lib/commands";
import type { GeoPoint } from "./lib/geo";
import { log, recentLog, subscribeLog } from "./lib/log";
import type { OverlayBounds } from "./lib/overlays";
import {
  providerHealth,
  satelliteFrameTime,
  subscribeHealth,
} from "./lib/providers";
import { frameAgeMinutes, type RadarFrame } from "./lib/radar";
import { useMeasurements } from "./lib/units";
import {
  archiveFrames,
  loadStorm,
  replayFocus,
  stormTrack,
  trackBounds,
  type Storm,
} from "./lib/hurdat";
import {
  basemapCredit,
  isLightBasemap,
  resolvedMapStyle,
} from "./lib/mapStyles";
import { level2Available } from "./lib/level2";
import { pairingById } from "./lib/alertPairings";
import { featureBounds } from "./lib/overlays";
import {
  alertId,
  WATCH_FAILURES_BEFORE_SAYING,
  type WatchAlert,
} from "./lib/watch";

/**
 * How long the map is left alone after the reader last moved it.
 *
 * Long enough that a warning does not interrupt somebody mid-look, short
 * enough that the next one still finds them.
 */
const FOLLOW_QUIET_MS = 20_000;

/**
 * How close going home gets, when the map was further out than that.
 *
 * A reader already looking at their own street stays there rather than being
 * pulled back out to a county: the camera only comes in, never out. Seven is
 * the zoom the storm archive flies to, which is a place and its weather in
 * one view.
 */
const HOME_ZOOM = 7;
import { dataExportAvailable, exportGridData } from "./lib/dataExport";
import { domainFor } from "./lib/providers/mrms";
import {
  bundleErrorText,
  bundleMissingNote,
  bundleReplay,
  bundlesAvailable,
  captureReplayBundle,
  captureRequestFor,
  closeReplayBundle,
  openReplayBundle,
  pickBundleFile,
} from "./lib/replayBundle";
import { createWorkspaceBackup, restoreWorkspace } from "./lib/workspaceBackup";
import type { ArchiveReplay } from "./hooks/useRadarTimeline";
import type {
  AppSettings,
  CameraState,
  LayerSettings,
  MapStyleId,
  RadarSettings,
} from "./lib/settings";
import {
  watchedPlaces,
  isDesktopRuntime,
  withPalette,
  withPaletteAssigned,
  withoutPalette,
} from "./lib/settings";
import {
  mergedOverlayShapes,
  overlayGates,
  type WorkspaceOverlayFile,
} from "./lib/workspaceOverlays";
import {
  formatNumber,
  translate,
  useLanguage,
  useT,
  type StringKey,
} from "./i18n";
import { fetchVwp, vwpAvailable } from "./lib/vwp";
import type { SpcHazard } from "./lib/overlays/registry";
import { diagnosticsBlock } from "./lib/diagnostics";
import { OVERLAY_ADAPTERS } from "./lib/overlays";
import {
  overlayProvenance,
  timelineProvenance,
  type Provenance,
} from "./lib/provenance";
import { LAYER_SOURCES, layerProvenance } from "./lib/layerProvenance";

/**
 * The layer switches whose records come from the overlay adapters instead.
 *
 * Both lists are complete, so anything here would otherwise be reported twice
 * under two slightly different names.
 */
const COVERED_BY_ADAPTERS = new Set(
  OVERLAY_ADAPTERS.map((adapter) => adapter.id as string),
);
import { useStormCells } from "./hooks/useStormCells";
import type { CellReport } from "./lib/cells";
import { useCellJournal } from "./hooks/useCellJournal";
import { cellKey, livingNames, withName } from "./lib/cellNames";
import { useClassification } from "./hooks/useClassification";
import { useForecastSmoke } from "./hooks/useForecastSmoke";
import {
  FORECAST_SMOKE_OPACITY,
  forecastSmokeCorners,
  forecastSmokeValid,
} from "./lib/forecastSmoke";
import { nearbyCells, nearbySummary, warningsOver } from "./lib/nearby";
import { activePalettes, paletteUnit } from "./lib/palette";
import { METAR_MIN_ZOOM } from "./lib/overlays/metar";
import { GAUGE_MIN_ZOOM } from "./lib/overlays/rivers";
import { useProbSevere } from "./hooks/useProbSevere";
import { gpuSupport } from "./lib/gpu";
import { NoGpu } from "./components/NoGpu";
import { useOfflineSince } from "./hooks/useOffline";
import { useStateNotices } from "./hooks/useStateNotices";

const PanelSurfaces = lazy(async () => {
  const module = await import("./components/PanelSurfaces");
  return { default: module.PanelSurfaces };
});

/**
 * How often the app writes down that it is still running.
 *
 * Read on the next launch to work out how long it was away, and compared
 * against a four-hour threshold, so five minutes of slack costs nothing and
 * saves fifty-five settings writes an hour.
 */
const LAST_SEEN_EVERY_MS = 5 * 60_000;

export default function App() {
  const t = useT();
  const [activeSurface, setActiveSurface] = useState<SurfaceId>(null);
  const [productOpen, setProductOpen] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolMode>(null);
  const [dualPane, setDualPane] = useState(false);
  const [compareOffset, setCompareOffset] = useState(0);
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  const [mapStatus, setMapStatus] = useState<
    "loading" | "ready" | "error" | "nogpu"
  >("loading");
  const [viewport, setViewport] = useState<OverlayBounds | null>(null);
  const [cursor, setCursor] = useState<GeoPoint | null>(null);
  // The readout is held as a way of writing itself. A measurement taken in
  // miles is still on screen when the units are switched, and a written string
  // cannot follow that; a renderer can.
  const [toolResult, setToolResult] = useState<(() => string) | null>(null);
  const showToolResult = useCallback(
    (render: (() => string) | null) => setToolResult(() => render),
    [],
  );
  // The two ends of a cross-section, once the tool has both. Held here rather
  // than in the map, because the panel that draws the slice outlives the tool.
  const [sectionLine, setSectionLine] = useState<{
    from: GeoPoint;
    to: GeoPoint;
  } | null>(null);
  const handleSection = useCallback((from: GeoPoint, to: GeoPoint) => {
    setSectionLine({ from, to });
    setProductOpen(false);
    setActiveSurface("section");
  }, []);
  const [route, setRoute] = useState<Record<string, unknown> | null>(null);
  // The local files a reader has put on the map, in drawing order. They live
  // here rather than in settings because the shapes themselves are not small
  // and are not something a settings file should carry; a workspace backup is
  // where they travel.
  const [overlayFiles, setOverlayFiles] = useState<WorkspaceOverlayFile[]>([]);
  const [capture, setCapture] = useState(false);
  /**
   * The full-screen view for a second monitor.
   *
   * The capture layout with a readout put back, so nothing is unmounted and
   * leaving it returns the workspace exactly as it was: the same panel open,
   * the same tool held, the same scroll.
   */
  const [ambientAsked, setAmbientAsked] = useState(false);
  /** When anybody last touched the machine, for the dimming and the slowing. */
  const [touchedAt, setTouchedAt] = useState(() => Date.now());
  const [historyStorm, setHistoryStorm] = useState<Storm | null>(null);

  // What the reader calls the storms the radar is tracking.
  //
  // Held for the session. The names themselves are never saved: a list of
  // storm names on disk beside the record would be a list of what somebody
  // was watching and when. A row in the record can quote one, because a storm
  // you named passing your house is the entry worth reading next year, but
  // that is a record of the weather rather than a saved list of names.
  const [cellNames, setCellNames] = useState<ReadonlyMap<string, string>>(
    new Map(),
  );

  const [replay, setReplay] = useState<ArchiveReplay | null>(null);
  const mapRef = useRef<MapViewportHandle>(null);
  const secondMapRef = useRef<MapViewportHandle>(null);

  const clock = useMinuteClock();
  const health = useSyncExternalStore(subscribeHealth, providerHealth);
  const logEntries = useSyncExternalStore(subscribeLog, recentLog);
  const toasts = useToasts();
  const pushToast = toasts.push;
  // Read from the machine rather than from settings: the Run entry is what
  // decides whether the watch is running after a reboot.
  const autostart = useAutostart();
  // Read once on open and again whenever a panel that shows it is opened: the
  // answer changes the moment a watch first asks Windows, and a reader who
  // went looking after a warning did not arrive is opening a panel to do it.
  const [notifications, setNotifications] =
    useState<NotifyPermission>("unasked");
  useEffect(() => {
    let open = true;
    void notificationPermission().then((answer) => {
      if (open) setNotifications(answer);
    });
    return () => {
      open = false;
    };
    // Also on the minute, because a refusal recorded while a panel is
    // already open would otherwise not show until it was closed and opened
    // again, and that is the panel a reader is on when they go looking.
  }, [activeSurface, clock]);

  const onPersistError = useCallback(
    () =>
      pushToast({
        title: translate("app.settingsNotSaved"),
        detail: translate("app.settingsNotSavedBody"),
      }),
    [pushToast],
  );
  const { settings, hydrated, settingsRef, applySettings, updateCamera } =
    useSettings({ onPersistError });

  // Everything the workspace can do is behind Commands and Layers, and nothing
  // on screen says either exists. One toast, once.
  const markWelcomeSeen = useCallback(() => {
    applySettings({ ...settingsRef.current, seenWelcome: true });
  }, [applySettings, settingsRef]);
  useWelcomeHint({
    ready: hydrated,
    seen: settings.seenWelcome,
    // Where the map opened, which is what the line is about.
    center: settings.camera.center,
    push: pushToast,
    onSeen: markWelcomeSeen,
  });

  // Every table in force, not "the table": a reflectivity scale and a velocity
  // scale can both be on at once, and the renderer picks per unit.
  const activeTables = useMemo(
    () => activePalettes(settings.palettes, settings.paletteAssignments),
    [settings.palettes, settings.paletteAssignments],
  );
  const paletteGeneration = usePalette({
    ready: hydrated,
    palettes: activeTables,
  });

  // How long since anybody touched the machine. Read by the readout for its
  // dimming, by the loop for how often it asks, and by the full-screen view
  // for whether to let itself in.
  const idleMs = clock - touchedAt;
  // One answer for the whole workspace, so the notice and the chrome cannot
  // disagree about whether the machine is on.
  const offlineSince = useOfflineSince();

  const timeline = useRadarTimeline({
    ready: hydrated,
    center: settings.camera.center,
    loopMinutes: settings.radar.loopMinutes,
    animationSpeed: settings.radar.animationSpeed,
    futureRadar: settings.radar.futureRadar,
    pageVisible,
    archive: replay,
    paletteGeneration,
    // How long nobody has touched anything, so a loop left on a second
    // monitor overnight asks for a newer picture four times an hour rather
    // than twelve. Nothing about the playback changes.
    idleMs,
    // The mosaic has a threshold of its own. It is composite reflectivity,
    // the strongest return anywhere in the column, and the single-site product
    // is one tilt of it; the same number means something different in each, so
    // setting a floor on the tilt must not quietly re-floor the mosaic.
    mosaicThreshold: settings.radar.thresholds.mosaic ?? null,
  });
  // True while a loop is being written out. Read by the site hook, which is
  // built before the export that sets it, so it travels as a ref.
  const writingLoopRef = useRef(false);
  const listingHeld = useCallback(() => writingLoopRef.current, []);

  // The moment the compare pane is on. Worked out here rather than from
  // `compareFrame` below, which is built after the site hook that needs it.
  const compareFrameTime =
    timeline.frameIndex >= compareOffset
      ? (timeline.frames[timeline.frameIndex - compareOffset]?.time ?? null)
      : null;

  const singleSite = useSingleSiteRadar({
    ready: hydrated,
    radar: settings.radar,
    center: settings.camera.center,
    zoom: settings.camera.zoom,
    pageVisible,
    paletteGeneration,
    // The moment the scrubber is stopped on, and nothing while it is running.
    //
    // A site's volumes are five minutes apart and the timeline runs on the
    // mosaic's steps, so this says which of the site's volumes the step on
    // screen belongs to: one scrubber, and the site picture follows it.
    //
    // Only while the loop is paused. The mosaic plays by default and steps
    // about once a second, and every step that crossed into a different
    // volume asked the archive for a ten megabyte object: a loop left running
    // on a second monitor would have pulled a volume a second from a public
    // bucket for as long as the window was open. A reader who wants to look
    // at an older volume stops on it, which is also when they are looking.
    showingTime:
      !timeline.playing && timeline.frames[timeline.frameIndex]?.time
        ? timeline.frames[timeline.frameIndex].time * 1000
        : null,
    // The moment the second pane is on, under the same rule as the first: a
    // held site's own volume for that step rather than the mosaic's picture
    // of it. Only while the scrubber is stopped and the pane is open.
    compareTime:
      dualPane && !timeline.playing && compareFrameTime !== null
        ? compareFrameTime * 1000
        : null,
    listingHeld,
  });

  // What the last run left behind, when it ended abnormally. Asked once, at
  // start-up: the answer cannot change while this process is alive, because
  // the only thing that writes one is this process dying.
  const [lastCrash, setLastCrash] = useState<CrashRecord | null>(null);
  /**
   * The newest report the WINDOW left, and which Chromium is drawing.
   *
   * Read once beside the crash dump and on the same terms: neither can change
   * while this process is alive, and neither leaves the machine.
   */
  const [lastWebviewCrash, setLastWebviewCrash] = useState<CrashRecord | null>(
    null,
  );
  /**
   * Undefined until it has been asked, which the report writes as unknown.
   * Null means there is no native runtime, which is the browser preview, and
   * a native window that will not say its version rejects rather than
   * answering null: the two are different things and the report says which.
   */
  const [webviewRuntime, setWebviewRuntime] = useState<
    string | null | undefined
  >(undefined);
  // Asked in every runtime, unlike the two crash lookups: the browser preview
  // has an answer here and it is "there is no native runtime".
  useEffect(() => {
    let open = true;
    void webviewVersion()
      .then((version) => {
        rememberWebviewVersion(version);
        if (open) setWebviewRuntime(version);
      })
      .catch(() => {
        // The runtime would not say. Left undefined, which the report writes
        // as unknown rather than as a failure a reader has to act on.
      });
    return () => {
      open = false;
    };
  }, []);
  useEffect(() => {
    if (!crashReportAvailable()) return;
    let open = true;
    void lastWebviewReport()
      .then((found) => {
        if (open) setLastWebviewCrash(found);
      })
      .catch(() => {
        // No folder is the ordinary state: it exists once the runtime has had
        // something to report.
      });
    void lastCrashDump()
      .then((found) => {
        if (open) setLastCrash(found);
      })
      .catch(() => {
        // Nothing to say is the ordinary state, and a report that cannot be
        // read is not itself worth a line in the log.
      });
    return () => {
      open = false;
    };
  }, []);

  // Whether the county outlines are on the map, as opposed to switched on.
  // The file is a megabyte read on demand and it can fail; a report listing a
  // layer that drew nothing describes a picture the reader cannot see, which
  // is what the guards above it are for.
  const [countiesLoaded, setCountiesLoaded] = useState(false);
  useEffect(() => {
    if (!settings.layers.counties) return;
    let open = true;
    void loadCounties()
      .then(() => {
        if (open) setCountiesLoaded(true);
      })
      .catch(() => {
        if (open) setCountiesLoaded(false);
      });
    return () => {
      open = false;
    };
  }, [settings.layers.counties]);
  // Derived rather than written from inside the effect, which would be a
  // state change on every render that turned the switch off.
  const countiesDrawn = settings.layers.counties && countiesLoaded;

  // Which volume the map is actually showing, for anything that has to act
  // on the picture rather than on the request. A ref because the export walk
  // reads it from inside a loop that started renders ago.
  const drawnVolumeRef = useRef<number | null>(null);
  useEffect(() => {
    drawnVolumeRef.current = singleSite.drawnVolume;
  }, [singleSite.drawnVolume]);

  // What the office says about every radar, while a site is on the map. One
  // request for the whole country, so there is nothing to narrow, and a
  // reader watching the national mosaic has no use for it.
  const siteStatus = useRadarStatus({
    enabled: singleSite.station !== null,
    pageVisible,
  });

  // Only that a warning was announced. Whether to fly to it, and where to,
  // are settled in the effect below, which can see the polygon and the state
  // of the export.
  //
  // The alert itself is held in a ref and the effect is woken by a counter,
  // because the effect consumes it: clearing a piece of state from inside the
  // effect that reads it is a cascading render, and clearing a ref is not.
  const pendingFollowRef = useRef<WatchAlert | null>(null);
  const [followSignal, setFollowSignal] = useState(0);
  const rememberFollow = useCallback((alert: WatchAlert) => {
    pendingFollowRef.current = alert;
    setFollowSignal((was) => was + 1);
  }, []);

  // The frame that was on screen, small, for whatever the record writes down
  // next. Null when there is no map yet or the picture comes back over its
  // budget, which is a row without a picture rather than no row.
  // The record's own switch, told to the module that writes it rather than
  // passed to each of the three things that write rows: the rule is about the
  // file, and a fourth writer added later should not have to remember it.
  useEffect(() => {
    setJournalWriting(settings.journal);
  }, [settings.journal]);

  useEffect(() => {
    setAlertVolume(settings.alertVolume);
  }, [settings.alertVolume]);

  /**
   * Asks for a sound file of the reader's own.
   *
   * The path is what is kept. Whether it can actually be used is decided by
   * the effect below, in one place, so a file that stops working later is
   * reported the same way as one that never worked.
   */
  const chooseAlertSound = useCallback(async () => {
    if (!isDesktopRuntime()) {
      // Said rather than swallowed. A button that does nothing at all is the
      // one thing worse than a button that fails.
      pushToast({
        title: translate("alerts.soundFileFailed"),
        detail: translate("journal.desktopOnly"),
      });
      return;
    }
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const chosen = await open({
        multiple: false,
        filters: [{ name: "Audio", extensions: SOUND_EXTENSIONS }],
      });
      if (typeof chosen !== "string") return;
      applySettings({ ...settingsRef.current, alertSoundPath: chosen });
    } catch (failure) {
      pushToast({
        title: translate("alerts.soundFileFailed"),
        detail:
          failure instanceof Error
            ? failure.message
            : translate("alerts.soundFile.decode"),
      });
    }
  }, [applySettings, pushToast, settingsRef]);

  // Read once, when the path changes. A file that has moved away, grown too
  // big or stopped being audio is reported here and the built-in kit answers
  // instead, rather than a warning arriving in silence.
  useEffect(() => {
    const path = settings.alertSoundPath;
    setAlertSound(path);
    if (!path) return;
    // Guarded, because choosing a second file while the first is still being
    // read used to let the older answer land last: it cleared the sound that
    // had just loaded and blamed a file the reader had already replaced.
    let current = true;
    void loadAlertSound(path).then((answer) => {
      if (!current || answer.ok) return;
      setAlertSound(null);
      pushToast({
        title: translate("alerts.soundFileFailed"),
        detail: translate(`alerts.soundFile.${answer.reason}`),
      });
      // Said once, then stop naming it.
      if (keepSoundPath(answer.reason)) return;
      applySettings({ ...settingsRef.current, alertSoundPath: null });
    });
    return () => {
      current = false;
    };
  }, [settings.alertSoundPath, pushToast, applySettings, settingsRef]);

  const journalFrame = useCallback(async () => {
    const canvas = mapRef.current?.canvas();
    return canvas ? await thumbnailFrom(canvas) : null;
  }, []);

  const overlays = useWorkspaceOverlays({
    settings,
    viewport,
    pushToast,
    setActiveSurface,
    // Today's warnings cannot sit on a volume from another day.
    replaying: replay !== null || singleSite.historical,
    // The window a replay is showing, for the two layers that can answer
    // for the day it is showing rather than being held back.
    replayWindow:
      replay && replay.frames.length
        ? {
            from: replay.frames[0].time * 1000,
            to: replay.frames[replay.frames.length - 1].time * 1000,
          }
        : null,
    onAnnounced: rememberFollow,
    capture: journalFrame,
  });

  // The words before the icon, so the first tray a reader ever sees is
  // already in their own language rather than English for a moment.
  useEffect(() => {
    void setTrayCopy({
      open: translate("tray.menuOpen"),
      glance: translate("tray.menuGlance"),
      quit: translate("tray.menuQuit"),
      quiet: translate("tray.quiet"),
      warning: translate("tray.warning"),
      unreachable: translate("tray.unreachable"),
    });
  }, [settings.language]);

  useEffect(() => {
    void setTrayEnabled(settings.tray);
  }, [settings.tray]);

  useEffect(() => {
    // With the tray off there is nothing to close to, so the window closes
    // the app whatever this says.
    void setCloseToTray(settings.tray && settings.closeToTray);
  }, [settings.closeToTray, settings.tray]);

  // The startup entry cannot outlive the icon it opens to.
  //
  // A reader who ticks "Start with Windows" and later removes the tray icon
  // would otherwise get the map across their screen at every sign-in, with the
  // one switch that could stop it greyed out because it needs the icon. So
  // taking the icon away takes the entry with it, which is what the disabled
  // switch has been saying all along.
  useEffect(() => {
    if (settings.tray || autostart.on !== true) return;
    autostart.set(false);
  }, [autostart, settings.tray]);

  useEffect(() => {
    void setGlanceOnTop(settings.glanceOnTop);
  }, [settings.glanceOnTop]);

  // The icon says one thing: whether a warning stands at a place the reader
  // named. Not how many, not what the app is doing.
  useEffect(() => {
    if (settings.tray) {
      // A watch that has stopped hearing back says so under the icon.
      // Not in its colour: the colour means weather, and an amber dot
      // for "the app is having trouble" would compete with that.
      void setTrayHazard(
        overlays.alertActive,
        overlays.watchFailing < WATCH_FAILURES_BEFORE_SAYING,
      );
    }
  }, [overlays.alertActive, overlays.watchFailing, settings.tray]);

  // Whether the small window is actually open. Asked on the clock rather
  // than assumed, because it can be opened from the tray menu, which the
  // workspace never hears about.
  const [glanceOpen, setGlanceOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    void glanceIsShowing().then((showing) => {
      if (alive) setGlanceOpen(showing);
    });
    return () => {
      alive = false;
    };
  }, [clock, settings.tray]);
  // The poll is once a minute, which is fine for noticing the window has gone
  // and far too slow for noticing it arrived: opened from the tray menu, the
  // reader watched a small window with words and no map. The window says so
  // itself now, and the write below runs on the same render.
  useEffect(() => {
    let stop: (() => void) | null = null;
    let alive = true;
    void whenGlanceOpens(() => setGlanceOpen(true)).then((unlisten) => {
      if (alive) stop = unlisten;
      else unlisten();
    });
    return () => {
      alive = false;
      stop?.();
    };
  }, []);
  // With no tray there is no way to have opened it, whatever the last answer
  // was. Derived rather than written back, so the answer arriving late cannot
  // undo the switch.
  const glanceShowing = settings.tray && glanceOpen;

  /**
   * What the small window shows, handed over rather than drawn again.
   *
   * A second live map would be a second WebGL context and a few hundred
   * megabytes for a window whose whole job is one glance, so the workspace
   * puts the frame it has already drawn where that window can read it. On the
   * clock, because that window is asking on a clock of its own.
   */
  useEffect(() => {
    if (!settings.tray) return;
    void (async () => {
      // The picture only when there is a window to look at it. Reading the
      // map back, rescaling it and encoding a PNG once a minute is real work,
      // and the tray is on by default, so every reader was paying it for a
      // window most of them have never opened. The words are cheap and go
      // either way, so the window has something to show the moment it opens.
      const canvas = glanceShowing ? mapRef.current?.canvas() : null;
      const picture = canvas ? await thumbnailFrom(canvas) : null;
      await writeGlance({
        place: settings.watch.name?.trim() ?? "",
        warning: overlays.alertActive,
        headline: overlays.announcement.text,
        picture: picture ? pictureDataUrl(picture) : "",
        observedMs: observedMsFrom(timeline.newestObserved),
        source: timeline.sourceLabel ?? "",
        at: Date.now(),
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock, glanceShowing, overlays.alertActive, settings.tray]);

  // What the window looks like: the built-in look, a theme the reader
  // loaded, and the season, in that order of who asked for what. A warning in
  // force at a watched place stands the seasonal pack down for as long as it
  // stands.
  const appearance = useAppearance(settings, clock, overlays.alertActive);

  const reducedMotion = useReducedMotion();

  // The disc drawing itself, once, on a first run. Rendered over a map that
  // is already live and gone the moment anybody does anything, so it greets
  // rather than gates. Nothing at all under reduced motion, because the whole
  // of it is the motion.
  const revealing = hydrated && !settings.seenReveal && !reducedMotion;

  // What the weather did at the reader's places while the app was closed.
  //
  // The gap is measured from the last time the app was running, which is read
  // once, at hydration, before the clock below starts writing it again. Read
  // out of the record on the disk: nothing is fetched to answer this, so it
  // cannot claim a warning stood somewhere it did not.
  const [catchUp, setCatchUp] = useState<CatchUp | null>(null);
  const [catchUpGone, setCatchUpGone] = useState(false);
  const awaySince = useRef<number | null>(null);
  useEffect(() => {
    if (!hydrated || awaySince.current !== null) return;
    awaySince.current = settingsRef.current.lastSeen;
    if (!settingsRef.current.catchUp) return;
    const since = awaySince.current;
    void journalRows().then((rows) => {
      setCatchUp(catchUpFrom(rows, since, Date.now()));
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
  // Stable, or the effect that owns the sweep's timer restarts on every
  // render of the app and the flag is never written.
  const markRevealSeen = useCallback(() => {
    applySettings({ ...settingsRef.current, seenReveal: true });
  }, [applySettings, settingsRef]);

  // The weather where the reader watches, on the chrome. A data attribute
  // rather than an element, so the effect is one background image on the
  // command bar and there is no way for it to reach the map: see the
  // `[data-ambient]` rules in `index.css`.
  const ambient = useAmbient({
    // The place has to be one the reader chose. Without a watch there is only
    // the default centre, and a reader in Oslo does not want Dallas' rain.
    enabled: settings.ambient && settings.watch.enabled,
    center: settings.watch.center,
    clock,
    reducedMotion,
    pageVisible,
  });
  useEffect(() => {
    const root = document.documentElement;
    // It stands down with everything else while a warning is in force at a
    // watched place.
    if (ambient.seen && !overlays.alertActive) {
      root.dataset.ambient = ambient.seen.condition;
    } else {
      delete root.dataset.ambient;
    }
  }, [ambient.seen, overlays.alertActive]);

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
    const home = settings.watch.name?.trim();
    if (!settings.watch.enabled || !home || !ambient.seen) return;
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
  }, [ambient.seen, journalFrame, settings.watch.enabled, settings.watch.name]);

  // One line, once a year, the first time a pack is on screen. It carries the
  // way to send that occasion away until next year; the switch that ends them
  // for good is in Settings, because a toast is not where somebody makes a
  // decision they will not revisit.
  useEffect(() => {
    const { occasion, year, showing } = appearance;
    if (!showing || !occasion) return;
    // Not until the stored settings are in. Before they are, `settings` is
    // the defaults, so writing to them here saved a file of defaults over the
    // reader's own workspace and then gave the notice a second time once the
    // real file arrived.
    if (!hydrated) return;
    const current = settingsRef.current;
    if (current.occasions.seen[occasion] === year) return;
    applySettings({
      ...current,
      occasions: {
        ...current.occasions,
        seen: { ...current.occasions.seen, [occasion]: year },
      },
    });
    pushToast({
      title: translate(`occasion.${occasion}` as StringKey),
      detail: translate("occasion.notice"),
      actionLabel: translate("occasion.notThisYear"),
      onAction: () => {
        const now = settingsRef.current;
        applySettings({
          ...now,
          occasions: {
            ...now.occasions,
            declined: { ...now.occasions.declined, [occasion]: year },
          },
        });
      },
    });
  }, [appearance, applySettings, hydrated, pushToast, settingsRef]);

  // Take the map to a warning as it arrives, when the reader asked for that.
  //
  // Through a ref because the watch is inside the hook that produces the
  // alerts this reads: the callback has to exist before the hook is called
  // and see the state that comes out of it.

  // The layer that explains a warning, from the warning's own popup.
  //
  // Switches only. It does not move the camera, does not restyle the
  // polygon, and does not touch the warning's own presentation: the pairing
  // is a suggestion about where to look rather than a claim about the hazard.
  const applyPairing = useCallback(
    (id: string) => {
      const pairing = pairingById(id);
      if (!pairing) return;
      const current = settingsRef.current;
      const next: AppSettings = {
        ...current,
        layers: { ...current.layers, ...pairing.layers },
      };
      if (pairing.radarProduct) {
        next.radar = { ...current.radar, product: pairing.radarProduct };
      }
      applySettings(next);
      const names = Object.keys(pairing.layers)
        .map((key) => translate(`layer.${key}` as "layer.metar"))
        .join(", ");
      pushToast({
        title: translate("pairing.shown", { layer: names }),
        detail: translate("pairing.shownBody"),
        actionLabel: translate("toast.undo"),
        onAction: () => applySettings(current),
      });
    },
    [applySettings, pushToast, settingsRef],
  );

  // A test the reader asked for is answered on the desktop path only. When the
  // notification does not go out, the watch has already put the same alert in
  // front of them as a toast, and a second message saying it worked would be
  // the app talking about itself rather than about the weather.
  const sendWatchTest = useCallback(() => {
    void (async () => {
      const delivered = await overlays.sendWatchTest();
      if (delivered) {
        pushToast({
          title: translate("watch.testSent"),
          detail: translate("watch.testSentBody"),
        });
      }
    })();
  }, [overlays, pushToast]);

  // The third of the three things that open an entry in the record, after a
  // warning reaching a named place and the sky changing at one. All three are
  // the weather doing something; nothing the reader does writes a row.
  const watchedForJournal = useMemo(
    () => watchedPlaces(settings),
    // The watched places and nothing else. Keyed on the whole settings object
    // this rebuilt on every write, which restarted the effect below with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.watch, settings.watchPlaces],
  );

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
      [],
    ),
  });

  const nameCell = useCallback(
    (id: string, name: string) => {
      const station = stormCells.report?.station;
      if (!station) return;
      setCellNames((held) => withName(held, cellKey(station, id), name));
    },
    [stormCells.report?.station],
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

  // The satellite image that stands for a frame, held back to the newest slot
  // the archive has actually published.
  const satelliteFor = (frame: RadarFrame | undefined) =>
    settings.layers.satellite && !singleSite.historical && frame
      ? satelliteFrameTime(frame.time, Math.floor(clock / 1000))
      : null;
  const satelliteTime = satelliteFor(activeFrame);

  const updates = useUpdates({ onToast: pushToast });
  const actions = useWorkspaceActions({
    hydrated,
    mapRef,
    settingsRef,
    applySettings,
    pushToast,
    setActiveSurface,
    setOverlayFiles,
    overlayFiles,
  });
  // What the map actually draws: the enabled files, in order, as one
  // collection. Derived rather than kept beside the set, so a switch or a
  // slider cannot leave the two disagreeing.
  // A placefile can say a shape belongs inside a range and between two times.
  // Whether any imported file says either is worked out once per change to the
  // set, so a file that says neither is not rebuilt every time the map moves
  // or the loop steps, which is the common case and most of them.
  const gates = useMemo(() => overlayGates(overlayFiles), [overlayFiles]);
  const gateZoom = gates.zoomed ? Math.floor(settings.camera.zoom) : null;
  const gateMinute = gates.timed
    ? Math.floor((activeFrame?.time ?? clock / 1000) / 60)
    : null;
  // The volume times the wind profile is drawn for, as the archive names
  // them. Held rather than rebuilt inline, because the panel refetches on any
  // change to this list and a new array every render would ask forever.
  const vwpTimes = useMemo(
    () => singleSite.volumes.map((at) => new Date(at).toISOString()),
    [singleSite.volumes],
  );

  const overlayShapes = useMemo(
    () =>
      mergedOverlayShapes(
        overlayFiles,
        gateZoom ?? Number.POSITIVE_INFINITY,
        gateMinute === null ? null : gateMinute * 60_000,
      ),
    [overlayFiles, gateZoom, gateMinute],
  );

  // What is drawn right now that has numbers behind it: the sweep, and every
  // grid on the map. A grid is cut to the view rather than written whole,
  // because the whole of one is a continent and nobody asked for a continent.
  const dataSources = useMemo(() => {
    if (!dataExportAvailable()) return [];
    const offers: DataExportSource[] = [];
    if (singleSite.exportValues) {
      const write = singleSite.exportValues;
      offers.push({
        id: "sweep",
        label: singleSite.sweep?.product ?? t("export.dataRadar"),
        // Named for the sweep on screen, and the hook sends that sweep's own
        // product rather than the setting, so a switch still in flight cannot
        // label one product and write another.
        format: "csv",
        // A sweep is a fan around its site rather than a rectangle, so the
        // view has nothing to say about which gates are in it.
        run: () => write(),
      });
    }
    // The picture on the map is a grid too when MRMS is drawing it, and it is
    // the one a reader is most likely to want the numbers behind.
    const frame = frames[frameIndex];
    if (frame?.providerId === "mrms") {
      offers.push({
        id: "grid:composite",
        label: t("export.dataComposite"),
        format: "tif",
        run: (view) =>
          view
            ? exportGridData({
                product: "composite",
                time: frame.time,
                domain:
                  domainFor([
                    (view.west + view.east) / 2,
                    (view.south + view.north) / 2,
                  ])?.id ?? null,
                west: view.west,
                south: view.south,
                east: view.east,
                north: view.north,
              })
            : Promise.reject(new Error(t("export.dataNoView"))),
      });
    }
    for (const layer of mrms.layers) {
      offers.push({
        id: `grid:${layer.product}`,
        label: t(layer.labelKey),
        format: "tif",
        // Cut to the view at the moment the button is pressed. The whole of
        // one of these grids is a continent, and nobody asked for a continent.
        run: (view) =>
          view
            ? exportGridData({
                product: layer.product,
                time: layer.time,
                west: view.west,
                south: view.south,
                east: view.east,
                north: view.north,
              })
            : Promise.reject(new Error(t("export.dataNoView"))),
      });
    }
    return offers;
    // Through `t` rather than the module's own translate, so the list is
    // built again when the language changes: it is built once otherwise, and
    // a switch mid-session left these labels in the language before it.
  }, [
    frameIndex,
    frames,
    mrms.layers,
    singleSite.exportValues,
    singleSite.sweep?.product,
    t,
  ]);

  const exportState = useExport({
    mapRef,
    frames,
    frameIndex,
    source,
    timeline,
    // The map under the weather, for the style on screen: an aerial picture
    // credits USGS and a topographic one credits OpenTopoMap, rather than
    // both crediting a service that did not draw them.
    basemapCredit: basemapCredit(
      settings.mapStyle,
      settings.theme,
      settings.incidentPacks.references.find(
        (pack) => pack.id === settings.incidentPacks.selectedId,
      ) ?? null,
    ),
    dataSources,
    // The picture on the canvas, so a still of any single-site sweep is
    // credited to that radar rather than to the mosaic underneath it.
    sweep: singleSite.sweep,
    // A saved loop of a held site is that site's volumes. The mosaic's steps
    // are what the timeline runs on, and they are two minutes apart against
    // a radar's four to six, so walking them wrote the same volume two and
    // three times over under mosaic timestamps.
    arrivedAt: singleSite.arrivedAt,
    // Read when it is asked, like the loop's own: a volume can arrive
    // between the button and the file.
    drawnVolume: () => drawnVolumeRef.current,
    siteLoop:
      singleSite.sweep && singleSite.volumes.length > 1
        ? {
            sweep: singleSite.sweep,
            volumes: singleSite.volumes,
            // Read when the walk asks, not when the button was pressed. The
            // whole point is to notice a volume arriving after the click.
            drawnVolume: () => drawnVolumeRef.current,
          }
        : null,
    pushToast,
  });

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
    let alive = true;
    void wallpaperAvailable().then((ok) => {
      if (alive) setWallpaperOk(ok);
    });
    return () => {
      alive = false;
    };
  }, []);
  const { writeWallpaper } = exportState;
  useEffect(() => {
    if (!wallpaperOk || wallpaperBusy.current) return;
    if (!wallpaperDue(settings.wallpaperMinutes, wallpaperAt.current, clock)) {
      return;
    }
    wallpaperBusy.current = true;
    void (async () => {
      try {
        wallpaperAt.current = await writeWallpaperIfDue({
          everyMinutes: settings.wallpaperMinutes,
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
    // `exportState` is a fresh object every render, so the callback is
    // depended on rather than the whole of it.
  }, [
    clock,
    frames.length,
    pushToast,
    settings.wallpaperMinutes,
    wallpaperOk,
    writeWallpaper,
  ]);

  // Switched off puts the reader's own wallpaper back, which is the whole
  // reason this is safe to have at all.
  const hadWallpaper = useRef(false);
  useEffect(() => {
    if (settings.wallpaperMinutes > 0) {
      hadWallpaper.current = true;
      return;
    }
    if (!hadWallpaper.current) return;
    hadWallpaper.current = false;
    void restoreWallpaper();
  }, [settings.wallpaperMinutes]);

  // The flight happens here rather than where the alert is announced, because
  // the watch speaks the moment it sees a warning and the polygon it is about
  // reaches this component on the render after that.
  useEffect(() => {
    const alert = pendingFollowRef.current;
    if (!alert) return;
    // One attempt per announcement, and the announcement is spent here
    // whatever happens next. Holding it until the alerts layer has something
    // to search flies to a warning minutes later out of nowhere, and the
    // layer is empty for the whole of a replay and any time the reader has
    // warnings switched off, which is exactly when the watch is still
    // announcing.
    pendingFollowRef.current = null;
    const drawn = overlays.data.alerts;
    if (!drawn) return;
    if (!settingsRef.current.followNewWarnings) return;
    // Not while a picture or a loop is being written: the export walks the
    // camera itself, and a warning arriving mid-recording would put a flight
    // in the middle of somebody's video.
    if (exportState.busy) return;
    // And not off somebody who is using the map. MapLibre stops a flight the
    // moment a gesture starts, which covers an interruption; this is the
    // other half, which is not starting one over a reader's shoulder.
    const touched = mapRef.current?.interactedAt() ?? null;
    if (touched !== null && Date.now() - touched < FOLLOW_QUIET_MS) return;

    // The same identity the watch decided by, from the same function, so a
    // warning it announced is the warning that is flown to.
    let box: OverlayBounds | null = null;
    for (const feature of drawn.features) {
      const bounds = featureBounds(feature.geometry);
      if (!bounds) continue;
      if (alertId(feature.properties, bounds) === alert.id) {
        box = bounds;
        break;
      }
    }
    if (!box) return;
    mapRef.current?.fitBounds(box);
    pushToast({
      title: translate("follow.went", { headline: alert.headline }),
      detail: translate("follow.wentBody"),
      actionLabel: translate("follow.stop"),
      onAction: () =>
        applySettings({ ...settingsRef.current, followNewWarnings: false }),
    });
    // Deliberately not depending on the drawn alerts: this runs when a
    // warning is announced and reads whatever the layer holds at that moment.
    // Waking it again when the layer changes is how a spent announcement came
    // back to life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applySettings, exportState.busy, followSignal, pushToast, settingsRef]);

  useEffect(() => {
    const onVisibility = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Where the camera came to rest, which is the only moment anything is
  // looked for. Held apart from the settings camera, which is written on a
  // debounce and is a record of where to open next time rather than a signal.
  const [resting, setResting] = useState<{
    center: [number, number];
    zoom: number;
  } | null>(null);
  const [curiosity, setCuriosity] = useState<Curiosity | null>(null);

  // Any of the ordinary ways somebody says they are still there. Recorded
  // rather than reacted to: the readout dims itself off this and the loop
  // slows itself off this, and neither of them wants a render per keystroke.
  useEffect(() => {
    const touched = () => setTouchedAt(Date.now());
    const events = ["pointerdown", "keydown", "wheel"] as const;
    for (const name of events)
      window.addEventListener(name, touched, { passive: true });
    return () => {
      for (const name of events) window.removeEventListener(name, touched);
    };
  }, []);

  /**
   * Whether the full-screen view is actually on, worked out rather than kept.
   *
   * Three things decide it and all three are already known during a render:
   * whether the reader asked for it, whether they have been away long enough
   * to have asked for it by default, and whether a warning is standing at a
   * place they watch. Writing it into state from an effect would cascade a
   * render for each of them, and the warning case would then have to be
   * undone by hand when the warning cleared.
   *
   * A warning takes it down and puts the workspace back, because the whole
   * point of the app is the thing that just happened, and a second monitor
   * showing a clean loop through it is the app hiding its own reason to
   * exist. It comes back when the warning does not stand any more.
   */
  const ambientScreen =
    (ambientAsked ||
      (settings.ambientIdleMinutes > 0 &&
        idleMs >= settings.ambientIdleMinutes * 60_000)) &&
    !overlays.alertActive;

  const handleCameraChange = useCallback(
    (camera: CameraState) => {
      updateCamera(camera);
      setViewport(mapRef.current?.bounds() ?? null);
      setResting({ center: camera.center, zoom: camera.zoom });
    },
    [updateCamera],
  );

  useCuriosities({
    // Nothing discoverable reveals itself while a warning is in force at a
    // watched place. The standing rule, and the reason this is safe to ship.
    enabled:
      hydrated &&
      settings.curiosities &&
      // Nothing discoverable in the calmer presentation either: somebody who
      // asked for less is not asking to be surprised.
      !settings.calm &&
      !overlays.alertActive &&
      !replay,
    camera: resting,
    already: settings.curiositiesFound,
    onFound: useCallback(
      (found: Curiosity) => {
        setCuriosity(found);
        applySettings({
          ...settingsRef.current,
          curiositiesFound: [...settingsRef.current.curiositiesFound, found.id],
        });
      },
      [applySettings, settingsRef],
    ),
  });

  // A walk of thirty volumes outlives the listing's own refresh, and a
  // refresh drops the oldest volume to make room for the newest. Held still,
  // the walk finishes against the list it started with.
  useEffect(() => {
    writingLoopRef.current =
      exportState.busy === "loop" || exportState.busy === "gif";
  }, [exportState.busy]);

  const handleMapStatus = useCallback(
    (status: "loading" | "ready" | "error" | "nogpu") => {
      setMapStatus(status);
      if (status === "ready") setViewport(mapRef.current?.bounds() ?? null);
    },
    [],
  );

  const handleTool = useCallback((tool: ToolMode) => {
    setActiveSurface(null);
    setProductOpen(false);
    setActiveTool(tool);
    if (!tool) {
      mapRef.current?.clearTools();
      secondMapRef.current?.clearTools();
    }
  }, []);

  // The labels on the points are the reader's own words now, not the
  // archive's codes, so this has to be rebuilt when the language changes.
  // Keyed on the storm alone it was correct while the label was "TS 65 kt"
  // and wrong the moment it became a sentence: every panel turned French and
  // the points on the map stayed English until the storm was picked again.
  const spoken = useLanguage();
  const stormTrackData = useMemo(
    () => (historyStorm ? stormTrack(historyStorm) : null),
    // `spoken` reads as unused because `stormTrack` reaches the catalogue
    // through the module rather than through an argument. It is the reason
    // this is rebuilt at all.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [historyStorm, spoken],
  );

  /**
   * Escape, from anywhere the panel did not already handle it.
   *
   * A panel stops its own Escape (`PanelShell`), and a native listener on
   * `window` sits above the root React attaches to, so this never runs twice
   * for one press: checked in a browser rather than assumed. What it covers
   * is everywhere else. A reader who opened Layers, tabbed out to the map and
   * pressed Escape got nothing at all, and the drawing, range and section
   * tools had no keyboard way out: the only exit was the Clear button in the
   * tool strip, which is a mouse target.
   *
   * One press dismisses one thing. The panel goes first, and only if there
   * is no panel does the tool go: a tool and a surface can be open together,
   * and `handleTool(null)` is the Clear button, which also wipes whatever has
   * been drawn. Taking the tool first meant a single Escape closed the panel,
   * put the tool away and erased the reader's measurement, three things they
   * asked for one of.
   *
   * Nothing at all while a full-screen mode is on. Both of those promise the
   * workspace comes back exactly as it was, panel and tool included, and the
   * same press is already what leaves them.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (capture || ambientScreen) return;
      if (activeSurface || productOpen) {
        setActiveSurface(null);
        setProductOpen(false);
        return;
      }
      if (activeTool) handleTool(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    activeTool,
    activeSurface,
    ambientScreen,
    capture,
    productOpen,
    handleTool,
  ]);

  // What the workspace only showed, said out loud once per transition. A
  // reader who cannot see the greyed chip, the note in the Layers panel or
  // the reason written into the timeline heard none of the three.
  useStateNotices({
    offline: offlineSince !== null,
    failing: OVERLAY_ADAPTERS.filter(
      (adapter) => overlays.states[adapter.id]?.error,
    ).map((adapter) => ({ id: adapter.id, nameKey: adapter.nameKey })),
    timelineError: timeline.error,
    push: pushToast,
  });

  // Picking a storm frames its whole track; replaying one goes to the moment
  // the radar is about, which is a much tighter view.
  const showStorm = useCallback((storm: Storm | null) => {
    setHistoryStorm(storm);
    setReplay(null);
    if (storm) mapRef.current?.fitBounds(trackBounds(storm.track));
  }, []);

  /**
   * A storm chosen by name in the search.
   *
   * The track is loaded here and handed to the same place a Storm history
   * result goes, so the track is drawn and the replay is offered exactly
   * where the archive reaches. A name the record does not hold, or a decade
   * file that will not load, leaves the workspace as it was and says so.
   */
  const showStormById = useCallback(
    (id: string) => {
      void loadStorm(id)
        .then((storm) => {
          showStorm(storm);
          setActiveSurface("history");
        })
        .catch((failure: unknown) =>
          pushToast({
            title: translate("history.unknownStorm"),
            detail:
              failure instanceof Error
                ? failure.message
                : translate("history.unknownStorm"),
          }),
        );
    },
    [pushToast, showStorm],
  );

  const replayStorm = useCallback(
    (storm: Storm) => {
      const frames = archiveFrames(storm);
      const focus = replayFocus(storm);
      if (!frames.length || !focus) return;
      setHistoryStorm(storm);
      setReplay({
        id: storm.id,
        label: translate("radar.archive"),
        attributionUrl: "https://mesonet.agron.iastate.edu/",
        frames,
        focusTime: focus.point[0],
      });
      mapRef.current?.flyTo({
        center: [focus.point[2], focus.point[1]],
        zoom: 7,
        bearing: 0,
        pitch: 0,
      });
      pushToast({
        title: translate("replay.title", {
          name: storm.name,
          year: storm.year,
        }),
        detail: translate(
          focus.landfall ? "replay.atLandfall" : "replay.atClosest",
        ),
      });
    },
    [pushToast],
  );

  // There is no tracker to round-trip through, so the first message somebody
  // sends about a problem has to carry enough to work with. Everything in the
  // block goes through the redaction: a radar workspace knows where its reader
  // lives to four decimal places, and their account name from every path it
  // has ever logged.
  const copyDiagnostics = useCallback(
    (withPlace: boolean) => {
      const now = Date.now();
      // What is actually on the map right now, each layer saying where it came
      // from and what it claims. Only the frame on screen and the overlays that
      // are both switched on and holding data, because a record for something
      // the reader cannot see would be describing a different picture from the
      // one they are writing about.
      const layers: Provenance[] = [];
      const shown = timelineProvenance({
        frames: timeline.frames,
        frameIndex: timeline.frameIndex,
        provider: timeline.source,
        fetchedAt: timeline.fetchedAt,
        cachedAgeSeconds: timeline.cachedAgeSeconds,
      });
      if (shown) layers.push(shown);
      for (const adapter of OVERLAY_ADAPTERS) {
        const state = overlays.states[adapter.id];
        if (!overlays.data[adapter.id] || !state?.fetchedAt) continue;
        // The analysis comes off the map while the model's smoke has it, and
        // a record of a layer that is not drawn describes a picture the
        // reader cannot see.
        if (adapter.id === "smoke" && drawnForecastSmoke) continue;
        // The adapter knows how to fetch itself; the table knows what kind of
        // statement it makes, and three of these are forecasts rather than
        // observations.
        const described = Object.values(LAYER_SOURCES).find(
          (source) => source.sourceId === adapter.id,
        );
        layers.push(
          overlayProvenance({
            adapter,
            fetchedAt: state.fetchedAt,
            kind: described?.kind,
            // A derived layer has to say what was done to it, and the ledger
            // beside the switch is where that sentence is written. Leaving it
            // behind made the record malformed rather than incomplete, which
            // suppressed the source, the credit and the times as well.
            derivedFrom: described?.derivedFrom,
          }),
        );
      }

      // Everything else the reader can switch on. The overlay adapters above
      // already speak for themselves, so this covers the rest: the locally
      // decoded grids, both lightning layers, wind, satellite, and the two
      // products the radar's own algorithms derive.
      //
      // Each takes the best time the app actually has for it. An MRMS grid knows
      // when it was valid and a lightning window knows when it was observed;
      // where nothing is known the record says it was fetched now, which is true
      // and claims nothing more.

      for (const [key, on] of Object.entries(settings.layers)) {
        const layer = key as keyof typeof settings.layers;
        if (!on) continue;
        // Switched on is not the same as drawing. A record for a layer that
        // fetched nothing describes a picture the reader cannot see, which is
        // the opposite of what a report about the picture is for.
        if (layer === "wind" && !wind.field) continue;
        if (layer === "lightningFlashes" && !lightning.window) continue;
        if (layer === "classification" && !classification.report) continue;
        if (layer === "forecastSmoke" && !forecastSmoke.field) continue;
        const source = LAYER_SOURCES[layer];
        // Matched on the source rather than on the switch's own name, because
        // the two do not agree: the alerts adapter is `alerts` and the switch
        // that draws it is `weatherAlerts`. Comparing the names would have let
        // that one layer be reported twice under both.
        if (COVERED_BY_ADAPTERS.has(source.sourceId)) continue;
        // Reference geography with a vintage rather than a moment. Left to
        // fall through it reported the Census boundaries as observed this
        // instant, which is a freshness claim about something that has not
        // moved since 2024.
        if (layer === "counties" && !countiesDrawn) continue;
        const observedAt =
          (layer === "counties" ? COUNTY_VINTAGE : undefined) ??
          mrmsTimeFor(mrms.layers, layer, mrmsChoices) ??
          (layer === "lightningFlashes"
            ? // The flash window carries seconds, like the radar frames and
              // unlike everything in a record. Passed straight through it dated
              // every lightning layer to 1970.
              lightning.window
              ? lightning.window.observed * 1000
              : null
            : layer === "classification" && classification.report
              ? Date.parse(classification.report.observed)
              : null);
        // The wind layer is the one forecast here whose run the app already
        // reads, so it can report a real one rather than saying it does not know.
        const modelRun =
          layer === "wind" && wind.field
            ? {
                initUtc: wind.field.init,
                leadMinutes: wind.field.leadHours * 60,
              }
            : layer === "forecastSmoke" && forecastSmoke.field
              ? {
                  initUtc: forecastSmoke.field.init,
                  leadMinutes: forecastSmoke.field.leadHours * 60,
                }
              : undefined;
        // The smoke names the hour it is for; the wind's hour is worked
        // forward from now because the field is the run's own analysis.
        const validAt =
          layer === "forecastSmoke" && forecastSmoke.field
            ? Date.parse(forecastSmoke.field.valid)
            : modelRun
              ? now + modelRun.leadMinutes * 60_000
              : (observedAt ?? now);
        layers.push(
          layerProvenance({
            layer,
            fetchedAt: now,
            observedAt: observedAt ?? now,
            validAt,
            modelRun,
          }),
        );
      }
      const packs = settingsRef.current.incidentPacks;
      const block = diagnosticsBlock({
        lastCrash,
        lastWebviewCrash,
        webviewRuntime,
        renderer: gpuSupport().renderer,
        mapReady: mapStatus === "ready",
        radarReady: timeline.frames.length > 0,
        activeSource: timeline.sourceLabel,
        health,
        log: logEntries,
        layers,
        now,
        cache: {
          servedAgeSeconds: timeline.cachedAgeSeconds,
          packs: packs.references.length,
          packBytes: packs.references.reduce(
            (total, pack) => total + pack.bytes,
            0,
          ),
          selectedPack: packs.selectedId !== null,
          packLimitMb: packs.diskLimitMb,
        },
        notifications,
        startsWithMachine: autostart.on,
        // Only when the reader ticked the box beside the button, and only when
        // there is a watched place at all.
        place:
          withPlace && settingsRef.current.watch.enabled
            ? {
                label: translate("diagnostics.watchedPlace"),
                longitude: settingsRef.current.watch.center[0],
                latitude: settingsRef.current.watch.center[1],
              }
            : null,
      });
      void (async () => {
        try {
          await navigator.clipboard.writeText(block);
          pushToast({
            title: translate("diagnostics.copied"),
            detail: translate("diagnostics.copiedBody"),
          });
        } catch {
          // A clipboard can be refused: no permission, no focus, no clipboard.
          // Saying where the same text lives is better than saying nothing.
          pushToast({
            title: translate("diagnostics.copyFailed"),
            detail: translate("diagnostics.copyFailedBody"),
          });
        }
      })();
    },
    [
      autostart.on,
      notifications,
      classification.report,
      countiesDrawn,
      drawnForecastSmoke,
      lastCrash,
      lastWebviewCrash,
      webviewRuntime,
      forecastSmoke.field,
      health,
      lightning.window,
      wind.field,
      logEntries,
      mrms.layers,
      mrmsChoices,
      settings,
      settingsRef,
      mapStatus,
      overlays.data,
      overlays.states,
      pushToast,
      timeline,
    ],
  );

  // Loading a colour table is work: a file found, opened and dropped on the
  // window. Removing one was the action that threw that away with nothing to
  // say so and no way back.
  const removePalette = useCallback(
    (name: string) => {
      const previous = settingsRef.current;
      const found = previous.palettes.find((held) => held.name === name);
      if (!found) return;
      // Which unit it was in force for, if any, so the undo can put it back
      // there and the toast can say what actually changed on the map.
      const heldUnit = Object.entries(previous.paletteAssignments).find(
        ([, assigned]) => assigned === name,
      )?.[0];
      applySettings(withoutPalette(previous, name));
      pushToast({
        title: translate("toast.paletteCleared"),
        // Only claim the fallback when there was something to fall back from.
        // A table sitting on the shelf, in force for nothing, changes no
        // picture when it goes.
        detail: heldUnit
          ? translate("toast.paletteClearedBody", { name })
          : translate("toast.paletteShelvedBody", { name }),
        actionLabel: translate("toast.undo"),
        // Only this table, put back where it was. Restoring the whole
        // snapshot would undo anything else the reader did in between: remove
        // A, remove B, undo A, and B came back too.
        onAction: () => {
          const now = settingsRef.current;
          const back = withPalette(now, found);
          if (!back) return;
          applySettings(
            heldUnit
              ? back
              : withPaletteAssigned(
                  back,
                  paletteUnit(found),
                  now.paletteAssignments[paletteUnit(found).toLowerCase()] ??
                    null,
                ),
          );
        },
      });
    },
    [applySettings, pushToast, settingsRef],
  );

  /**
   * The way back from a removal a panel made, as a held toast.
   *
   * The panel knows what went and what to call it; the window is the same one
   * a cleared record gets, because the presses this covers all throw away
   * something the reader made or downloaded rather than a preference.
   */
  const offerUndo = useCallback(
    (removal: UndoableRemoval) => {
      pushToast({
        title: removal.title,
        detail: removal.detail,
        actionLabel: translate("toast.undo"),
        onAction: removal.undo,
        lifetimeMs: UNDO_LIFETIME_MS,
      });
    },
    [pushToast],
  );

  const assignPalette = useCallback(
    (unit: string, name: string | null) => {
      applySettings(withPaletteAssigned(settingsRef.current, unit, name));
    },
    [applySettings, settingsRef],
  );

  // Finding a storm in the archive takes a search and a choice, and stopping
  // the replay put the reader back at the start of both.
  // An open bundle answers for its own addresses ahead of the network, so
  // leaving its replay has to close it however the reader left: stopping,
  // picking a storm, opening another bundle. Tied to the replay itself rather
  // than to the one button that used to do it, because every other route out
  // left up to 256 MB in memory answering for tiles nobody was replaying.
  const openBundleRef = useRef<string | null>(null);
  useEffect(() => {
    const now = replay?.id.startsWith("bundle:") ? replay.id : null;
    if (openBundleRef.current && openBundleRef.current !== now) {
      void closeReplayBundle();
    }
    openBundleRef.current = now;
  }, [replay]);

  const stopReplay = useCallback(() => {
    setReplay(null);
    if (!replay) return;
    // A replay drawn from a bundle cannot be put back from a toast: its bytes
    // are in a file that would have to be opened again.
    if (replay.id.startsWith("bundle:")) {
      pushToast({
        title: translate("toast.replayStopped"),
        detail: translate("toast.replayStoppedBody"),
      });
      return;
    }
    pushToast({
      title: translate("toast.replayStopped"),
      detail: translate("toast.replayStoppedBody"),
      actionLabel: translate("toast.undo"),
      onAction: () => setReplay(replay),
    });
    // Depends on the replay itself rather than a ref read during render, which
    // React refuses. It changes when a storm is chosen, which is rare.
  }, [pushToast, replay]);

  // One file that keeps this replay's frames and warnings byte for byte,
  // written natively into the export folder. The reader's workspace goes in
  // only when they ticked the box.
  const saveReplayBundle = useCallback(
    async (includeWorkspace: boolean) => {
      if (!replay) return;
      const bounds = mapRef.current?.bounds();
      const camera = mapRef.current?.camera() ?? settingsRef.current.camera;
      if (!bounds) {
        pushToast({
          title: translate("toast.bundleFailed"),
          detail: translate("bundle.error.noView"),
        });
        return;
      }
      const request = captureRequestFor({
        replay,
        storm: historyStorm,
        bounds,
        camera,
        workspace: includeWorkspace
          ? createWorkspaceBackup(settingsRef.current, overlayFiles)
          : null,
      });
      if (!request) return;
      pushToast({ title: translate("toast.bundleSaving") });
      try {
        const report = await captureReplayBundle(request);
        const notes = [
          translate("toast.bundleSavedBody", {
            entries: report.entries,
            size: formatNumber(report.bytes / 1_048_576, 1),
            path: report.path,
          }),
        ];
        if (report.missing.length) {
          notes.push(
            translate("toast.bundleMissing", { count: report.missing.length }),
          );
        }
        pushToast({
          title: translate("toast.bundleSaved"),
          detail: notes.join(" "),
        });
      } catch (failure: unknown) {
        pushToast({
          title: translate("toast.bundleFailed"),
          detail: bundleErrorText(failure),
        });
      }
    },
    [historyStorm, overlayFiles, pushToast, replay, settingsRef],
  );

  // A bundle's workspace is somebody's home and watched places. It is applied
  // on this and never on opening the bundle.
  const applyBundledWorkspace = useCallback(
    (value: unknown) => {
      // Somebody else's home, watched places and saved views, out of a file
      // that was sent to this reader. It gets exactly what a workspace file
      // gets: a note when it is only a partial restore, and an undo.
      const previous = settingsRef.current;
      const previousOverlay = overlayFiles;
      try {
        const restored = restoreWorkspace(value);
        applySettings(restored.settings);
        setOverlayFiles(restored.overlayFiles);
        mapRef.current?.flyTo(restored.settings.camera);
        const notes: string[] = [];
        if (restored.fromNewerBuild) {
          notes.push(translate("toast.settingsFromNewer"));
        }
        if (restored.unread.length) {
          notes.push(
            translate("toast.settingsUnread", {
              names: restored.unread.join(", "),
            }),
          );
        }
        pushToast({
          title: translate(
            notes.length
              ? "toast.bundleWorkspacePartly"
              : "toast.bundleWorkspaceApplied",
          ),
          detail: notes.length ? notes.join(" ") : undefined,
          actionLabel: translate("toast.undo"),
          onAction: () => {
            applySettings(previous);
            setOverlayFiles(previousOverlay);
            mapRef.current?.flyTo(previous.camera);
          },
        });
      } catch {
        pushToast({
          title: translate("toast.workspaceInvalidTitle"),
          detail: translate("toast.workspaceInvalid"),
        });
      }
    },
    [applySettings, overlayFiles, pushToast, settingsRef],
  );

  // A bundle is opened through the operating system's picker, so its bytes
  // never cross into the page: the native side reads and checks the file and
  // answers with what it holds. Nothing here changes until it has.
  const openBundle = useCallback(async () => {
    try {
      const path = await pickBundleFile();
      if (!path) return;
      const manifest = await openReplayBundle(path);
      const next = bundleReplay(manifest);
      if (!next) {
        // Opening replaced whatever bundle was already answering, so the one
        // before this is gone whether or not this one is usable. Say so and
        // put the map back on live radar rather than leaving a replay whose
        // frames now quietly come off the network.
        await closeReplayBundle();
        const wasBundled = openBundleRef.current !== null;
        if (wasBundled) setReplay(null);
        pushToast({
          title: translate("toast.bundleFailed"),
          detail: wasBundled
            ? `${translate("bundle.error.noFrames")} ${translate("bundle.error.letGo")}`
            : translate("bundle.error.noFrames"),
        });
        return;
      }
      // The storm's track from the bundled record. A storm the record has
      // never heard of is still replayed, without a track.
      let storm: Storm | null = null;
      if (manifest.storm) {
        try {
          storm = await loadStorm(manifest.storm.id);
        } catch {
          storm = null;
        }
      }
      setHistoryStorm(storm);
      setReplay(next);
      mapRef.current?.flyTo({
        center: manifest.camera.center,
        zoom: manifest.camera.zoom,
        bearing: manifest.camera.bearing,
        pitch: manifest.camera.pitch,
      });
      const missing = bundleMissingNote(manifest);
      pushToast({
        title: translate("toast.bundleOpened", { label: manifest.label }),
        detail: [
          translate("toast.bundleOpenedBody", {
            frames: next.frames.length,
            made: manifest.createdAt.slice(0, 10),
          }),
          missing,
        ]
          .filter((line): line is string => Boolean(line))
          .join(" "),
        ...(manifest.workspace
          ? {
              actionLabel: translate("toast.bundleApplyWorkspace"),
              onAction: () => applyBundledWorkspace(manifest.workspace),
            }
          : {}),
      });
    } catch (failure: unknown) {
      pushToast({
        title: translate("toast.bundleFailed"),
        detail: bundleErrorText(failure),
      });
    }
  }, [applyBundledWorkspace, pushToast]);

  // One place that knows how to do each kind of thing the palette offers, so
  // the palette itself stays a list rather than a second copy of the app.
  const runCommand = useCallback(
    (action: CommandAction) => {
      // Nothing about the welcome hint here. It is remembered the moment it
      // is put on screen, so having found the commands the reader has already
      // been past it, and a second place that writes the same flag would be a
      // line that can never run.
      const current = settingsRef.current;
      switch (action.kind) {
        case "layer":
          applySettings({
            ...current,
            layers: {
              ...current.layers,
              [action.layer]: !current.layers[action.layer],
            },
          });
          break;
        case "style":
          applySettings({ ...current, mapStyle: action.style });
          break;
        case "product":
          applySettings({
            ...current,
            radar: {
              ...current.radar,
              product: action.product as RadarSettings["product"],
              singleSite: true,
            },
          });
          setProductOpen(true);
          break;
        case "surface":
          if (action.surface === "radar-product") {
            setActiveSurface(null);
            setProductOpen(true);
            return;
          }
          setProductOpen(false);
          // The panel it asks for takes the palette's place, so this must not
          // fall through to the close below.
          setActiveSurface(action.surface as SurfaceId);
          return;
        case "tool":
          // handleTool clears the surface itself.
          handleTool(action.tool as ToolMode);
          return;
        case "home":
          // The camera only. Nothing about the watch, the layers or the
          // projection changes: a reader on the globe comes home on the
          // globe, and a reader who was looking at a storm keeps the storm's
          // layers when they come back to it.
          mapRef.current?.flyTo({
            center: current.watch.center,
            zoom: Math.max(current.camera.zoom, HOME_ZOOM),
            bearing: 0,
            pitch: 0,
          });
          break;
        case "ambientScreen":
          setAmbientAsked((on) => !on);
          handleTool(null);
          break;
        case "capture":
          setCapture((on) => !on);
          // Nothing the mode hides may be left armed behind it. The layout
          // change is its own announcement, so there is no toast: the mode
          // hides those, because a toast's action button changes what the
          // workspace comes back to and it cannot be seen to be pressed.
          handleTool(null);
          break;
      }
      // Everything else leaves the map showing rather than the list.
      setActiveSurface(null);
    },
    [applySettings, handleTool, settingsRef],
  );

  const centerPoint = useMemo<GeoPoint>(
    () => ({ lon: settings.camera.center[0], lat: settings.camera.center[1] }),
    [settings.camera.center],
  );

  // The map, in words, for a reader who is not looking at it. The centre by
  // default, because that is what the rest of the workspace is about, and any
  // watched place instead, because a reader listening from a desk cares about
  // where they live rather than where the camera drifted.
  const [nearbyPlaceId, setNearbyPlaceId] = useState("centre");
  const measurements = useMeasurements();
  const nearbyPlaces = useMemo(
    () => [
      { id: "centre", name: translate("nearby.placeCentre") },
      ...watchedPlaces(settings).map((place) => ({
        id: place.id,
        name: place.name,
      })),
    ],
    [settings],
  );
  const nearbyPoint = useMemo<GeoPoint>(() => {
    const watched = watchedPlaces(settings).find(
      (place) => place.id === nearbyPlaceId,
    );
    return watched
      ? { lon: watched.center[0], lat: watched.center[1] }
      : centerPoint;
  }, [centerPoint, nearbyPlaceId, settings]);
  const nearby = useMemo(() => {
    // The same collection the map is handed, so a replay's warnings are in the
    // readout too. Reading `overlays.data.alerts` alone left a reader who
    // cannot see the map hearing "no warnings over this place" while the map
    // drew that day's polygons: the live fetch is switched off for the whole
    // replay, which is exactly when the archive is on.
    const warnings = warningsOver(
      replayedAlerts ?? overlays.data.alerts ?? null,
      nearbyPoint,
    );
    const cells = stormCells.report
      ? nearbyCells(stormCells.report.cells, nearbyPoint, {
          rotating: stormCells.rotating,
        })
      : [];
    const name =
      nearbyPlaces.find((place) => place.id === nearbyPlaceId)?.name ??
      translate("nearby.placeCentre");
    return {
      warnings,
      cells,
      summary: nearbySummary(warnings, cells, name),
    };
    // Every sentence here is a distance, a bearing or a speed, and units.ts
    // says plainly that anything formatting a measurement and staying on
    // screen has to subscribe. Without this the readout kept saying miles
    // after the reader switched to kilometres. The rule cannot see that,
    // because the unit is module state the formatters read rather than an
    // argument they are handed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    measurements,
    nearbyPlaceId,
    nearbyPlaces,
    nearbyPoint,
    overlays.data.alerts,
    replayedAlerts,
    stormCells.report,
    stormCells.rotating,
  ]);
  // Staleness is a property of the observed feed, not of the frame the user
  // scrubbed to and not of a forecast frame that is hours ahead by design.
  const radarAge = timeline.newestObserved
    ? frameAgeMinutes(timeline.newestObserved, clock)
    : null;
  const panelSide =
    productOpen ||
    activeSurface === "commands" ||
    activeSurface === "search" ||
    activeSurface === "map-type" ||
    activeSurface === "layers"
      ? "left"
      : activeSurface
        ? "right"
        : "none";

  // A machine that passed the WebGL2 probe at start-up and could not make
  // the map's own context after all. It reaches here rather than through the
  // error boundary, which would show a generic fatal screen; this one names
  // the setting that turns hardware acceleration back on.
  if (mapStatus === "nogpu") return <NoGpu />;

  if (!hydrated) {
    return (
      <main className="startup-screen">
        <div className="brand-mark">
          <Radar size={34} />
        </div>
        <p className="eyebrow">OpenRadar</p>
        <h1>{t("app.preparing")}</h1>
        <LoaderCircle className="spin" size={20} />
      </main>
    );
  }

  return (
    <main
      className={`app-shell ${dualPane ? "is-dual-pane" : ""}`}
      data-panel-side={panelSide}
      // Everything the streamer operates is hidden by one attribute rather
      // than by unmounting it, so leaving the mode puts the workspace back
      // exactly as it was: same panel open, same tool held, same scroll.
      data-capture={capture || ambientScreen ? "1" : undefined}
      // Its own attribute as well, because the readout is the difference
      // between a streamer's clean frame and a second monitor's.
      data-ambient-screen={ambientScreen ? "1" : undefined}
    >
      {ambientScreen ? (
        <AmbientReadout
          clock={clock}
          place={settings.watch.name?.trim() ?? ""}
          source={timeline.sourceLabel ?? ""}
          frameAgeMinutes={radarAge}
          idleMs={idleMs}
          // Resolved first. "auto" is the default and `isLightBasemap`
          // has no case for it, so this asked whether the word "auto" was
          // a light style, was told no, and the fix never fired for
          // anybody who had not gone and picked a style by hand. The
          // county lines read a resolved style; this now does too.
          overLight={isLightBasemap(
            resolvedMapStyle(settings.mapStyle, settings.theme),
          )}
          onLeave={() => {
            setAmbientAsked(false);
            // Also counts as being here, which is what stops the idle rule
            // putting it straight back.
            setTouchedAt(Date.now());
          }}
        />
      ) : null}
      {revealing ? <FirstRunReveal onDone={markRevealSeen} /> : null}
      {curiosity &&
      settings.curiosities &&
      !settings.calm &&
      !overlays.alertActive ? (
        // Gated where it is drawn as well as where it is found. The card is
        // state, and state outlives the condition that created it: a warning
        // going up while one was on screen used to leave a note about a
        // measurement taken in 1934 sitting over a live warning.
        <CuriosityCard found={curiosity} onDismiss={() => setCuriosity(null)} />
      ) : null}
      {catchUp && !catchUpGone && !overlays.alertActive ? (
        // Stood down while a warning is in force at a watched place, like
        // everything else discoverable here: a map with a warning on it is a
        // serious instrument and this is a card about last Tuesday.
        <CatchUpCard
          summary={catchUp}
          onDismiss={() => setCatchUpGone(true)}
          onOpenRecord={() => {
            setCatchUpGone(true);
            setActiveSurface("settings");
          }}
        />
      ) : null}
      <MapStage
        settings={settings}
        mapRef={mapRef}
        secondMapRef={secondMapRef}
        activeFrame={activeFrame}
        compareFrame={compareFrame}
        compareSweep={singleSite.compare.sweep}
        satelliteTime={satelliteTime}
        compareSatelliteTime={satelliteFor(compareFrame)}
        satelliteAgeMinutes={
          satelliteTime === null
            ? null
            : Math.max(0, Math.floor(clock / 60_000 - satelliteTime / 60))
        }
        overlays={
          replayedAlerts
            ? { ...overlays.data, alerts: replayedAlerts }
            : overlays.data
        }
        route={route}
        customOverlay={overlayShapes}
        stormTrack={stormTrackData}
        sweep={singleSite.sweep}
        mrmsLayers={singleSite.historical ? [] : mrms.layers}
        cells={stormCells.features}
        classification={drawnClassification}
        forecastSmoke={drawnForecastSmoke}
        probSevere={probSevere.features}
        overlayOpacity={settings.overlayOpacity}
        overlayOrder={settings.overlayOrder}
        flashes={singleSite.historical ? null : lightning.points}
        flashWindowMinutes={lightning.window?.windowMinutes ?? 5}
        flashClock={clock}
        wind={singleSite.historical ? null : wind.field}
        activeTool={activeTool}
        dualPane={dualPane}
        compareOffset={compareOffset}
        onCompareOffset={setCompareOffset}
        onCameraChange={handleCameraChange}
        onPrimaryMove={(camera) => secondMapRef.current?.syncCamera(camera)}
        onSecondaryMove={(camera) => mapRef.current?.syncCamera(camera)}
        onCursorChange={setCursor}
        onToolResult={showToolResult}
        onSection={handleSection}
        onOverlayAction={applyPairing}
        onMapStatus={handleMapStatus}
      />

      {activeSurface || productOpen ? (
        <Suspense fallback={null}>
          <PanelSurfaces
            layerNotes={{
              // During a replay this switch is drawing that day's polygons out
              // of the archive rather than today's, so what it has to say
              // about itself is what the archive can and cannot cover.
              weatherAlerts: replay
                ? (archiveWarnings.error ??
                  (archiveWarnings.coverage === "none"
                    ? translate("replay.warningsNone")
                    : archiveWarnings.coverage === "partial"
                      ? translate("replay.warningsPartial")
                      : null))
                : overlays.states.alerts.error,
              spcOutlooks:
                overlays.states.spcOutlooks.error ??
                overlays.states.spcOutlooks.partial,
              spcDiscussions: overlays.states.spcDiscussions.error,
              // The second source answering is worth saying: the reports on
              // the map came from somewhere else, and the reader is looking
              // at this switch because the usual one went quiet.
              stormReports:
                overlays.states.stormReports.error ??
                overlays.states.stormReports.partial,
              stormCells: stormCells.error,
              classification: classification.error,
              forecastSmoke: forecastSmoke.error,
              probSevere: probSevere.error,
              earthquakes: overlays.states.earthquakes.error,
              wildfires: overlays.states.wildfires.error,
              smoke:
                overlays.states.smoke.error ??
                // A day the analysts found no smoke publishes a real file
                // with nothing in it. Drawing nothing and saying nothing
                // reads as a layer that is broken.
                (settings.layers.smoke &&
                overlays.states.smoke.fetchedAt !== null &&
                overlays.states.smoke.data.features.length === 0
                  ? translate("smoke.clear")
                  : null),
              // The one layer with a zoom of its own, so its note is what
              // to do about that rather than a fetch that never happened.
              metar:
                settings.camera.zoom < METAR_MIN_ZOOM
                  ? translate("metar.zoom")
                  : overlays.states.metar.error,
              // The other layer with a zoom of its own, and the same note:
              // what to do about it rather than a fetch that never happened.
              riverGauges: replay
                ? // Today's river levels over a replay of some other day is
                  // the same false claim the warnings are held back for.
                  translate("rivers.replay")
                : settings.camera.zoom < GAUGE_MIN_ZOOM
                  ? translate("rivers.zoom")
                  : overlays.states.riverGauges.error,
              tropical: overlays.states.tropical.error,
              rotationTracks: mrms.error,
              hail: mrms.error,
              hailSwath: mrms.error,
              echoTops: mrms.error,
              vil: mrms.error,
              precipRate: mrms.error,
              qpeHour: mrms.error,
              qpeDay: mrms.error,
              lightningDensity: mrms.error,
              lightningForecast: mrms.error,
              lightningJump: mrms.error,
              isothermReflectivity: mrms.error,
              lightningFlashes: lightning.error,
              wind: wind.error,
            }}
            activeSurface={activeSurface}
            productOpen={productOpen}
            settings={settings}
            overlays={
              replay
                ? {
                    ...overlays.states,
                    alerts: {
                      ...overlays.states.alerts,
                      data: replayedAlerts ?? EMPTY_OVERLAY,
                      // A moment that genuinely holds no warning is an answer,
                      // not a wait. Without this the panel spins for ever,
                      // because the live fetch it normally reads is switched
                      // off for the whole replay and never stamps a time.
                      fetchedAt: archiveWarnings.loading ? null : clock,
                      error: archiveWarnings.error,
                    },
                  }
                : overlays.states
            }
            viewport={viewport}
            centerPoint={centerPoint}
            frameCount={frames.length}
            sourceLabel={timeline.sourceLabel}
            singleSite={level2Available() ? singleSite : null}
            siteStatus={siteStatus}
            stormCells={stormCells}
            nearby={{ ...nearby, cellNames: namesHere, onNameCell: nameCell }}
            replaying={Boolean(replay)}
            nearbyPlaces={nearbyPlaces}
            nearbyPlaceId={nearbyPlaceId}
            approaching={approaching}
            placeLightning={placeLightning}
            onNearbyPlace={setNearbyPlaceId}
            clock={clock}
            update={updates.state}
            onUpdate={updates.act}
            historyStormId={historyStorm?.id ?? null}
            replayId={replay?.id ?? null}
            sectionLine={sectionLine}
            // The volumes the held site is looping, as the times the archive
            // lists them by. Empty asks for whichever one the radar published
            // last, which is the single-column case.
            vwpTimes={vwpTimes}
            readVwp={vwpAvailable() ? fetchVwp : null}
            soundingAt={activeFrame?.time ?? Math.floor(clock / 1000)}
            mapReady={mapStatus === "ready"}
            health={health}
            log={logEntries}
            exportState={exportState}
            dataExports={exportState.dataExports}
            onClose={() => setActiveSurface(null)}
            onCloseProduct={() => setProductOpen(false)}
            onLayers={(layers: LayerSettings) =>
              applySettings({ ...settingsRef.current, layers })
            }
            onEnableLayer={(layer) =>
              applySettings({
                ...settingsRef.current,
                layers: { ...settingsRef.current.layers, [layer]: true },
              })
            }
            onSettings={applySettings}
            onMapStyle={(mapStyle: MapStyleId) =>
              applySettings({ ...settingsRef.current, mapStyle })
            }
            onProjection={actions.setProjection}
            onRadar={(radar: RadarSettings) =>
              applySettings({ ...settingsRef.current, radar })
            }
            onPlace={actions.goToPlace}
            onAlertSelect={actions.flyToBounds}
            onFollowStorm={actions.followStorm}
            onCommand={runCommand}
            onAssignPalette={assignPalette}
            onRemovePalette={removePalette}
            onAlertTypes={(alertTypes) =>
              applySettings({ ...settingsRef.current, alertTypes })
            }
            onOverlayOpacity={(overlayOpacity) =>
              applySettings({ ...settingsRef.current, overlayOpacity })
            }
            overlayFiles={overlayFiles}
            onOverlayFiles={setOverlayFiles}
            onOverlayOrder={(overlayOrder) =>
              applySettings({ ...settingsRef.current, overlayOrder })
            }
            // Moving a row changes nothing a reader can see except the row
            // itself, and the button they pressed has moved out from under
            // them. The toast host is already a polite live region, so this
            // is both the announcement and the visible confirmation.
            onOrderSaid={(said) => pushToast({ title: said })}
            onSurgeCategory={(surgeCategory) =>
              applySettings({ ...settingsRef.current, surgeCategory })
            }
            onGaugeQpePeriod={(gaugeQpePeriod) =>
              applySettings({ ...settingsRef.current, gaugeQpePeriod })
            }
            onLightningWindow={(lightningWindow) =>
              applySettings({ ...settingsRef.current, lightningWindow })
            }
            onLightningForecastWindow={(lightningForecastWindow) =>
              applySettings({ ...settingsRef.current, lightningForecastWindow })
            }
            onLightningJumpWindow={(lightningJumpWindow) =>
              applySettings({ ...settingsRef.current, lightningJumpWindow })
            }
            onIsothermLevel={(isothermLevel) =>
              applySettings({ ...settingsRef.current, isothermLevel })
            }
            onRotationPeriod={(rotationPeriod) =>
              applySettings({ ...settingsRef.current, rotationPeriod })
            }
            onAzShearLevel={(azShearLevel) =>
              applySettings({ ...settingsRef.current, azShearLevel })
            }
            onCappiField={(cappiField) =>
              applySettings({ ...settingsRef.current, cappiField })
            }
            onCappiLevel={(cappiLevel) =>
              applySettings({ ...settingsRef.current, cappiLevel })
            }
            spcDay={settings.spcDay}
            spcHazard={settings.spcHazard}
            onSpcDay={(spcDay: number) =>
              applySettings({ ...settingsRef.current, spcDay })
            }
            onSpcHazard={(spcHazard: SpcHazard) =>
              applySettings({ ...settingsRef.current, spcHazard })
            }
            onWpcDay={(wpcDay) =>
              applySettings({ ...settingsRef.current, wpcDay })
            }
            onWssiDay={(wssiDay) =>
              applySettings({ ...settingsRef.current, wssiDay })
            }
            onSatelliteBand={(satelliteBand) =>
              applySettings({ ...settingsRef.current, satelliteBand })
            }
            onHistoryStorm={showStorm}
            onSearchStorm={showStormById}
            onReplayStorm={replayStorm}
            onStopReplay={stopReplay}
            onSaveReplayBundle={saveReplayBundle}
            onOpenReplayBundle={openBundle}
            bundlesAvailable={bundlesAvailable()}
            onRoute={setRoute}
            onUpload={actions.uploadOverlay}
            onWatchHere={actions.watchHere}
            onAddWatchPlace={actions.addWatchPlace}
            onSendWatchTest={sendWatchTest}
            watchHealth={{
              lastCheckedAt: overlays.watchLastCheckedAt,
              failing: overlays.watchFailing,
              failingSince: overlays.watchFailingSince,
            }}
            notifications={notifications}
            onOpenLogFolder={actions.openLogFolder}
            onCopyDiagnostics={copyDiagnostics}
            hasWatchedPlace={settings.watch.enabled}
            onReset={actions.resetSettings}
            almanac={settings.almanac && !overlays.alertActive}
            onFlyTo={(point) =>
              mapRef.current?.flyTo({
                center: [point.lon, point.lat],
                zoom: Math.max(settingsRef.current.camera.zoom, 6),
                bearing: 0,
                pitch: 0,
              })
            }
            ambient={ambient}
            onJournalSaved={(path) =>
              pushToast({
                title: translate("journal.saved"),
                detail: path ?? translate("export.downloads"),
              })
            }
            onJournalFailed={(why) =>
              pushToast({ title: translate("journal.failed"), detail: why })
            }
            onImportSettings={(file) => void actions.uploadOverlay(file, true)}
            onStorageCleared={(detail) =>
              pushToast({ title: translate("storage.cleared"), detail })
            }
            onStorageFailed={(why) =>
              pushToast({
                title: translate("storage.clearFailed"),
                detail: why,
              })
            }
            onJournalCleared={(undo) =>
              pushToast({
                title: translate("journal.cleared"),
                detail: translate("journal.undoBody"),
                actionLabel: translate("toast.undo"),
                onAction: undo,
                // The only way back from deleting a year of somebody's own
                // weather, so it does not go after five seconds.
                lifetimeMs: UNDO_LIFETIME_MS,
              })
            }
            onJournalRemoved={(undo) =>
              pushToast({
                title: translate("journal.rowRemoved"),
                detail: translate("journal.undoBody"),
                actionLabel: translate("toast.undo"),
                onAction: undo,
                lifetimeMs: UNDO_LIFETIME_MS,
              })
            }
            onRemoved={offerUndo}
            autostart={autostart.on}
            onAutostart={autostart.set}
            onExportSettings={actions.exportSettings}
            onChooseSound={chooseAlertSound}
          />
        </Suspense>
      ) : null}

      {capture ? (
        <CaptureBar
          center={settings.camera.center}
          sourceLabel={timeline.sourceLabel}
          attribution={timeline.attribution?.label ?? null}
          alerts={replayedAlerts ?? overlays.data.alerts ?? null}
          clock={clock}
          onLeave={() => setCapture(false)}
        />
      ) : null}

      <WorkspaceChrome
        settings={settings}
        liveClock={liveClock}
        timeline={timeline}
        frames={frames}
        sweep={singleSite.sweep}
        sweepLoop={singleSite.loop}
        // Never over a volume the reader opened by hand. How long ago the
        // office last heard from KDMX is a statement about the radar now, and
        // beside a picture from 2011 it is an answer to a question nobody
        // asked.
        sweepStatus={
          singleSite.historical
            ? null
            : statusFor(siteStatus, singleSite.station)
        }
        mrmsLayers={singleSite.historical ? [] : mrms.layers}
        lightning={singleSite.historical ? null : lightning.window}
        smoke={drawnForecastSmoke ? null : (overlays.data.smoke ?? null)}
        classification={classification.report}
        forecastSmoke={drawnForecastSmoke ? forecastSmoke.field : null}
        wind={singleSite.historical ? null : wind.field}
        windReduced={
          !singleSite.historical && settings.layers.wind && reducedMotion
        }
        clock={clock}
        radarAgeMinutes={radarAge}
        cursor={cursor}
        activeTool={activeTool}
        toolResult={toolResult}
        activeSurface={activeSurface}
        productOpen={productOpen}
        dualPane={dualPane}
        toasts={toasts.messages}
        announcement={overlays.announcement}
        // Only while the panel is open. A reader who asked for the readout
        // wants to hear it change; everybody else did not ask to be read the
        // weather every time the radar turns.
        readout={activeSurface === "nearby" ? nearby.summary : ""}
        onClearTools={() => mapRef.current?.clearTools()}
        onToggleProduct={() => {
          setActiveSurface(null);
          setProductOpen((open) => !open);
        }}
        onSurface={(surface) => {
          setProductOpen(false);
          setActiveSurface(surface);
        }}
        onTool={handleTool}
        onLocate={actions.locate}
        onDualPane={() => {
          setDualPane((enabled) => !enabled);
          pushToast({
            title: translate(
              dualPane ? "app.dualPaneClosed" : "app.dualPaneOpened",
            ),
          });
        }}
        onProjection={() =>
          actions.setProjection(
            settings.projection === "globe" ? "mercator" : "globe",
          )
        }
        onPreset={actions.usePreset}
        onShare={() => void actions.share()}
        onZoomIn={() => mapRef.current?.zoomIn()}
        onZoomOut={() => mapRef.current?.zoomOut()}
        onResetNorth={() => mapRef.current?.resetNorth()}
        onDismissToast={toasts.dismiss}
        onHoldToasts={toasts.hold}
        onReleaseToasts={toasts.release}
      />
    </main>
  );
}
