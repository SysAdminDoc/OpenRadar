import { LoaderCircle, Radar } from "lucide-react";
import {
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { SurfaceId, ToolMode } from "./components/CommandBar";
import { MapStage } from "./components/MapStage";
import { useLatestReply } from "./hooks/useLatestReply";
import { useAppearance } from "./hooks/useAppearance";
import { FirstRunReveal } from "./components/FirstRunReveal";
import { CatchUpCard } from "./components/CatchUpCard";
import { CuriosityCard } from "./components/CuriosityCard";
import { AmbientReadout } from "./components/AmbientReadout";
import { useCuriosities } from "./hooks/useCuriosities";
import type { Curiosity } from "./lib/curiosities";
import { useAmbient } from "./hooks/useAmbient";
import { setJournalWriting, thumbnailFrom } from "./lib/journal";
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
import { useExport } from "./hooks/useExport";
import { useWorkspaceOverlays } from "./hooks/useWorkspaceOverlays";
import { useRadarTimeline } from "./hooks/useRadarTimeline";
import { useSettings } from "./hooks/useSettings";
import { useToasts, UNDO_LIFETIME_MS } from "./hooks/useToasts";
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
import { useAlertSound } from "./hooks/useAlertSound";
import { useGlanceWindow } from "./hooks/useGlanceWindow";
import { useWorkspaceReport } from "./hooks/useWorkspaceReport";
import { useReplayBundles } from "./hooks/useReplayBundles";
import { useStormTrack } from "./hooks/useStormTrack";
import { useWallpaper } from "./hooks/useWallpaper";
import { usePaletteActions } from "./hooks/usePaletteActions";
import { useNearbyReadout } from "./hooks/useNearbyReadout";
import { useStationRecord } from "./hooks/useStationRecord";
import { useCatchUp } from "./hooks/useCatchUp";
import {
  setCloseToTray,
  setGlanceOnTop,
  setTrayEnabled,
  setTrayCopy,
} from "./lib/tray";
import { useDisplayAwake } from "./hooks/useDisplayAwake";
import { useWelcomeHint } from "./hooks/useWelcomeHint";
import { useMrmsOverlays } from "./hooks/useMrmsOverlays";
import { loadCounties } from "./lib/counties";
import { useNativeReports } from "./hooks/useNativeReports";
import { useLightning } from "./hooks/useLightning";
import { usePalette } from "./hooks/usePalette";
import { useWind } from "./hooks/useWind";
import { useSingleSiteRadar } from "./hooks/useSingleSiteRadar";
import { useRadarStatus } from "./hooks/useRadarStatus";
import { statusFor } from "./lib/radarStatus";
import { useUpdates } from "./hooks/useUpdates";
import { useWorkspaceActions } from "./hooks/useWorkspaceActions";
import type { CommandAction } from "./lib/commands";
import { SURFACE_FRAMES } from "./lib/commands";
import { LazyPanel } from "./components/LazyPanel";
import type { GeoPoint } from "./lib/geo";
import { log, recentLog, subscribeLog } from "./lib/log";
import type { OverlayBounds, OverlayLegend } from "./lib/overlays";
import {
  providerHealth,
  loadProviderIncidents,
  satelliteFrameTime,
  subscribeHealth,
} from "./lib/providers";
import { frameAgeMinutes, type RadarFrame } from "./lib/radar";
import { watchRingFeatures } from "./lib/ring";
import type { Storm } from "./lib/hurdat";
import { basemapCredit, drawnOverLight } from "./lib/mapStyles";
import { supportedProduct } from "./lib/radarKinds";
import { level2Available } from "./lib/level2";
import { pairingById } from "./lib/alertPairings";
import { featureBounds } from "./lib/overlays";
import { alertId, type WatchAlert } from "./lib/watch";

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
import { bundlesAvailable } from "./lib/replayBundle";
import type { ArchiveReplay } from "./hooks/useRadarTimeline";
import type {
  AppSettings,
  CameraState,
  LayerSettings,
  MapStyleId,
  RadarSettings,
} from "./lib/settings";
import {
  noteWorkspaceDrawn,
  restoreArrangement,
  settingsRecovery,
  startedPlain,
} from "./lib/settings";
import { watchedPlaces } from "./lib/watch";
import {
  mergedOverlayShapes,
  overlayGates,
  type WorkspaceOverlayFile,
} from "./lib/workspaceOverlays";
import { translate, useT, type StringKey } from "./i18n";
import { fetchVwp, vwpAvailable } from "./lib/vwp";
import type { SpcHazard } from "./lib/overlays/registry";
import { OVERLAY_ADAPTERS } from "./lib/overlays";

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
import { activePalettes } from "./lib/palette";
import { METAR_MIN_ZOOM } from "./lib/overlays/metar";
import { GAUGE_MIN_ZOOM } from "./lib/overlays/rivers";
import { useProbSevere } from "./hooks/useProbSevere";
import { NoGpu } from "./components/NoGpu";
import { useOfflineSince } from "./hooks/useOffline";
import { useStateNotices } from "./hooks/useStateNotices";

const PanelSurfaces = lazy(async () => {
  const module = await import("./components/PanelSurfaces");
  return { default: module.PanelSurfaces };
});

/** One list rather than a fresh one each render, so nothing downstream of
    an export re-arms on a picture nobody asked to be keyed. */
const EMPTY_KEYS: OverlayLegend[] = [];

export default function App() {
  const t = useT();
  const [activeSurface, setActiveSurface] = useState<SurfaceId>(null);
  // Set by the palette's "Find a layer" and by nothing else, so the box in
  // the layers panel takes the cursor on that one way in.
  const [layersToFind, setLayersToFind] = useState(false);
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
  // Read once, where the workspace starts. What the sources did before the
  // last restart is most of what a report about an outage is written from.
  useEffect(() => {
    loadProviderIncidents();
  }, []);
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
  const latestPermission = useLatestReply();
  useEffect(() => {
    const reply = latestPermission();
    void notificationPermission().then((answer) => {
      if (reply.current()) setNotifications(answer);
    });
    return () => {
      reply.close();
    };
    // Also on the minute, because a refusal recorded while a panel is
    // already open would otherwise not show until it was closed and opened
    // again, and that is the panel a reader is on when they go looking.
  }, [activeSurface, clock, latestPermission]);

  const onPersistError = useCallback(
    () =>
      pushToast({
        title: translate("app.settingsNotSaved"),
        detail: translate("app.settingsNotSavedBody"),
      }),
    [pushToast],
  );
  const {
    settings,
    hydrated,
    settingsRef,
    applySettings,
    updateCamera,
    viewportPx,
  } = useSettings({ onPersistError });

  // The workspace is up, which is the whole of what the count is about: a
  // start that never got this far is the one worth standing an arrangement
  // down for.
  const latestDrawn = useLatestReply();
  useEffect(() => {
    if (!hydrated) return;
    // After the map has drawn, not when the settings parsed. Everything this
    // is protecting against is applied on the render AFTER hydration: the map
    // itself, the theme, the colour table a product is drawn with, the camera
    // the projection has to show. Reported at hydration, the mark was gone
    // before any of them existed, and a workspace that died on its first
    // frame every time was never once counted.
    const reply = latestDrawn();
    void mapRef.current?.onceIdle().then(() => {
      if (reply.current()) void noteWorkspaceDrawn();
    });
    return reply.close;
  }, [hydrated, latestDrawn]);

  // Two starts that did not finish, and the arrangement stood down for this
  // one. Said out loud with the one press that puts it back, because a
  // workspace that quietly opens without the reader's theme and saved view
  // reads as the app having forgotten them.
  useEffect(() => {
    if (!hydrated) return;
    if (!startedPlain()) return;
    pushToast({
      title: translate("app.startedPlain"),
      detail: translate("app.startedPlainBody"),
      actionLabel: translate("app.startedPlainRestore"),
      // As long as every other toast that offers to undo something. Five
      // seconds is enough for a notice and not enough to read a sentence
      // about the workspace being different and decide what to do about it.
      lifetimeMs: UNDO_LIFETIME_MS,
      onAction: () => {
        void restoreArrangement();
      },
    });
  }, [hydrated, pushToast]);

  // A settings file that would not parse used to be silent: the workspace
  // opened on the defaults and the reader was left wondering where their
  // places went. Said once, after the load, whether the copy went back or
  // there was none to go back to. The two are different news.
  useEffect(() => {
    if (!hydrated) return;
    const recovered = settingsRecovery();
    if (!recovered) return;
    pushToast(
      recovered.stuck
        ? {
            // The one that will happen again on every launch until the reader
            // does something about it, and the one where a good copy is
            // sitting beside the file unused.
            title: translate("app.settingsLocked"),
            detail: translate("app.settingsLockedBody"),
          }
        : recovered.restored
          ? {
              title: translate("app.settingsRestored"),
              detail: translate("app.settingsRestoredBody"),
            }
          : {
              title: translate("app.settingsUnreadable"),
              detail: translate("app.settingsUnreadableBody"),
            },
    );
  }, [hydrated, pushToast]);

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
    windowPx: viewportPx,
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

  // What the machine has to say about the last run, for the report a
  // reader sends in. Three questions asked once at start-up, none of whose
  // answers can change while this process is alive.
  const { lastCrash, lastWebviewCrash, webviewRuntime } = useNativeReports();

  // Whether the county outlines are on the map, as opposed to switched on.
  // The file is a megabyte read on demand and it can fail; a report listing a
  // layer that drew nothing describes a picture the reader cannot see, which
  // is what the guards above it are for.
  const [countiesLoaded, setCountiesLoaded] = useState(false);
  const latestCounties = useLatestReply();
  useEffect(() => {
    if (!settings.layers.counties) return;
    const reply = latestCounties();
    void loadCounties()
      .then(() => {
        if (reply.current()) setCountiesLoaded(true);
      })
      .catch(() => {
        if (reply.current()) setCountiesLoaded(false);
      });
    return () => {
      reply.close();
    };
  }, [latestCounties, settings.layers.counties]);
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

  // The reader's own alert sound, and how loud it is played. Both are
  // settings the native side has to be told about rather than read.
  const chooseAlertSound = useAlertSound({
    volume: settings.alertVolume,
    path: settings.alertSoundPath,
    settingsRef,
    onSettings: applySettings,
    pushToast,
  });

  // One token per effect run, so an answer that arrives after a newer

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

  // The tray icon, the small window, and what that window shows. Whether
  // it is open cannot be known from here, because the tray menu opens it
  // and the workspace never hears about that.
  useGlanceWindow({
    tray: settings.tray,
    place: settings.watch.name?.trim() ?? "",
    clock,
    alertActive: overlays.alertActive,
    watchFailing: overlays.watchFailing,
    headline: overlays.announcement.text,
    observed: timeline.newestObserved,
    sourceLabel: timeline.sourceLabel,
    canvas: () => mapRef.current?.canvas() ?? null,
  });

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

  // What the weather did at the reader's places while the app was closed,
  // and the mark that says when it was last running.
  const { catchUp, dismissCatchUp } = useCatchUp({
    hydrated,
    clock,
    settingsRef,
    onSettings: applySettings,
  });
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

  // What the station near a watched place said, into the reader's own
  // record, when it changes.
  useStationRecord({
    place: settings.watch.name?.trim(),
    watching: settings.watch.enabled,
    ambient,
    journalFrame,
  });

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

  // The wind layer's shaders would not build on this card, so the viewport has
  // taken the layer back out and the switch has to follow it. Left on, it
  // described a layer that was not being drawn, and the map read as a calm
  // afternoon: the reader would have had no way to tell that from the real
  // thing. No undo, because pressing it would only fail again on the same
  // card; the switch is there to try again with.
  const handleWindUndrawable = useCallback(() => {
    const current = settingsRef.current;
    if (!current.layers.wind) return;
    applySettings({
      ...current,
      layers: { ...current.layers, wind: false },
    });
    pushToast({
      title: translate("wind.noDraw"),
      detail: translate("wind.noDrawBody"),
    });
  }, [applySettings, pushToast, settingsRef]);

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

  // The radius each watched place's rules are judged against, drawn as a ring
  // around it. Built here rather than in the map: the radius is the reader's,
  // the label is in the units they are reading in, and the map component has
  // no business knowing what a watched place is.
  const watchRings = useMemo(
    () => (settings.watchRings ? watchRingFeatures(watchedForJournal) : null),
    // The units are read by `formatDistance` from a store rather than passed
    // in, so the labels have to be rebuilt when the setting behind that store
    // changes. The rule cannot see that read and calls the dependency
    // unnecessary; without it a reader switching to metric keeps rings
    // labelled in miles until something else moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.watchRings, settings.units, watchedForJournal],
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

  // What the workspace can say about itself: the grids and sweeps that
  // have numbers behind them, the layers actually drawn and where each
  // came from, and the block a reader copies when something is wrong.
  const { dataSources, drawnOverlays, copyDiagnostics, reportIssue } =
    useWorkspaceReport({
      frames,
      frameIndex,
      singleSite,
      mrms,
      mrmsChoices,
      overlays,
      settings,
      classification,
      forecastSmoke,
      drawnForecastSmoke,
      lightning,
      wind,
      countiesDrawn,
      timeline,
      health,
      logEntries,
      mapStatus,
      notifications,
      autostart,
      lastCrash,
      lastWebviewCrash,
      webviewRuntime,
      settingsRef,
      pushToast,
      t,
    });

  const exportState = useExport({
    mapRef,
    frames,
    frameIndex,
    source,
    timeline,
    // Only when the reader asked for them. A shared picture carries the
    // weather; the scales beside it are a choice.
    keys: settings.exportKeys ? overlays.keys : EMPTY_KEYS,
    // The map under the weather, for the style on screen: an aerial picture
    // credits USGS and a topographic one credits OpenTopoMap, rather than
    // both crediting a service that did not draw them.
    // Everything drawn over the radar when the shutter opens, so the credit
    // burned into the corner and the sidecar beside the file both name the
    // offices and the models whose work is in the picture.
    overlayProvenance: () => drawnOverlays(Date.now()),
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

  // The view on the desktop, on the gap the reader chose, and putting back
  // whatever was there when they switch it off.
  useWallpaper({
    every: settings.wallpaperMinutes,
    clock,
    frameCount: frames.length,
    writeWallpaper: exportState.writeWallpaper,
    pushToast,
  });

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

  // The screen kept on while that view is showing, if the reader asked for
  // it. Logged and left alone when the system refuses: a screen that sleeps
  // anyway is a disappointment rather than a fault, and a toast over a view
  // somebody walked away from helps nobody.
  useDisplayAwake({
    wanted: settings.displayAwake,
    showing: ambientScreen,
    onFailure: (failure) =>
      log.warn(
        "display",
        failure instanceof Error ? failure.message : "The hold was refused.",
      ),
  });

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

  // A storm out of the archive: its track drawn as points, and the two
  // ways of arriving at one. Picking it frames the whole track; replaying
  // it goes to the moment the radar is about, which is a much tighter view.
  const { stormTrackData, showStorm, showStormById, replayStorm } =
    useStormTrack({
      historyStorm,
      setHistoryStorm,
      setReplay,
      mapRef,
      setActiveSurface,
      pushToast,
    });

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
   * A full-screen mode goes first and takes nothing else with it: one press
   * leaves the mode, and the next press is about the workspace underneath.
   *
   * This used to return without doing anything, under a comment saying the
   * press was already what left them. It was not. Entering either mode from
   * the command list clears the tool and the surface on the way in, so there
   * was nothing for the press to fall through to and nothing to protect; what
   * there was, was no way out but a 30 by 26 button, and only while it
   * happened to hold focus. A view entered by the idle timer did leave on any
   * key, because any key is what resets the idle clock; one asked for
   * deliberately did not leave on anything.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (ambientScreen) {
        setAmbientAsked(false);
        // Also counts as being here, which is what stops the idle rule
        // putting it straight back.
        setTouchedAt(Date.now());
        return;
      }
      if (capture) {
        setCapture(false);
        return;
      }
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

  // What a reader can do with a colour table: send it back out as the file
  // it came in as, take it off the shelf with a way back, and put one in
  // force for a unit.
  const { exportPalette, removePalette, assignPalette, offerUndo } =
    usePaletteActions({
      settingsRef,
      onSettings: applySettings,
      pushToast,
    });

  // Finding a storm in the archive takes a search and a choice, and stopping
  // the replay put the reader back at the start of both.
  // Leaving a replay, saving one as a bundle, and opening one somebody
  // else saved. An open bundle answers for its own addresses ahead of the
  // network, so every way out of its replay has to close it.
  const { stopReplay, saveReplayBundle, openBundle } = useReplayBundles({
    replay,
    setReplay,
    historyStorm,
    setHistoryStorm,
    overlayFiles,
    setOverlayFiles,
    mapRef,
    settingsRef,
    onSettings: applySettings,
    pushToast,
  });

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
          setLayersToFind(action.find === true);
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

  // What the readout answers with: the point it is about, the places it can
  // be about, and the sentence itself.
  const { centerPoint, nearbyPlaces, nearbyPlaceId, setNearbyPlaceId, nearby } =
    useNearbyReadout({
      settings,
      overlays,
      stormCells,
      replayedAlerts,
    });
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
  // What to call the frame the surfaces are drawn in while their own module
  // is still arriving, and how much room to hold for it. The panels cannot
  // answer for themselves: they are in the chunk being waited on, along with
  // the eleventh `lazy` in this app, which is the module holding the other
  // ten.
  //
  // The surface wins over the product panel when both are open, because the
  // surface is the one the reader just asked for. It is also the one whose
  // width varies: the settings-shaped panels are 410 and the wide ones 430
  // against a base of 360, and standing in for any of them at the base width
  // moved the map chrome once for the stand-in and again for the panel.
  const openFrame =
    (activeSurface ? SURFACE_FRAMES[activeSurface] : null) ??
    SURFACE_FRAMES["radar-product"];

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
          metres={settings.ambientMetres}
          // What is drawn, not what was picked. Two ways of getting this
          // wrong have been fixed here. "auto" is the default and
          // `isLightBasemap` has no case for it, so this once asked whether
          // the word "auto" was a light style, was told no, and never fired
          // for anybody who had not gone and picked a style by hand. And an
          // incident pack replaces the basemap outright, so the picked style
          // says nothing at all about the ground while one is open.
          overLight={drawnOverLight(
            settings.mapStyle,
            settings.theme,
            settings.incidentPacks.selectedId !== null,
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
      {catchUp && !overlays.alertActive ? (
        // Stood down while a warning is in force at a watched place, like
        // everything else discoverable here: a map with a warning on it is a
        // serious instrument and this is a card about last Tuesday.
        <CatchUpCard
          summary={catchUp}
          onDismiss={dismissCatchUp}
          onOpenRecord={() => {
            dismissCatchUp();
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
        watchRings={watchRings}
        customOverlay={overlayShapes}
        stormTrack={stormTrackData}
        sweep={singleSite.sweep}
        mrmsLayers={singleSite.historical ? [] : mrms.layers}
        clock={clock}
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
        onWindUndrawable={handleWindUndrawable}
      />

      {activeSurface || productOpen ? (
        <LazyPanel
          title={t(openFrame.key)}
          className={openFrame.className}
          onClose={() => {
            setActiveSurface(null);
            setProductOpen(false);
          }}
        >
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
                : // A foreign office that did not answer is worth saying for the
                  // same reason the second reports source is: the map is
                  // missing that country's warnings and looks exactly like a
                  // country that has none.
                  (overlays.states.alerts.error ??
                  overlays.states.alerts.partial),
              spcOutlooks:
                overlays.states.spcOutlooks.error ??
                overlays.states.spcOutlooks.partial,
              spcDiscussions: overlays.states.spcDiscussions.error,
              // The two the map draws from the Weather Prediction Center. Left
              // out, their rows said a source was not answering with nothing
              // under them to say what happened.
              wpcExcessiveRain: overlays.states.wpcExcessiveRain.error,
              wpcWinterSeverity: overlays.states.wpcWinterSeverity.error,
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
            layersToFind={layersToFind}
            productOpen={productOpen}
            settings={settings}
            overlayKeys={overlays.keys}
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
                      //
                      // And a fetched time means a list is standing, which is
                      // what the footer reads to decide between "showing the
                      // last good list" and no list at all. An archive that
                      // would not answer leaves `data` null, and stamping the
                      // clock there had the panel offering a last good list
                      // over nothing: `loading` is `wanted && !held` and the
                      // error lives on `held`, so an error always implied a
                      // finished load and the failure branch was unreachable
                      // for the whole of a replay.
                      fetchedAt:
                        archiveWarnings.loading ||
                        (archiveWarnings.error !== null &&
                          !archiveWarnings.data)
                          ? null
                          : clock,
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
            onExportPalette={exportPalette}
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
            onReportIssue={reportIssue}
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
        </LazyPanel>
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
        updateVersion={
          updates.state.status === "available"
            ? updates.state.offer.version
            : null
        }
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
        siteStatus={siteStatus}
        sitesInReach={singleSite.inReach}
        onHoldSite={(station) =>
          applySettings({
            ...settingsRef.current,
            radar: {
              ...settingsRef.current.radar,
              station,
              // The same rule the picker's own row applies. A terminal radar
              // draws products no WSR-88D has, so moving off one without this
              // left the panel showing a choice the map was not drawing and a
              // threshold slider writing to a product nothing read.
              product: supportedProduct(
                station,
                settingsRef.current.radar.product,
              ),
            },
          })
        }
        mrmsLayers={singleSite.historical ? [] : mrms.layers}
        overlayKeys={overlays.keys}
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
          // Pressed the rail, so they came to press a switch.
          setLayersToFind(false);
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
