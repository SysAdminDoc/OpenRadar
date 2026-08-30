import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type ForwardedRef,
} from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "../lib/maplibreWorker";
import { formatDistance, haversineMiles, type GeoPoint } from "../lib/geo";
import { mapStyleDefinition } from "../lib/mapStyles";
import { guardRadarRequest } from "../lib/providers";
import type { RadarFrame } from "../lib/radar";
import {
  sameCamera,
  type CameraState,
  type MapStyleId,
  type ProjectionMode,
} from "../lib/settings";
import type { ToolMode } from "./CommandBar";

const RADAR_SOURCE_ID = "openradar-radar-source";
const RADAR_LAYER_ID = "openradar-radar-layer";
const TOOL_SOURCE_ID = "openradar-tool-source";
const TOOL_LINE_LAYER_ID = "openradar-tool-line";
const TOOL_POINT_LAYER_ID = "openradar-tool-points";
const CUSTOM_SOURCE_ID = "openradar-custom-source";
const CUSTOM_FILL_LAYER_ID = "openradar-custom-fill";
const CUSTOM_LINE_LAYER_ID = "openradar-custom-line";
const CUSTOM_POINT_LAYER_ID = "openradar-custom-points";

export interface MapViewportHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  resetNorth: () => void;
  flyTo: (camera: CameraState) => void;
  syncCamera: (camera: CameraState) => void;
  clearTools: () => void;
  camera: () => CameraState | null;
}

interface MapViewportProps {
  label?: string;
  camera: CameraState;
  projection: ProjectionMode;
  mapStyle: MapStyleId;
  radarFrame?: RadarFrame;
  radarVisible: boolean;
  radarOpacity: number;
  customOverlay?: Record<string, unknown> | null;
  toolMode?: ToolMode;
  onCameraChange?: (camera: CameraState) => void;
  onCameraMove?: (camera: CameraState) => void;
  onCursorChange?: (point: GeoPoint | null) => void;
  onToolResult?: (message: string | null) => void;
  onMapStatus?: (status: "loading" | "ready" | "error") => void;
}

function asCamera(map: maplibregl.Map): CameraState {
  const center = map.getCenter();
  return {
    center: [center.lng, center.lat],
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
  };
}

function emptyTools() {
  return { type: "FeatureCollection", features: [] } as {
    type: "FeatureCollection";
    features: [];
  };
}

