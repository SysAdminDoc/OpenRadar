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
import type { Curiosity } from "./lib/curiosities";
import { useAmbient } from "./hooks/useAmbient";
import { setJournalWriting, thumbnailFrom } from "./lib/journal";
import type { MapViewportHandle } from "./components/MapViewport";
import { CaptureBar } from "./components/CaptureBar";
import { WorkspaceChrome } from "./components/WorkspaceChrome";
import { EMPTY_OVERLAY } from "./lib/overlays";
import { useMinuteClock, useReducedMotion } from "./hooks/useClock";
import { useExport } from "./hooks/useExport";
import { useWorkspaceOverlays } from "./hooks/useWorkspaceOverlays";
import { useRadarTimeline } from "./hooks/useRadarTimeline";
import { useSettings } from "./hooks/useSettings";
import { useToasts, UNDO_LIFETIME_MS } from "./hooks/useToasts";
import { useAutostart } from "./hooks/useAutostart";
import { notificationPermission, type NotifyPermission } from "./lib/notify";
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
import { useWorkspaceFeeds } from "./hooks/useWorkspaceFeeds";
import { useWorkspacePresses } from "./hooks/useWorkspacePresses";
import { useCommandActions } from "./hooks/useCommandActions";
import { useMapHandlers } from "./hooks/useMapHandlers";
import { useOccasionNotice } from "./hooks/useOccasionNotice";
import { useEscapeKey } from "./hooks/useEscapeKey";
import { useOverlayShapes } from "./hooks/useOverlayShapes";
import { useWatchedPlaces } from "./hooks/useWatchedPlaces";
import { useOpenPanel } from "./hooks/useOpenPanel";
import { usePresence } from "./hooks/usePresence";
import { useAmbientScreen } from "./hooks/useAmbientScreen";
import { useFollowSignal, useFollowWarning } from "./hooks/useFollowWarning";
import { useWelcomeHint } from "./hooks/useWelcomeHint";
import { loadCounties } from "./lib/counties";
import { useNativeReports } from "./hooks/useNativeReports";
import { usePalette } from "./hooks/usePalette";
import { useSingleSiteRadar } from "./hooks/useSingleSiteRadar";
import { useRadarStatus } from "./hooks/useRadarStatus";
import { statusFor } from "./lib/radarStatus";
import { useUpdates } from "./hooks/useUpdates";
import { useWorkspaceActions } from "./hooks/useWorkspaceActions";
import { LazyPanel } from "./components/LazyPanel";
import type { GeoPoint } from "./lib/geo";
import { recentLog, subscribeLog } from "./lib/log";
import type { OverlayBounds, OverlayLegend } from "./lib/overlays";
import {
  providerHealth,
  loadProviderIncidents,
  subscribeHealth,
} from "./lib/providers";
import type { Storm } from "./lib/hurdat";
import { basemapCredit, drawnOverLight } from "./lib/mapStyles";
import { supportedProduct } from "./lib/radarKinds";
import { level2Available } from "./lib/level2";

import { bundlesAvailable } from "./lib/replayBundle";
import type { ArchiveReplay } from "./hooks/useRadarTimeline";
import type { LayerSettings, MapStyleId, RadarSettings } from "./lib/settings";
import {
  noteWorkspaceDrawn,
  restoreArrangement,
  settingsRecovery,
  startedPlain,
} from "./lib/settings";
import { type WorkspaceOverlayFile } from "./lib/workspaceOverlays";
import { translate, useT } from "./i18n";
import { fetchVwp, vwpAvailable } from "./lib/vwp";
import type { SpcHazard } from "./lib/overlays/registry";
import { OVERLAY_ADAPTERS } from "./lib/overlays";

