import { CloudRain, LoaderCircle, Radar, Trash2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  CommandBar,
  type SurfaceId,
  type ToolMode,
} from "./components/CommandBar";
import { MapViewport, type MapViewportHandle } from "./components/MapViewport";
import {
  RadarLegend,
  RadarTimeline,
  ZoomControls,
} from "./components/MapChrome";
import { ToastHost, type ToastMessage } from "./components/ToastHost";
import type { GeoPoint } from "./lib/geo";
import { formatFrameTime, frameAgeMinutes, type RadarFrame } from "./lib/radar";
import { providerHealth, subscribeHealth } from "./lib/providers";
import { log, recentLog, subscribeLog } from "./lib/log";
import { deepLinkUrl, viewFromDeepLink, webLinkUrl } from "./lib/deepLink";
import { satelliteFrameTime } from "./lib/providers";
import { looksLikePlacefile, parsePlacefile } from "./lib/placefile";
import {
  exportFileName,
  exportLoop,
  exportStill,
  type ExportCaption,
} from "./lib/export";
import { saveFile } from "./lib/saveFile";
import { appLogDir } from "@tauri-apps/api/path";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  DEFAULT_SETTINGS,
  isDesktopRuntime,
  normalizeSettings,
  type CameraState,
  type MapStyleId,
  type ProjectionMode,
  type RadarSettings,
} from "./lib/settings";
import { useOverlays } from "./hooks/useOverlays";
import { useSettings } from "./hooks/useSettings";
import { useMinuteClock } from "./hooks/useClock";
import { useRadarTimeline } from "./hooks/useRadarTimeline";
import type { OverlayBounds } from "./lib/overlays";
import { AlertsPanel } from "./panels/AlertsPanel";
import { TropicalPanel } from "./panels/TropicalPanel";
import { RoutePanel } from "./panels/RoutePanel";
import { ExportPanel } from "./panels/ExportPanel";
import { ForecastPanel } from "./panels/ForecastPanel";
import {
  LayersPanel,
  MapTypePanel,
  SettingsPanel,
} from "./panels/MapOptionsPanels";
import { RadarProductPanel } from "./panels/RadarProductPanel";
import { SearchPanel } from "./panels/SearchPanel";
import { MorePanel, UploadPanel } from "./panels/UtilityPanels";
import type { PlaceResult } from "./lib/weather";