function MapViewportInner(
  {
    label = "Interactive weather map",
    camera,
    projection,
    mapStyle,
    radarFrame,
    radarVisible,
    radarOpacity,
    customOverlay = null,
    toolMode = null,
    onCameraChange,
    onCameraMove,
    onCursorChange,
    onToolResult,
    onMapStatus,
  }: MapViewportProps,
  ref: ForwardedRef<MapViewportHandle>,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const radarFrameRef = useRef<RadarFrame | undefined>(radarFrame);
  const radarVisibleRef = useRef(radarVisible);
  const radarOpacityRef = useRef(radarOpacity);
  const customOverlayRef = useRef<Record<string, unknown> | null>(
    customOverlay,
  );
  const projectionRef = useRef(projection);
  const mapStyleRef = useRef(mapStyle);
  const toolModeRef = useRef<ToolMode>(toolMode);
  const drawPointsRef = useRef<GeoPoint[]>([]);
  const rangeStartRef = useRef<GeoPoint | null>(null);
  const rangeEndRef = useRef<GeoPoint | null>(null);
  const warnedMapErrorRef = useRef(false);
  const suppressCameraEventsRef = useRef(0);
  const radarSourceKeyRef = useRef<string | null>(null);

  const publishCamera = (next: CameraState) => {
    const container = containerRef.current;
    if (!container) return;
    container.dataset.camera = [
      next.center[0].toFixed(5),
      next.center[1].toFixed(5),
      next.zoom.toFixed(3),
      next.bearing.toFixed(2),
      next.pitch.toFixed(2),
    ].join(",");
  };

  const renderTools = () => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const features: Array<Record<string, unknown>> = [];
    const drawPoints = drawPointsRef.current;
    if (drawPoints.length) {
      features.push({
        type: "Feature",
        properties: { kind: "draw" },
        geometry: {
          type: drawPoints.length > 1 ? "LineString" : "Point",
          coordinates:
            drawPoints.length > 1
              ? drawPoints.map((point) => [point.lon, point.lat])
              : [drawPoints[0].lon, drawPoints[0].lat],
        },
      });
    }

    if (rangeStartRef.current) {
      features.push({
        type: "Feature",
        properties: { kind: "range-start" },
        geometry: {
          type: "Point",
          coordinates: [rangeStartRef.current.lon, rangeStartRef.current.lat],
        },
      });
    }

    if (rangeStartRef.current && rangeEndRef.current) {
      features.push({
        type: "Feature",
        properties: { kind: "range" },
        geometry: {
          type: "LineString",
          coordinates: [
            [rangeStartRef.current.lon, rangeStartRef.current.lat],
            [rangeEndRef.current.lon, rangeEndRef.current.lat],
          ],
        },
      });
    }

    let source = map.getSource(TOOL_SOURCE_ID) as
      maplibregl.GeoJSONSource | undefined;
    if (!source) {
      map.addSource(TOOL_SOURCE_ID, { type: "geojson", data: emptyTools() });
      map.addLayer({
        id: TOOL_LINE_LAYER_ID,
        type: "line",
        source: TOOL_SOURCE_ID,
        filter: ["==", ["geometry-type"], "LineString"],
        paint: {
          "line-color": "#7dd3fc",
          "line-width": 3,
          "line-dasharray": [2, 1.4],
        },
      });
      map.addLayer({
        id: TOOL_POINT_LAYER_ID,
        type: "circle",
        source: TOOL_SOURCE_ID,
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 6,
          "circle-color": "#101722",
          "circle-stroke-color": "#7dd3fc",
          "circle-stroke-width": 2,
        },
      });
      source = map.getSource(TOOL_SOURCE_ID) as maplibregl.GeoJSONSource;
    }
    source.setData({ type: "FeatureCollection", features } as never);
  };

  const syncRadar = () => {
    const map = mapRef.current;
    const frame = radarFrameRef.current;
    if (!map || !map.isStyleLoaded() || !frame) return;

    // A different provider changes tile size, native zoom, and credit, none of
    // which a raster source can be reconfigured with in place.
    const key = `${frame.providerId}:${frame.tileSize}:${frame.maxZoom}`;
    if (map.getSource(RADAR_SOURCE_ID) && radarSourceKeyRef.current !== key) {
      if (map.getLayer(RADAR_LAYER_ID)) map.removeLayer(RADAR_LAYER_ID);
      map.removeSource(RADAR_SOURCE_ID);
    }
    radarSourceKeyRef.current = key;

    const source = map.getSource(RADAR_SOURCE_ID) as
      maplibregl.RasterTileSource | undefined;
    if (source) {
      source.setTiles?.([frame.tileUrl]);
    } else {
      map.addSource(RADAR_SOURCE_ID, {
        type: "raster",
        tiles: [frame.tileUrl],
        tileSize: frame.tileSize,
        maxzoom: frame.maxZoom,
        attribution: frame.attribution,
      });
      map.addLayer({
        id: RADAR_LAYER_ID,
        type: "raster",
        source: RADAR_SOURCE_ID,
        paint: { "raster-opacity": 0 },
      });
    }
    if (map.getLayer(RADAR_LAYER_ID)) {
      map.setPaintProperty(
        RADAR_LAYER_ID,
        "raster-opacity",
        radarVisibleRef.current ? radarOpacityRef.current : 0,
      );
      map.setPaintProperty(RADAR_LAYER_ID, "raster-fade-duration", 150);
    }
  };

  const syncCustomOverlay = () => {
    const map = mapRef.current;
    const overlay = customOverlayRef.current;
    if (!map || !map.isStyleLoaded() || !overlay) return;
    let source = map.getSource(CUSTOM_SOURCE_ID) as
      maplibregl.GeoJSONSource | undefined;
    if (!source) {
      map.addSource(CUSTOM_SOURCE_ID, {
        type: "geojson",
        data: overlay as never,
      });
      map.addLayer({
        id: CUSTOM_FILL_LAYER_ID,
        type: "fill",
        source: CUSTOM_SOURCE_ID,
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": "#60a5fa", "fill-opacity": 0.18 },
      });
      map.addLayer({
        id: CUSTOM_LINE_LAYER_ID,
        type: "line",
        source: CUSTOM_SOURCE_ID,
        filter: [
          "in",
          ["geometry-type"],
          ["literal", ["LineString", "Polygon"]],
        ],
        paint: { "line-color": "#93c5fd", "line-width": 2 },
      });
      map.addLayer({
        id: CUSTOM_POINT_LAYER_ID,
        type: "circle",
        source: CUSTOM_SOURCE_ID,
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 6,
          "circle-color": "#60a5fa",
          "circle-stroke-color": "#eff6ff",
          "circle-stroke-width": 1.5,
        },
      });
      source = map.getSource(CUSTOM_SOURCE_ID) as maplibregl.GeoJSONSource;
    }
    source.setData(overlay as never);
  };

  useImperativeHandle(ref, () => ({
    zoomIn: () =>
      mapRef.current?.easeTo({
        zoom: Math.min(15, (mapRef.current?.getZoom() ?? 4) + 1),
      }),
    zoomOut: () =>
      mapRef.current?.easeTo({
        zoom: Math.max(2.5, (mapRef.current?.getZoom() ?? 4) - 1),
      }),
    resetNorth: () =>
      mapRef.current?.easeTo({ bearing: 0, pitch: 0, duration: 450 }),
    syncCamera: (nextCamera) => {
      const map = mapRef.current;
      if (!map || sameCamera(asCamera(map), nextCamera)) return;
      suppressCameraEventsRef.current += 1;
      try {
        map.jumpTo({
          center: nextCamera.center,
          zoom: nextCamera.zoom,
          bearing: nextCamera.bearing,
          pitch: nextCamera.pitch,
        });
      } finally {
        suppressCameraEventsRef.current -= 1;
      }
    },
    flyTo: (nextCamera) =>
      mapRef.current?.flyTo({
        center: nextCamera.center,
        zoom: nextCamera.zoom,
        bearing: nextCamera.bearing,
        pitch: nextCamera.pitch,
        duration: 850,
        essential: true,
      }),
    clearTools: () => {
      drawPointsRef.current = [];
      rangeStartRef.current = null;
      rangeEndRef.current = null;
      renderTools();
      onToolResult?.(null);
    },
    camera: () => (mapRef.current ? asCamera(mapRef.current) : null),
  }));

  useEffect(() => {
    if (!containerRef.current) return;
    onMapStatus?.("loading");
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapStyleDefinition(mapStyle),
      center: camera.center,
      zoom: camera.zoom,
      bearing: camera.bearing,
      pitch: camera.pitch,
      minZoom: 2.5,
      maxZoom: 15,
      attributionControl: false,
      canvasContextAttributes: { preserveDrawingBuffer: true },
      transformRequest: (url) => ({ url: guardRadarRequest(url) }),
    });
    mapRef.current = map;
    map.setMissingStyleImageResolver((id) => {
      if (map.hasImage(id)) return;
      map.addImage(id, {
        width: 1,
        height: 1,
        data: new Uint8Array([0, 0, 0, 0]),
      });
    });

    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right",
    );

    publishCamera(asCamera(map));

    const onStyleLoad = () => {
      map.setProjection({ type: projectionRef.current });
      syncRadar();
      renderTools();
      syncCustomOverlay();
      onMapStatus?.("ready");
    };
    map.on("style.load", onStyleLoad);
    map.on("move", () => {
      const next = asCamera(map);
      publishCamera(next);
      if (suppressCameraEventsRef.current) return;
      onCameraMove?.(next);
    });
    map.on("moveend", () => {
      if (suppressCameraEventsRef.current) return;
      onCameraChange?.(asCamera(map));
    });
    map.on("mousemove", (event) =>
      onCursorChange?.({ lon: event.lngLat.lng, lat: event.lngLat.lat }),
    );
    map.on("mouseout", () => onCursorChange?.(null));
    map.on("click", (event) => {
      const point = { lon: event.lngLat.lng, lat: event.lngLat.lat };
      if (toolModeRef.current === "inspect") {
        onToolResult?.(
          `${point.lat.toFixed(4)}°, ${point.lon.toFixed(4)}° · zoom ${map.getZoom().toFixed(2)}`,
        );
      } else if (toolModeRef.current === "draw") {
        drawPointsRef.current = [...drawPointsRef.current, point];
        renderTools();
        onToolResult?.(
          `${drawPointsRef.current.length} ${drawPointsRef.current.length === 1 ? "point" : "points"} in path`,
        );
      } else if (toolModeRef.current === "range") {
        if (!rangeStartRef.current || rangeEndRef.current) {
          rangeStartRef.current = point;
          rangeEndRef.current = null;
          onToolResult?.("Select the end point");
        } else {
          rangeEndRef.current = point;
          const miles = haversineMiles(rangeStartRef.current, point);
          onToolResult?.(`Range ${formatDistance(miles)}`);
        }
        renderTools();
      }
    });
    map.on("error", (event) => {
      if (event.error && !warnedMapErrorRef.current) {
        warnedMapErrorRef.current = true;
        console.warn("Map source error", event.error);
      }
    });

    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // The map instance owns initial camera and style. Later changes are bridged below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    projectionRef.current = projection;
    try {
      map.setProjection({ type: projection });
      map.triggerRepaint();
    } catch {
      // Projection applies again after the active style finishes loading.
    }
  }, [projection]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapStyleRef.current === mapStyle) return;
    mapStyleRef.current = mapStyle;
    map.setStyle(mapStyleDefinition(mapStyle));
  }, [mapStyle]);

  useEffect(() => {
    radarFrameRef.current = radarFrame;
    radarVisibleRef.current = radarVisible;
    radarOpacityRef.current = radarOpacity;
    if (containerRef.current) {
      containerRef.current.dataset.radarFrame = radarFrame
        ? String(radarFrame.time)
        : "";
    }
    syncRadar();
  }, [radarFrame, radarVisible, radarOpacity]);

  useEffect(() => {
    customOverlayRef.current = customOverlay;
    syncCustomOverlay();
  }, [customOverlay]);

  useEffect(() => {
    toolModeRef.current = toolMode;
    const map = mapRef.current;
    if (map) map.getCanvas().style.cursor = toolMode ? "crosshair" : "grab";
    rangeStartRef.current = null;
    rangeEndRef.current = null;
    onToolResult?.(
      toolMode === "draw"
        ? "Click the map to draw a path"
        : toolMode === "range"
          ? "Select the start point"
          : toolMode === "inspect"
            ? "Click the map to inspect a point"
            : null,
    );
  }, [toolMode, onToolResult]);

  return (
    <div
      className="map-viewport"
      ref={containerRef}
      role="application"
      aria-label={label}
    />
  );
}

export const MapViewport = forwardRef<MapViewportHandle, MapViewportProps>(
  MapViewportInner,
);