import { activePalettes } from "./lib/palette";
import { METAR_MIN_ZOOM } from "./lib/overlays/metar";
import { GAUGE_MIN_ZOOM } from "./lib/overlays/rivers";
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
  // Whether anybody is there, and when they last said so.
  const { pageVisible, touchedAt, setTouchedAt } = usePresence();
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

  // An announcement waiting for the polygon it is about, which arrives on
  // the render after it.
  const {
    signal: followSignal,
    remember: rememberFollow,
    take: takeFollow,
  } = useFollowSignal();

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
    closeToTray: settings.closeToTray,
    glanceOnTop: settings.glanceOnTop,
    language: settings.language,
    autostart,
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

  // One line, once a year, the first time a seasonal pack is on screen.
  useOccasionNotice({
    appearance,
    hydrated,
    settingsRef,
    onSettings: applySettings,
    pushToast,
  });

  // Take the map to a warning as it arrives, when the reader asked for that.
  //
  // Through a ref because the watch is inside the hook that produces the
  // alerts this reads: the callback has to exist before the hook is called
  // and see the state that comes out of it.

  // Three presses that answer a reader rather than the weather: the layer
  // that explains a warning, the switch that gives up on a wind field the
  // map could not draw, and the test that proves a notification works.
  const { applyPairing, handleWindUndrawable, sendWatchTest } =
    useWorkspacePresses({
      settingsRef,
      onSettings: applySettings,
      pushToast,
      overlays,
    });

  // The third of the three things that open an entry in the record, after a
  // warning reaching a named place and the sky changing at one. All three are
  // the weather doing something; nothing the reader does writes a row.
  // The places being watched, and the ring drawn round each of them.
  const { watchedForJournal, watchRings } = useWatchedPlaces(settings);

  // Everything the map draws that is not the radar picture itself: the
  // cells the site's own tracker found, what the algorithm says is falling,
  // the national grids, the lightning, the wind, that day's warnings during
  // a replay, and the model's smoke.
  const {
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
    compareSatelliteTime,
  } = useWorkspaceFeeds({
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
  });

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
  // The reader's own imported shapes, cut to whatever each file says it is
  // for, and the volume times the wind profile is drawn for.
  const { overlayShapes, vwpTimes } = useOverlayShapes({
    overlayFiles,
    zoom: settings.camera.zoom,
    frameTime: activeFrame?.time ?? null,
    clock,
    volumes: singleSite.volumes,
  });

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
      snowfall,
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

  // Take the map to a warning as it arrives, when the reader asked for
  // that. The flight happens here rather than where the alert is announced,
  // because the watch speaks the moment it sees a warning and the polygon
  // it is about reaches this component on the render after that.
  useFollowWarning({
    signal: followSignal,
    take: takeFollow,
    alerts: overlays.data.alerts,
    exportBusy: exportState.busy,
    settingsRef,
    onSettings: applySettings,
    pushToast,
    mapRef,
  });

  // Where the camera came to rest, which is the only moment anything is
  // looked for. Held apart from the settings camera, which is written on a
  // debounce and is a record of where to open next time rather than a signal.
  const [resting, setResting] = useState<{
    center: [number, number];
    zoom: number;
  } | null>(null);
  const [curiosity, setCuriosity] = useState<Curiosity | null>(null);

  // Whether the full-screen view is actually on, and the screen held awake
  // while it is.
  const ambientScreen = useAmbientScreen({
    asked: ambientAsked,
    idleMinutes: settings.ambientIdleMinutes,
    idleMs,
    alertActive: overlays.alertActive,
    displayAwake: settings.displayAwake,
  });

  // What the map itself calls back into: where the camera came to rest,
  // whether the renderer came up, and which tool is armed.
  const { handleCameraChange, handleMapStatus, handleTool } = useMapHandlers({
    settings,
    settingsRef,
    onSettings: applySettings,
    hydrated,
    overlays,
    replay,
    resting,
    setResting,
    setCuriosity,
    updateCamera,
    setViewport,
    setMapStatus,
    setActiveTool,
    setActiveSurface,
    mapRef,
    writingLoopRef,
    setProductOpen,
    secondMapRef,
    exportBusy: exportState.busy,
  });

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

  // Escape, from anywhere a panel did not already handle it. One press
  // dismisses one thing, in the order somebody would name them.
  useEscapeKey({
    activeSurface,
    activeTool,
    ambientScreen,
    capture,
    productOpen,
    handleTool,
    setActiveSurface,
    setProductOpen,
    setAmbientAsked,
    setCapture,
    setTouchedAt,
  });

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

  // One place that knows how to do each kind of thing the palette offers,
  // so the palette itself stays a list rather than a second copy of the app.
  const runCommand = useCommandActions({
    settingsRef,
    onSettings: applySettings,
    setActiveSurface,
    setLayersToFind,
    setProductOpen,
    setAmbientAsked,
    setCapture,
    handleTool,
    mapRef,
  });

  // What the readout answers with: the point it is about, the places it can
  // be about, and the sentence itself.
  const { centerPoint, nearbyPlaces, nearbyPlaceId, setNearbyPlaceId, nearby } =
    useNearbyReadout({
      settings,
      overlays,
      stormCells,
      replayedAlerts,
    });
  // How old the picture is, which side the open panel is on, and what to
  // call the frame it is drawn in while its own module is still arriving.
  const { radarAge, panelSide, openFrame } = useOpenPanel({
    newestObserved: timeline.newestObserved,
    clock,
    activeSurface,
    productOpen,
  });

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
        compareSatelliteTime={compareSatelliteTime}
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
        snowfall={drawnSnowfall}
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
              snowfall: snowfall.error,
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
              // The two layers added on 2026-09-10. Left out, a buoy network
              // that refused said nothing at all, and the aviation layer's
              // own note about a product that did not answer was written into
              // a field nothing rendered: four hazard services could all be
              // down and the layer would draw clear air, call itself fresh,
              // and say nothing about it.
              buoys: overlays.states.buoys.error,
              aviation:
                overlays.states.aviation.error ??
                overlays.states.aviation.partial,
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
            cellJumps={cellJumps}
            melting={melting}
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
            onSnowfallWindow={(snowfallWindow) =>
              applySettings({ ...settingsRef.current, snowfallWindow })
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
        snowfall={drawnSnowfall ? snowfall.analysis : null}
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
