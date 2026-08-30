import { CloudRain, LoaderCircle, Radar, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  animationIntervalMs,
  fetchRadarFrames,
  formatFrameTime,
  frameAgeMinutes,
  type RadarFrame,
} from "./lib/radar";
import {
  DEFAULT_SETTINGS,
  cameraFromSearch,
  loadSettings,
  normalizeSettings,
  saveSettings,
  type AppSettings,
  type CameraState,
  type MapStyleId,
  type ProjectionMode,
  type RadarSettings,
} from "./lib/settings";
import { ForecastPanel } from "./panels/ForecastPanel";
import {
  LayersPanel,
  MapTypePanel,
  SettingsPanel,
} from "./panels/MapOptionsPanels";
import { RadarProductPanel } from "./panels/RadarProductPanel";
import { SearchPanel } from "./panels/SearchPanel";
import { MorePanel, UploadPanel, VideosPanel } from "./panels/UtilityPanels";
import type { PlaceResult } from "./lib/weather";

const CAMERA_SAVE_DELAY_MS = 450;
const RADAR_REFRESH_MS = 5 * 60_000;
const COMPARE_OFFSETS = [0, 3, 6, 12];

function cameraFromUrl(fallback: CameraState): CameraState {
  return cameraFromSearch(window.location.search, fallback);
}

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(() =>
    normalizeSettings(DEFAULT_SETTINGS),
  );
  const settingsRef = useRef(settings);
  const [hydrated, setHydrated] = useState(false);
  const [activeSurface, setActiveSurface] = useState<SurfaceId>(null);
  const [productOpen, setProductOpen] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolMode>(null);
  const [dualPane, setDualPane] = useState(false);
  const [compareOffset, setCompareOffset] = useState(0);
  const [frames, setFrames] = useState<RadarFrame[]>([]);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  const [radarError, setRadarError] = useState<string | null>(null);
  const [mapStatus, setMapStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [cursor, setCursor] = useState<GeoPoint | null>(null);
  const [toolResult, setToolResult] = useState<string | null>(null);
  const [customOverlay, setCustomOverlay] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const mapRef = useRef<MapViewportHandle>(null);
  const secondMapRef = useRef<MapViewportHandle>(null);
  const toastIdRef = useRef(0);
  const cameraSaveTimerRef = useRef<number | null>(null);

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

  const persist = useCallback(
    (next: AppSettings) => {
      void saveSettings(next).catch(() => {
        pushToast({
          title: "Settings were not saved",
          detail: "The current window is still using your changes.",
        });
      });
    },
    [pushToast],
  );

  const applySettings = useCallback(
    (next: AppSettings) => {
      const normalized = normalizeSettings(next);
      settingsRef.current = normalized;
      setSettings(normalized);
      persist(normalized);
    },
    [persist],
  );

  useEffect(() => {
    let active = true;
    void loadSettings().then((stored) => {
      if (!active) return;
      const params = new URLSearchParams(window.location.search);
      const projection: ProjectionMode =
        params.get("projection") === "globe" ? "globe" : stored.projection;
      const next = normalizeSettings({
        ...stored,
        projection,
        camera: cameraFromUrl(stored.camera),
      });
      settingsRef.current = next;
      setSettings(next);
      setHydrated(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    const meta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    );
    meta?.setAttribute(
      "content",
      settings.theme === "dark" ? "#090b10" : "#eef2f6",
    );
  }, [settings.theme]);

  useEffect(() => {
    const onVisibility = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const controller = new AbortController();
    let mounted = true;

    const refresh = async () => {
      try {
        const next = await fetchRadarFrames(controller.signal);
        if (!mounted) return;
        const newest = next.at(-1)?.time ?? 0;
        const cutoff = newest - settingsRef.current.radar.loopMinutes * 60;
        const retained = next.filter((frame) => frame.time >= cutoff);
        setFrames(retained);
        setFrameIndex(Math.max(0, retained.length - 1));
        setRadarError(null);
      } catch (error) {
        if (
          !mounted ||
          (error instanceof DOMException && error.name === "AbortError")
        )
          return;
        setRadarError("Radar temporarily unavailable");
      }
    };

    void refresh();
    const timer = window.setInterval(() => void refresh(), RADAR_REFRESH_MS);
    return () => {
      mounted = false;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [hydrated]);

  useEffect(() => {
    if (!playing || !pageVisible || frames.length < 2) return;
    const timer = window.setInterval(() => {
      setFrameIndex((current) => (current + 1) % frames.length);
    }, animationIntervalMs(settings.radar.animationSpeed));
    return () => window.clearInterval(timer);
  }, [frames.length, pageVisible, playing, settings.radar.animationSpeed]);

  useEffect(
    () => () => {
      if (cameraSaveTimerRef.current !== null)
        window.clearTimeout(cameraSaveTimerRef.current);
    },
    [],
  );

  const handleCameraChange = useCallback(
    (camera: CameraState) => {
      const next = normalizeSettings({ ...settingsRef.current, camera });
      settingsRef.current = next;
      setSettings(next);
      if (cameraSaveTimerRef.current !== null)
        window.clearTimeout(cameraSaveTimerRef.current);
      cameraSaveTimerRef.current = window.setTimeout(
        () => persist(next),
        CAMERA_SAVE_DELAY_MS,
      );
    },
    [persist],
  );

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
    [applySettings],
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
    [applySettings, pushToast],
  );

  const handleRadar = useCallback(
    (radar: RadarSettings) => applySettings({ ...settingsRef.current, radar }),
    [applySettings],
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
  }, [pushToast]);

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
    [pushToast],
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
    [applySettings, pushToast],
  );

  const handleShare = useCallback(async () => {
    const camera = mapRef.current?.camera() ?? settingsRef.current.camera;
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("lon", camera.center[0].toFixed(5));
    url.searchParams.set("lat", camera.center[1].toFixed(5));
    url.searchParams.set("zoom", camera.zoom.toFixed(2));
    url.searchParams.set("bearing", camera.bearing.toFixed(1));
    url.searchParams.set("pitch", camera.pitch.toFixed(1));
    url.searchParams.set("projection", settingsRef.current.projection);

    try {
      if (navigator.share) {
        await navigator.share({ title: "OpenRadar view", url: url.toString() });
        pushToast({ title: "Map view shared" });
      } else {
        await navigator.clipboard.writeText(url.toString());
        pushToast({ title: "Map link copied" });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      pushToast({ title: "The map link could not be copied" });
    }
  }, [pushToast]);

  const handleUpload = useCallback(
    async (file: File) => {
      try {
        if (file.size > 5 * 1024 * 1024)
          throw new Error("The file is larger than 5 MB.");
        const payload = JSON.parse(await file.text()) as Record<
          string,
          unknown
        >;
        if (
          !payload ||
          (payload.type !== "FeatureCollection" && payload.type !== "Feature")
        ) {
          throw new Error("Choose a GeoJSON Feature or FeatureCollection.");
        }
        if (payload.type === "FeatureCollection") {
          const features = payload.features;
          if (!Array.isArray(features) || features.length > 5000) {
            throw new Error(
              "A custom overlay can contain up to 5,000 features.",
            );
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
          detail: "The overlay stays on this device.",
          actionLabel: "Remove",
          onAction: () => setCustomOverlay(null),
        });
      } catch (error) {
        pushToast({
          title: "Overlay could not be added",
          detail:
            error instanceof Error
              ? error.message
              : "The file was not valid GeoJSON.",
        });
      }
    },
    [applySettings, pushToast],
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
  }, [applySettings, pushToast]);

  const centerPoint = useMemo<GeoPoint>(
    () => ({ lon: settings.camera.center[0], lat: settings.camera.center[1] }),
    [settings.camera.center],
  );
  const activeFrame = frames[frameIndex];
  const compareFrame = frames[Math.max(0, frameIndex - compareOffset)];
  const radarAge = activeFrame ? frameAgeMinutes(activeFrame) : null;

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
          customOverlay={settings.layers.customOverlay ? customOverlay : null}
          toolMode={activeTool}
          onCameraChange={handleCameraChange}
          onCameraMove={handlePrimaryMove}
          onCursorChange={setCursor}
          onToolResult={setToolResult}
          onMapStatus={setMapStatus}
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
            customOverlay={settings.layers.customOverlay ? customOverlay : null}
            toolMode={activeTool}
            onCameraChange={handleCameraChange}
            onCameraMove={handleSecondaryMove}
            onToolResult={setToolResult}
          />
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
      {activeSurface === "videos" ? (
        <VideosPanel onClose={() => setActiveSurface(null)} />
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
        error={
          radarError ??
          (radarAge !== null && radarAge >= 20
            ? `Radar is stale · ${radarAge} min old`
            : null)
        }
        onFrameIndex={(index) => {
          setPlaying(false);
          setFrameIndex(index);
        }}
        onPlaying={setPlaying}
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
        <a href="https://www.rainviewer.com/" target="_blank" rel="noreferrer">
          RainViewer
        </a>
      </div>
      <div className="map-watermark" aria-hidden="true">
        <CloudRain size={18} />
      </div>
    </main>
  );
}