const COMPARE_OFFSETS = [0, 3, 6, 12];

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
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [customOverlay, setCustomOverlay] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const mapRef = useRef<MapViewportHandle>(null);
  const secondMapRef = useRef<MapViewportHandle>(null);
  const toastIdRef = useRef(0);

  const clock = useMinuteClock();
  const health = useSyncExternalStore(subscribeHealth, providerHealth);
  const logEntries = useSyncExternalStore(subscribeLog, recentLog);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback((message: Omit<ToastMessage, "id">) => {
    const id = ++toastIdRef.current;
    setToasts((current) => [...current.slice(-2), { ...message, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 5200);
  }, []);

  const onPersistError = useCallback(() => {
    pushToast({
      title: "Settings were not saved",
      detail: "The current window is still using your changes.",
    });
  }, [pushToast]);
  const { settings, hydrated, settingsRef, applySettings, updateCamera } =
    useSettings({ onPersistError });

  const overlayToggles = useMemo(
    () => ({
      alerts: settings.layers.weatherAlerts,
      earthquakes: settings.layers.earthquakes,
      wildfires: settings.layers.wildfires,
      tropical: settings.layers.tropical,
    }),
    [
      settings.layers.weatherAlerts,
      settings.layers.earthquakes,
      settings.layers.wildfires,
      settings.layers.tropical,
    ],
  );
  const overlays = useOverlays(overlayToggles, viewport);
  const overlayData = useMemo(
    () => ({
      alerts: overlayToggles.alerts ? overlays.alerts.data : null,
      earthquakes: overlayToggles.earthquakes
        ? overlays.earthquakes.data
        : null,
      wildfires: overlayToggles.wildfires ? overlays.wildfires.data : null,
      tropical: overlayToggles.tropical ? overlays.tropical.data : null,
    }),
    [overlayToggles, overlays],
  );

  const timeline = useRadarTimeline({
    ready: hydrated,
    center: settings.camera.center,
    loopMinutes: settings.radar.loopMinutes,
    animationSpeed: settings.radar.animationSpeed,
    futureRadar: settings.radar.futureRadar,
    pageVisible,
  });
  const { frames, frameIndex, playing, source } = timeline;
  const activeFrame = frames[frameIndex];
  const compareFrame = frames[Math.max(0, frameIndex - compareOffset)];
  // The satellite image that stands for the frame on screen, held back to the
  // newest slot the archive has actually published.
  const satelliteFor = (frame: RadarFrame | undefined) =>
    settings.layers.satellite && frame
      ? satelliteFrameTime(frame.time, Math.floor(clock / 1000))
      : null;
  const satelliteTime = satelliteFor(activeFrame);
  const compareSatelliteTime = satelliteFor(compareFrame);

  const handleOpenLogFolder = useCallback(() => {
    void (async () => {
      try {
        await revealItemInDir(await appLogDir());
      } catch {
        pushToast({
          title: "The log folder could not be opened",
          detail: "Logs are only written by the desktop app.",
        });
      }
    })();
  }, [pushToast]);

  const applySharedView = useCallback(
    (link: string) => {
      const view = viewFromDeepLink(link, settingsRef.current.camera);
      if (!view) return;
      applySettings({
        ...settingsRef.current,
        camera: view.camera,
        projection: view.projection,
      });
      mapRef.current?.flyTo(view.camera);
      pushToast({ title: "Opened a shared view" });
    },
    [applySettings, pushToast, settingsRef],
  );

  useEffect(() => {
    if (!hydrated || !isDesktopRuntime()) return;
    let stop: (() => void) | null = null;
    let active = true;

    void (async () => {
      const { getCurrent, onOpenUrl } =
        await import("@tauri-apps/plugin-deep-link");
      if (!active) return;
      // A link that started the app arrives here; later ones come through the
      // listener, because the single-instance plugin routes them to this window.
      const startup = await getCurrent();
      if (active && startup?.length) applySharedView(startup[0]);
      const unlisten = await onOpenUrl((urls) => {
        if (urls.length) applySharedView(urls[0]);
      });
      if (active) stop = unlisten;
      else unlisten();
    })().catch(() => {
      log.warn("app", "Shared links are not available in this build.");
    });

    return () => {
      active = false;
      stop?.();
    };
  }, [applySharedView, hydrated]);

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

  const handleAlertSelect = useCallback((bounds: OverlayBounds) => {
    mapRef.current?.flyTo({
      center: [
        (bounds.west + bounds.east) / 2,
        (bounds.south + bounds.north) / 2,
      ],
      zoom: 7.5,
      bearing: 0,
      pitch: 0,
    });
  }, []);

  const handleFollowStorm = useCallback((point: GeoPoint) => {
    mapRef.current?.flyTo({
      center: [point.lon, point.lat],
      zoom: 5.5,
      bearing: 0,
      pitch: 0,
    });
  }, []);

  const handlePrimaryMove = useCallback(
    (camera: CameraState) => secondMapRef.current?.syncCamera(camera),
    [],
  );

  const handleSecondaryMove = useCallback(
    (camera: CameraState) => mapRef.current?.syncCamera(camera),
    [],
  );

  const handleMapStyle = useCallback(
    (mapStyle: MapStyleId) =>
      applySettings({ ...settingsRef.current, mapStyle }),
    [applySettings, settingsRef],
  );

  const handleProjection = useCallback(
    (projection: ProjectionMode) => {
      applySettings({ ...settingsRef.current, projection });
      pushToast({
        title:
          projection === "globe" ? "Globe projection on" : "Flat projection on",
        detail: "Your center, zoom, bearing, and pitch are unchanged.",
      });
    },
    [applySettings, pushToast, settingsRef],
  );

  const handleRadar = useCallback(
    (radar: RadarSettings) => applySettings({ ...settingsRef.current, radar }),
    [applySettings, settingsRef],
  );

  const handleSurface = useCallback((surface: SurfaceId) => {
    setProductOpen(false);
    setActiveSurface(surface);
  }, []);

  const handleTool = useCallback((tool: ToolMode) => {
    setActiveSurface(null);
    setProductOpen(false);
    setActiveTool(tool);
    if (!tool) {
      mapRef.current?.clearTools();
      secondMapRef.current?.clearTools();
    }
  }, []);

  const handleLocate = useCallback(() => {
    if (!navigator.geolocation) {
      pushToast({
        title: "Location is not available",
        detail: "Search can still move the map.",
      });
      return;
    }
    pushToast({ title: "Finding your location" });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const camera: CameraState = {
          center: [position.coords.longitude, position.coords.latitude],
          zoom: 8,
          bearing: 0,
          pitch: settingsRef.current.projection === "globe" ? 20 : 0,
        };
        mapRef.current?.flyTo(camera);
        pushToast({ title: "Map centered on your location" });
      },
      () =>
        pushToast({
          title: "Location permission was not available",
          detail: "Nothing changed.",
        }),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }, [pushToast, settingsRef]);

  const handlePlace = useCallback(
    (place: PlaceResult) => {
      const camera: CameraState = {
        center: [place.lon, place.lat],
        zoom: 8,
        bearing: 0,
        pitch: settingsRef.current.projection === "globe" ? 20 : 0,
      };
      mapRef.current?.flyTo(camera);
      setActiveSurface(null);
      pushToast({
        title: `Centered on ${place.name}`,
        detail: place.region || place.country,
      });
    },
    [pushToast, settingsRef],
  );

  const handlePreset = useCallback(
    (index: number) => {
      const current = settingsRef.current;
      const preset = current.presets[index];
      if (preset) {
        const next = normalizeSettings({
          ...current,
          camera: preset.camera,
          projection: preset.projection,
          mapStyle: preset.mapStyle,
        });
        applySettings(next);
        window.setTimeout(() => mapRef.current?.flyTo(preset.camera), 80);
        pushToast({ title: `${preset.name} opened` });
        return;
      }

      const camera = mapRef.current?.camera() ?? current.camera;
      const presets = [...current.presets];
      presets[index] = {
        name: `Preset ${index + 1}`,
        camera,
        projection: current.projection,
        mapStyle: current.mapStyle,
      };
      const next = normalizeSettings({ ...current, presets });
      applySettings(next);
      pushToast({
        title: `Preset ${index + 1} saved`,
        actionLabel: "Undo",
        onAction: () => {
          const undoPresets = [...settingsRef.current.presets];
          undoPresets[index] = null;
          applySettings({ ...settingsRef.current, presets: undoPresets });
        },
      });
    },
    [applySettings, pushToast, settingsRef],
  );

  const handleShare = useCallback(async () => {
    const view = {
      camera: mapRef.current?.camera() ?? settingsRef.current.camera,
      projection: settingsRef.current.projection,
    };
    // Inside the app the address bar reads http://tauri.localhost, which opens
    // nothing, so the desktop build hands out its own scheme instead.
    const link = isDesktopRuntime()
      ? deepLinkUrl(view)
      : webLinkUrl(view, window.location.href);

    try {
      if (navigator.share) {
        await navigator.share({ title: "OpenRadar view", url: link });
        pushToast({ title: "Map view shared" });
      } else {
        await navigator.clipboard.writeText(link);
        pushToast({ title: "Map link copied", detail: link });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      pushToast({ title: "The map link could not be copied" });
    }
  }, [pushToast, settingsRef]);

  const captionFor = useCallback(
    (index: number): ExportCaption => {
      const frame = frames[index];
      return {
        lines: [
          frame?.forecast
            ? `${formatFrameTime(frame)} forecast`
            : formatFrameTime(frame),
          frame?.forecast
            ? `HRRR, ${frame.forecast.leadMinutes} min out`
            : (source?.label ?? "Radar"),
        ].filter(Boolean),
        attribution: "OpenRadar · OpenStreetMap · NOAA",
      };
    },
    [frames, source],
  );

  const finishExport = useCallback(
    async (name: string, blob: Blob) => {
      const saved = await saveFile(name, blob);
      pushToast({
        title: `${name} saved`,
        detail: saved.path ?? "Check your downloads folder.",
        actionLabel: saved.path ? "Show" : undefined,
        onAction: saved.path
          ? () => void revealItemInDir(saved.path as string).catch(() => {})
          : undefined,
      });
    },
    [pushToast],
  );

  const handleExportImage = useCallback(() => {
    void (async () => {
      const canvas = mapRef.current?.canvas();
      if (!canvas) return;
      setExporting("image");
      try {
        const blob = await exportStill(canvas, captionFor(frameIndex));
        await finishExport(exportFileName("openradar", "png"), blob);
      } catch (failure) {
        log.warn(
          "export",
          failure instanceof Error ? failure.message : "The export failed",
        );
        pushToast({ title: "The image could not be exported" });
      } finally {
        setExporting(null);
      }
    })();
  }, [captionFor, finishExport, frameIndex, pushToast]);

  const handleExportLoop = useCallback(() => {
    void (async () => {
      const canvas = mapRef.current?.canvas();
      if (!canvas || frames.length < 2) return;
      setExporting("loop");
      timeline.setPlaying(false);
      try {
        const blob = await exportLoop({
          source: canvas,
          frameCount: frames.length,
          showFrame: async (index) => {
            timeline.selectFrame(index);
            await mapRef.current?.onceIdle();
          },
          captionFor,
          onProgress: (done, total) => setExportProgress({ done, total }),
        });
        await finishExport(exportFileName("openradar-loop", "webm"), blob);
      } catch (failure) {
        log.warn(
          "export",
          failure instanceof Error ? failure.message : "The export failed",
        );
        pushToast({
          title: "The loop could not be exported",
          detail:
            failure instanceof Error ? failure.message : "Nothing was written.",
        });
      } finally {
        setExporting(null);
        setExportProgress(null);
      }
    })();
  }, [captionFor, finishExport, frames.length, pushToast, timeline]);

  const handleUpload = useCallback(
    async (file: File) => {
      try {
        if (file.size > 5 * 1024 * 1024)
          throw new Error("The file is larger than 5 MB.");
        const text = await file.text();
        let payload: Record<string, unknown>;
        let detail = "The overlay stays on this device.";

        if (looksLikePlacefile(text)) {
          const placefile = parsePlacefile(text);
          if (!placefile.data.features.length) {
            throw new Error("That placefile has nothing this map can draw.");
          }
          payload = placefile.data as unknown as Record<string, unknown>;
          detail = placefile.skipped.length
            ? `${placefile.data.features.length} shapes. ${placefile.skipped.join(" and ")} need image files and were left out.`
            : `${placefile.data.features.length} shapes from the placefile.`;
        } else {
          payload = JSON.parse(text) as Record<string, unknown>;
          if (
            !payload ||
            (payload.type !== "FeatureCollection" && payload.type !== "Feature")
          ) {
            throw new Error("Choose a GeoJSON file or a GRLevelX placefile.");
          }
          if (payload.type === "FeatureCollection") {
            const features = payload.features;
            if (!Array.isArray(features) || features.length > 5000) {
              throw new Error(
                "A custom overlay can contain up to 5,000 features.",
              );
            }
          }
        }

        setCustomOverlay(payload);
        applySettings({
          ...settingsRef.current,
          layers: { ...settingsRef.current.layers, customOverlay: true },
        });
        setActiveSurface(null);
        pushToast({
          title: `${file.name} added`,
          detail,
          actionLabel: "Remove",
          onAction: () => setCustomOverlay(null),
        });
      } catch (error) {
        pushToast({
          title: "Overlay could not be added",
          detail:
            error instanceof Error
              ? error.message
              : "The file could not be read.",
        });
      }
    },
    [applySettings, pushToast, settingsRef],
  );

  const resetSettings = useCallback(() => {
    const previous = settingsRef.current;
    const reset = normalizeSettings(DEFAULT_SETTINGS);
    applySettings(reset);
    mapRef.current?.flyTo(reset.camera);
    pushToast({
      title: "Settings reset",
      actionLabel: "Undo",
      onAction: () => {
        applySettings(previous);
        mapRef.current?.flyTo(previous.camera);
      },
    });
  }, [applySettings, pushToast, settingsRef]);

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
      <div className="map-stage">
        <MapViewport
          ref={mapRef}
          camera={settings.camera}
          projection={settings.projection}
          mapStyle={settings.mapStyle}
          radarFrame={activeFrame}
          radarVisible={settings.radar.enabled}
          radarOpacity={settings.radar.opacity}
          satelliteTime={satelliteTime}
          overlays={overlayData}
          route={route}
          customOverlay={settings.layers.customOverlay ? customOverlay : null}
          toolMode={activeTool}
          onCameraChange={handleCameraChange}
          onCameraMove={handlePrimaryMove}
          onCursorChange={setCursor}
          onToolResult={setToolResult}
          onMapStatus={handleMapStatus}
        />
        {dualPane ? (
          <MapViewport
            ref={secondMapRef}
            label="Secondary interactive weather map"
            camera={settings.camera}
            projection={settings.projection}
            mapStyle={settings.mapStyle}
            radarFrame={compareFrame}
            radarVisible={settings.radar.enabled}
            radarOpacity={settings.radar.opacity}
            satelliteTime={compareSatelliteTime}
            overlays={overlayData}
            route={route}
            customOverlay={settings.layers.customOverlay ? customOverlay : null}
            toolMode={activeTool}
            onCameraChange={handleCameraChange}
            onCameraMove={handleSecondaryMove}
            onToolResult={setToolResult}
          />
        ) : null}
        {satelliteTime !== null ? (
          <div className="satellite-chip">
            <strong>GOES-East GeoColor</strong>
            <small>
              {new Intl.DateTimeFormat(undefined, {
                hour: "numeric",
                minute: "2-digit",
              }).format(new Date(satelliteTime * 1000))}
              {" · "}
              {frameAgeMinutes({ ...activeFrame!, time: satelliteTime })} min
              old
            </small>
          </div>
        ) : null}
        {dualPane ? (
          <div className="pane-compare">
            <strong>Compare</strong>
            <div
              className="segmented-control"
              role="group"
              aria-label="Secondary pane frame offset"
            >
              {COMPARE_OFFSETS.map((offset) => (
                <button
                  type="button"
                  key={offset}
                  className={compareOffset === offset ? "is-active" : ""}
                  aria-pressed={compareOffset === offset}
                  onClick={() => setCompareOffset(offset)}
                >
                  {offset === 0 ? "Live" : `${offset} back`}
                </button>
              ))}
            </div>
            <small>{formatFrameTime(compareFrame)}</small>
          </div>
        ) : null}
      </div>

      {activeSurface === "search" ? (
        <SearchPanel
          onClose={() => setActiveSurface(null)}
          onSelect={handlePlace}
        />
      ) : null}
      {activeSurface === "map-type" ? (
        <MapTypePanel
          mapStyle={settings.mapStyle}
          projection={settings.projection}
          onMapStyle={handleMapStyle}
          onProjection={handleProjection}
          onClose={() => setActiveSurface(null)}
        />
      ) : null}
      {activeSurface === "layers" ? (
        <LayersPanel
          layers={settings.layers}
          onLayers={(layers) =>
            applySettings({ ...settingsRef.current, layers })
          }
          onClose={() => setActiveSurface(null)}
        />
      ) : null}
      {activeSurface === "alerts" ? (
        <AlertsPanel
          alerts={overlays.alerts.data}
          viewport={viewport}
          fetchedAt={overlays.alerts.fetchedAt}
          error={overlays.alerts.error}
          layerOn={settings.layers.weatherAlerts}
          onEnableLayer={() =>
            applySettings({
              ...settingsRef.current,
              layers: { ...settingsRef.current.layers, weatherAlerts: true },
            })
          }
          onSelect={handleAlertSelect}
          onClose={() => setActiveSurface(null)}
        />
      ) : null}
      {activeSurface === "tropical" ? (
        <TropicalPanel
          products={overlays.tropical.data}
          fetchedAt={overlays.tropical.fetchedAt}
          error={overlays.tropical.error}
          layerOn={settings.layers.tropical}
          onEnableLayer={() =>
            applySettings({
              ...settingsRef.current,
              layers: { ...settingsRef.current.layers, tropical: true },
            })
          }
          onFollow={handleFollowStorm}
          onClose={() => setActiveSurface(null)}
        />
      ) : null}
      {activeSurface === "route" ? (
        <RoutePanel onRoute={setRoute} onClose={() => setActiveSurface(null)} />
      ) : null}
      {activeSurface === "forecast" ? (
        <ForecastPanel
          point={centerPoint}
          onClose={() => setActiveSurface(null)}
        />
      ) : null}
      {activeSurface === "settings" ? (
        <SettingsPanel
          settings={settings}
          onSettings={applySettings}
          onReset={resetSettings}
          onClose={() => setActiveSurface(null)}
        />
      ) : null}
      {activeSurface === "export" ? (
        <ExportPanel
          frameCount={frames.length}
          busy={exporting}
          progress={exportProgress}
          onExportImage={handleExportImage}
          onExportLoop={handleExportLoop}
          onClose={() => setActiveSurface(null)}
        />
      ) : null}
      {activeSurface === "upload" ? (
        <UploadPanel
          onClose={() => setActiveSurface(null)}
          onFile={handleUpload}
        />
      ) : null}
      {activeSurface === "more" ? (
        <MorePanel
          mapReady={mapStatus === "ready"}
          radarReady={frames.length > 0}
          activeSource={source?.label ?? null}
          health={health}
          log={logEntries}
          onOpenLogFolder={handleOpenLogFolder}
          onClose={() => setActiveSurface(null)}
        />
      ) : null}
      {productOpen ? (
        <RadarProductPanel
          radar={settings.radar}
          onRadar={handleRadar}
          onClose={() => setProductOpen(false)}
        />
      ) : null}

      {cursor ? (
        <div className="map-readout" aria-live="off">
          {`${cursor.lat.toFixed(3)}°, ${cursor.lon.toFixed(3)}°`}
        </div>
      ) : null}

      {activeTool ? (
        <div className="tool-hud">
          <span>
            <strong>
              {activeTool === "draw"
                ? "Draw"
                : activeTool === "range"
                  ? "Range"
                  : "Inspector"}
            </strong>
            {toolResult}
          </span>
          <button type="button" onClick={() => mapRef.current?.clearTools()}>
            <Trash2 size={15} /> Clear
          </button>
        </div>
      ) : null}

      <RadarLegend
        open={productOpen}
        radarEnabled={settings.radar.enabled}
        onToggle={() => {
          setActiveSurface(null);
          setProductOpen((open) => !open);
        }}
      />
      <RadarTimeline
        frames={frames}
        frameIndex={frameIndex}
        playing={playing}
        sourceLabel={source?.label ?? null}
        ageMinutes={radarAge}
        error={
          timeline.error ??
          (radarAge !== null && radarAge >= 20
            ? `Radar is stale · ${radarAge} min old`
            : null)
        }
        onFrameIndex={timeline.selectFrame}
        onPlaying={timeline.setPlaying}
      />
      <ZoomControls
        bearing={settings.camera.bearing}
        onZoomIn={() => mapRef.current?.zoomIn()}
        onZoomOut={() => mapRef.current?.zoomOut()}
        onResetNorth={() => mapRef.current?.resetNorth()}
      />
      <CommandBar
        activeSurface={activeSurface}
        activeTool={activeTool}
        dualPane={dualPane}
        projection={settings.projection}
        presets={settings.presets.map(Boolean)}
        onSurface={handleSurface}
        onTool={handleTool}
        onLocate={handleLocate}
        onDualPane={() => {
          setDualPane((enabled) => !enabled);
          pushToast({
            title: dualPane ? "Dual pane closed" : "Dual pane opened",
          });
        }}
        onProjection={() =>
          handleProjection(
            settings.projection === "globe" ? "mercator" : "globe",
          )
        }
        onPreset={handlePreset}
        onShare={handleShare}
      />
      <ToastHost messages={toasts} onDismiss={dismissToast} />
      <div className="source-attribution">
        <a href="https://openfreemap.org/" target="_blank" rel="noreferrer">
          OpenFreeMap
        </a>
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
        >
          © OpenStreetMap
        </a>
        {source ? (
          <a href={source.attributionUrl} target="_blank" rel="noreferrer">
            {source.label}
          </a>
        ) : null}
      </div>
      <div className="map-watermark" aria-hidden="true">
        <CloudRain size={18} />
      </div>
    </main>
  );
}
