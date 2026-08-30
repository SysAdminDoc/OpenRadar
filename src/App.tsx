import { LoaderCircle, Radar } from "lucide-react";
import {
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
import { PanelSurfaces } from "./components/PanelSurfaces";
import { WorkspaceChrome } from "./components/WorkspaceChrome";
import { useMinuteClock } from "./hooks/useClock";
import { useExport } from "./hooks/useExport";
import { useWorkspaceOverlays } from "./hooks/useWorkspaceOverlays";
import { useRadarTimeline } from "./hooks/useRadarTimeline";
import { useSettings } from "./hooks/useSettings";
import { useToasts } from "./hooks/useToasts";
import { useMrmsOverlays } from "./hooks/useMrmsOverlays";
import { useLightning } from "./hooks/useLightning";
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

export default function App() {
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
  const [toolResult, setToolResult] = useState<string | null>(null);
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
        title: "Settings were not saved",
        detail: "The current window is still using your changes.",
      }),
    [pushToast],
  );
  const { settings, hydrated, settingsRef, applySettings, updateCamera } =
    useSettings({ onPersistError });

  const overlays = useWorkspaceOverlays({
    settings,
    viewport,
    pushToast,
    setActiveSurface,
  });

  const timeline = useRadarTimeline({
    ready: hydrated,
    center: settings.camera.center,
    loopMinutes: settings.radar.loopMinutes,
    animationSpeed: settings.radar.animationSpeed,
    futureRadar: settings.radar.futureRadar,
    pageVisible,
    archive: replay,
  });
  const singleSite = useSingleSiteRadar({
    ready: hydrated,
    radar: settings.radar,
    center: settings.camera.center,
    zoom: settings.camera.zoom,
    pageVisible,
  });
  const mrms = useMrmsOverlays({
    ready: hydrated,
    layers: settings.layers,
    pageVisible,
  });
  const lightning = useLightning({
    ready: hydrated,
    enabled: settings.layers.lightningFlashes,
    pageVisible,
  });
  const { frames, frameIndex, source } = timeline;
  const activeFrame = frames[frameIndex];
  const compareFrame = frames[Math.max(0, frameIndex - compareOffset)];

  // The satellite image that stands for a frame, held back to the newest slot
  // the archive has actually published.
  const satelliteFor = (frame: RadarFrame | undefined) =>
    settings.layers.satellite && frame
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
        label: "Iowa State radar archive",
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
        title: `Replaying ${storm.name} ${storm.year}`,
        detail: focus.landfall
          ? "Archive radar around landfall. Close it to go live."
          : "Archive radar around its closest approach. Close it to go live.",
      });
    },
    [pushToast],
  );

  // One place that knows how to do each kind of thing the palette offers, so
  // the palette itself stays a list rather than a second copy of the app.
  const runCommand = useCallback(
    (action: CommandAction) => {
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

  if (!hydrated) {
    return (
      <main className="startup-screen">
        <div className="brand-mark">
          <Radar size={34} />
        </div>
        <p className="eyebrow">OpenRadar</p>
        <h1>Preparing the map</h1>
        <LoaderCircle className="spin" size={20} />
      </main>
    );
  }

  return (
    <main className={`app-shell ${dualPane ? "is-dual-pane" : ""}`}>
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
        mrmsLayers={mrms.layers}
        flashes={lightning.points}
        activeTool={activeTool}
        dualPane={dualPane}
        compareOffset={compareOffset}
        onCompareOffset={setCompareOffset}
        onCameraChange={handleCameraChange}
        onPrimaryMove={(camera) => secondMapRef.current?.syncCamera(camera)}
        onSecondaryMove={(camera) => mapRef.current?.syncCamera(camera)}
        onCursorChange={setCursor}
        onToolResult={setToolResult}
        onMapStatus={handleMapStatus}
      />

      <PanelSurfaces
        activeSurface={activeSurface}
        productOpen={productOpen}
        settings={settings}
        overlays={overlays.states}
        viewport={viewport}
        centerPoint={centerPoint}
        frameCount={frames.length}
        sourceLabel={timeline.sourceLabel}
        singleSite={level2Available() ? singleSite : null}
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
        onHistoryStorm={showStorm}
        onReplayStorm={replayStorm}
        onStopReplay={() => setReplay(null)}
        onRoute={setRoute}
        onUpload={actions.uploadOverlay}
        onWatchHere={actions.watchHere}
        onOpenLogFolder={actions.openLogFolder}
        onReset={actions.resetSettings}
      />

      <WorkspaceChrome
        settings={settings}
        timeline={timeline}
        frames={frames}
        sweep={singleSite.sweep}
        mrmsLayers={mrms.layers}
        lightning={lightning.window}
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
            title: dualPane ? "Dual pane closed" : "Dual pane opened",
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
