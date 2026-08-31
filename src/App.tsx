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
import type { MapViewportHandle } from "./components/MapViewport";
import { WorkspaceChrome } from "./components/WorkspaceChrome";
import {
  useMinuteClock,
  useReducedMotion,
  useSecondClock,
} from "./hooks/useClock";
import { useExport } from "./hooks/useExport";
import { useWorkspaceOverlays } from "./hooks/useWorkspaceOverlays";
import { useRadarTimeline } from "./hooks/useRadarTimeline";
import { useSettings } from "./hooks/useSettings";
import { useToasts } from "./hooks/useToasts";
import { useWelcomeHint } from "./hooks/useWelcomeHint";
import { useMrmsOverlays } from "./hooks/useMrmsOverlays";
import { useLightning } from "./hooks/useLightning";
import { usePalette } from "./hooks/usePalette";
import { useWind } from "./hooks/useWind";
import { useSingleSiteRadar } from "./hooks/useSingleSiteRadar";
import { useUpdates } from "./hooks/useUpdates";
import { useWorkspaceActions } from "./hooks/useWorkspaceActions";
import type { CommandAction } from "./lib/commands";
import type { GeoPoint } from "./lib/geo";
import { recentLog, subscribeLog } from "./lib/log";
import type { OverlayBounds } from "./lib/overlays";
import {
  providerHealth,
  satelliteFrameTime,
  subscribeHealth,
} from "./lib/providers";
import { frameAgeMinutes, type RadarFrame } from "./lib/radar";
import {
  archiveFrames,
  replayFocus,
  stormTrack,
  trackBounds,
  type Storm,
} from "./lib/hurdat";
import { level2Available } from "./lib/level2";
import type { ArchiveReplay } from "./hooks/useRadarTimeline";
import type {
  CameraState,
  LayerSettings,
  MapStyleId,
  RadarSettings,
} from "./lib/settings";
import { translate, useT } from "./i18n";
import { diagnosticsBlock } from "./lib/diagnostics";
import { OVERLAY_ADAPTERS } from "./lib/overlays";
import {
  overlayProvenance,
  radarProvenance,
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
import { useProbSevere } from "./hooks/useProbSevere";
import { gpuSupport } from "./lib/gpu";

const PanelSurfaces = lazy(async () => {
  const module = await import("./components/PanelSurfaces");
  return { default: module.PanelSurfaces };
});

export default function App() {
  const t = useT();
  const [activeSurface, setActiveSurface] = useState<SurfaceId>(null);
  const [productOpen, setProductOpen] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolMode>(null);
  const [dualPane, setDualPane] = useState(false);
  const [compareOffset, setCompareOffset] = useState(0);
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  const [mapStatus, setMapStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
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
  const [route, setRoute] = useState<Record<string, unknown> | null>(null);
  const [customOverlay, setCustomOverlay] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [historyStorm, setHistoryStorm] = useState<Storm | null>(null);
  const [replay, setReplay] = useState<ArchiveReplay | null>(null);
  const mapRef = useRef<MapViewportHandle>(null);
  const secondMapRef = useRef<MapViewportHandle>(null);

  const clock = useMinuteClock();
  const health = useSyncExternalStore(subscribeHealth, providerHealth);
  const logEntries = useSyncExternalStore(subscribeLog, recentLog);
  const toasts = useToasts();
  const pushToast = toasts.push;

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
    push: pushToast,
    onSeen: markWelcomeSeen,
  });

  const paletteGeneration = usePalette({
    ready: hydrated,
    palette: settings.palette,
  });

  const timeline = useRadarTimeline({
    ready: hydrated,
    center: settings.camera.center,
    loopMinutes: settings.radar.loopMinutes,
    animationSpeed: settings.radar.animationSpeed,
    futureRadar: settings.radar.futureRadar,
    pageVisible,
    archive: replay,
    paletteGeneration,
    // The mosaic has a threshold of its own. It is composite reflectivity,
    // the strongest return anywhere in the column, and the single-site product
    // is one tilt of it; the same number means something different in each, so
    // setting a floor on the tilt must not quietly re-floor the mosaic.
    mosaicThreshold: settings.radar.thresholds.mosaic ?? null,
  });
  const singleSite = useSingleSiteRadar({
    ready: hydrated,
    radar: settings.radar,
    center: settings.camera.center,
    zoom: settings.camera.zoom,
    pageVisible,
    paletteGeneration,
  });

  const overlays = useWorkspaceOverlays({
    settings,
    viewport,
    pushToast,
    setActiveSurface,
    // Today's warnings and reports cannot sit on a volume from another day.
    replaying: replay !== null || singleSite.historical,
  });

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

  // Tied to whichever site the single-site radar is reading, because the cells
  // are that radar's own account of that volume.
  const stormCells = useStormCells({
    ready: hydrated,
    enabled: settings.layers.stormCells && !singleSite.historical,
    station: singleSite.station,
    pageVisible,
    clock,
  });
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

  const mrms = useMrmsOverlays({
    ready: hydrated,
    layers: settings.layers,
    pageVisible,
    paletteGeneration,
  });
  const lightning = useLightning({
    ready: hydrated,
    enabled: settings.layers.lightningFlashes,
    pageVisible,
    clock,
  });
  // Animated particles are motion for its own sake, so a viewer who has asked
  // for less of it does not get them at all.
  const reducedMotion = useReducedMotion();
  const wind = useWind({
    ready: hydrated,
    enabled: settings.layers.wind && !reducedMotion,
    pageVisible,
  });
  const { frames, frameIndex, source } = timeline;
  const activeFrame = frames[frameIndex];
  // A comparison that asks for more history than exists is left empty. Using
  // the first frame while labelling it "12 back" gave a precise label to a
  // different moment.
  const compareFrame =
    frameIndex >= compareOffset
      ? frames[frameIndex - compareOffset]
      : undefined;

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
    setCustomOverlay,
    customOverlay,
  });
  const exportState = useExport({
    mapRef,
    frames,
    frameIndex,
    source,
    timeline,
    pushToast,
  });

  useEffect(() => {
    const onVisibility = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const handleCameraChange = useCallback(
    (camera: CameraState) => {
      updateCamera(camera);
      setViewport(mapRef.current?.bounds() ?? null);
    },
    [updateCamera],
  );

  const handleMapStatus = useCallback(
    (status: "loading" | "ready" | "error") => {
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

  const stormTrackData = useMemo(
    () => (historyStorm ? stormTrack(historyStorm) : null),
    [historyStorm],
  );

  // Picking a storm frames its whole track; replaying one goes to the moment
  // the radar is about, which is a much tighter view.
  const showStorm = useCallback((storm: Storm | null) => {
    setHistoryStorm(storm);
    setReplay(null);
    if (storm) mapRef.current?.fitBounds(trackBounds(storm.track));
  }, []);

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
  const copyDiagnostics = useCallback(() => {
    const now = Date.now();
    // What is actually on the map right now, each layer saying where it came
    // from and what it claims. Only the frame on screen and the overlays that
    // are both switched on and holding data, because a record for something
    // the reader cannot see would be describing a different picture from the
    // one they are writing about.
    const layers: Provenance[] = [];
    const shown = timeline.frames[timeline.frameIndex];
    if (shown) {
      // How long a loop stays fresh is the gap between its own frames, which
      // is what the provider publishes on. Two frames are needed to know it,
      // and a single-frame loop simply does not say.
      const step =
        timeline.frames.length > 1
          ? (timeline.frames[1].time - timeline.frames[0].time) * 1000
          : null;
      layers.push(
        radarProvenance({
          frame: shown,
          provider: timeline.source,
          fetchedAt: now,
          // What the timeline already knew and the record was throwing away:
          // whether these bytes came off the disk, and how old they were when
          // they did. It is the first thing worth knowing about a picture that
          // looks wrong.
          cachedAgeSeconds: timeline.cachedAgeSeconds,
          freshForMs: step && step > 0 ? step * 2 : null,
        }),
      );
    }
    for (const adapter of OVERLAY_ADAPTERS) {
      const state = overlays.states[adapter.id];
      if (!overlays.data[adapter.id] || !state?.fetchedAt) continue;
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
    const mrmsTimes = new Map(
      mrms.layers.map((layer) => [layer.product, layer.time * 1000]),
    );
    for (const [key, on] of Object.entries(settings.layers)) {
      const layer = key as keyof typeof settings.layers;
      if (!on) continue;
      // Switched on is not the same as drawing. A record for a layer that
      // fetched nothing describes a picture the reader cannot see, which is
      // the opposite of what a report about the picture is for.
      if (layer === "wind" && !wind.field) continue;
      if (layer === "lightningFlashes" && !lightning.window) continue;
      const source = LAYER_SOURCES[layer];
      // Matched on the source rather than on the switch's own name, because
      // the two do not agree: the alerts adapter is `alerts` and the switch
      // that draws it is `weatherAlerts`. Comparing the names would have let
      // that one layer be reported twice under both.
      if (COVERED_BY_ADAPTERS.has(source.sourceId)) continue;
      const observedAt =
        mrmsTimes.get(source.sourceId as never) ??
        (layer === "lightningFlashes"
          ? // The flash window carries seconds, like the radar frames and
            // unlike everything in a record. Passed straight through it dated
            // every lightning layer to 1970.
            lightning.window
            ? lightning.window.observed * 1000
            : null
          : null);
      // The wind layer is the one forecast here whose run the app already
      // reads, so it can report a real one rather than saying it does not know.
      const modelRun =
        layer === "wind" && wind.field
          ? {
              initUtc: wind.field.init,
              leadMinutes: wind.field.leadHours * 60,
            }
          : undefined;
      layers.push(
        layerProvenance({
          layer,
          fetchedAt: now,
          observedAt: observedAt ?? now,
          validAt: modelRun
            ? now + modelRun.leadMinutes * 60_000
            : (observedAt ?? now),
          modelRun,
        }),
      );
    }
    const block = diagnosticsBlock({
      renderer: gpuSupport().renderer,
      mapReady: mapStatus === "ready",
      radarReady: timeline.frames.length > 0,
      activeSource: timeline.sourceLabel,
      health,
      log: logEntries,
      layers,
      now,
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
  }, [
    health,
    lightning.window,
    wind.field,
    logEntries,
    mrms.layers,
    settings,
    mapStatus,
    overlays.data,
    overlays.states,
    pushToast,
    timeline,
  ]);

  // Loading a colour table is work: a file found, opened and dropped on the
  // window. Clearing it was the one action that threw that away with nothing
  // to say so and no way back.
  const clearPalette = useCallback(() => {
    const previous = settingsRef.current.palette;
    applySettings({ ...settingsRef.current, palette: null });
    pushToast({
      title: translate("toast.paletteCleared"),
      detail: translate("toast.paletteClearedBody"),
      actionLabel: translate("toast.undo"),
      onAction: () =>
        applySettings({ ...settingsRef.current, palette: previous }),
    });
  }, [applySettings, pushToast, settingsRef]);

  // Finding a storm in the archive takes a search and a choice, and stopping
  // the replay put the reader back at the start of both.
  const stopReplay = useCallback(() => {
    setReplay(null);
    if (!replay) return;
    pushToast({
      title: translate("toast.replayStopped"),
      detail: translate("toast.replayStoppedBody"),
      actionLabel: translate("toast.undo"),
      onAction: () => setReplay(replay),
    });
    // Depends on the replay itself rather than a ref read during render, which
    // React refuses. It changes when a storm is chosen, which is rare.
  }, [pushToast, replay]);

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
    >
      <MapStage
        settings={settings}
        mapRef={mapRef}
        secondMapRef={secondMapRef}
        activeFrame={activeFrame}
        compareFrame={compareFrame}
        satelliteTime={satelliteTime}
        compareSatelliteTime={satelliteFor(compareFrame)}
        satelliteAgeMinutes={
          satelliteTime === null
            ? null
            : Math.max(0, Math.floor(clock / 60_000 - satelliteTime / 60))
        }
        overlays={overlays.data}
        route={route}
        customOverlay={customOverlay}
        stormTrack={stormTrackData}
        sweep={singleSite.sweep}
        mrmsLayers={singleSite.historical ? [] : mrms.layers}
        cells={stormCells.features}
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
        onMapStatus={handleMapStatus}
      />

      {activeSurface || productOpen ? (
        <Suspense fallback={null}>
          <PanelSurfaces
            layerNotes={{
              weatherAlerts: overlays.states.alerts.error,
              spcOutlooks: overlays.states.spcOutlooks.error,
              spcDiscussions: overlays.states.spcDiscussions.error,
              stormReports: overlays.states.stormReports.error,
              stormCells: stormCells.error,
              probSevere: probSevere.error,
              earthquakes: overlays.states.earthquakes.error,
              wildfires: overlays.states.wildfires.error,
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
              lightningFlashes: lightning.error,
              wind: wind.error,
            }}
            activeSurface={activeSurface}
            productOpen={productOpen}
            settings={settings}
            overlays={overlays.states}
            viewport={viewport}
            centerPoint={centerPoint}
            frameCount={frames.length}
            sourceLabel={timeline.sourceLabel}
            singleSite={level2Available() ? singleSite : null}
            stormCells={stormCells}
            clock={clock}
            update={updates.state}
            onUpdate={updates.act}
            historyStormId={historyStorm?.id ?? null}
            replayId={replay?.id ?? null}
            mapReady={mapStatus === "ready"}
            health={health}
            log={logEntries}
            exportState={exportState}
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
            onClearPalette={clearPalette}
            onAlertTypes={(alertTypes) =>
              applySettings({ ...settingsRef.current, alertTypes })
            }
            onOverlayOpacity={(overlayOpacity) =>
              applySettings({ ...settingsRef.current, overlayOpacity })
            }
            onOverlayOrder={(overlayOrder) =>
              applySettings({ ...settingsRef.current, overlayOrder })
            }
            onSurgeCategory={(surgeCategory) =>
              applySettings({ ...settingsRef.current, surgeCategory })
            }
            onHistoryStorm={showStorm}
            onReplayStorm={replayStorm}
            onStopReplay={stopReplay}
            onRoute={setRoute}
            onUpload={actions.uploadOverlay}
            onWatchHere={actions.watchHere}
            onSendWatchTest={sendWatchTest}
            onOpenLogFolder={actions.openLogFolder}
            onCopyDiagnostics={copyDiagnostics}
            onReset={actions.resetSettings}
            onExportSettings={actions.exportSettings}
          />
        </Suspense>
      ) : null}

      <WorkspaceChrome
        settings={settings}
        liveClock={liveClock}
        timeline={timeline}
        frames={frames}
        sweep={singleSite.sweep}
        mrmsLayers={singleSite.historical ? [] : mrms.layers}
        lightning={singleSite.historical ? null : lightning.window}
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
      />
    </main>
  );
}
