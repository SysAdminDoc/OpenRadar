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
import {
  OVERLAY_ADAPTERS,
  type OverlayBounds,
  type OverlayData,
  type OverlayId,
} from "../lib/overlays";
import { log } from "../lib/log";
import {
  SATELLITE_ATTRIBUTION,
  SATELLITE_MAX_ZOOM,
  guardRadarRequest,
  satelliteTileUrl,
} from "../lib/providers";
import type { RadarFrame } from "../lib/radar";
import {
  cameraKey,
  sameCamera,
  type CameraState,
  type MapStyleId,
  type ProjectionMode,
} from "../lib/settings";
import type { ToolMode } from "./CommandBar";

const SATELLITE_SOURCE_ID = "openradar-satellite-source";
const SATELLITE_LAYER_ID = "openradar-satellite-layer";
const RADAR_SOURCE_ID = "openradar-radar-source";
const RADAR_LAYER_ID = "openradar-radar-layer";

type RadarLane = "observed" | "forecast";
const TOOL_SOURCE_ID = "openradar-tool-source";
const TOOL_LINE_LAYER_ID = "openradar-tool-line";
const TOOL_POINT_LAYER_ID = "openradar-tool-points";
const OVERLAY_SOURCE_PREFIX = "openradar-overlay-";
const ROUTE_SOURCE_ID = "openradar-route-source";
const ROUTE_LAYER_ID = "openradar-route-line";
const TRACK_SOURCE_ID = "openradar-track-source";
const TRACK_LINE_LAYER_ID = "openradar-track-line";
const TRACK_POINT_LAYER_ID = "openradar-track-points";
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
  bounds: () => OverlayBounds | null;
  canvas: () => HTMLCanvasElement | null;
  /** Resolves once the map has finished drawing what it was given. */
  onceIdle: () => Promise<void>;
}

interface MapViewportProps {
  label?: string;
  camera: CameraState;
  projection: ProjectionMode;
  mapStyle: MapStyleId;
  radarFrame?: RadarFrame;
  radarVisible: boolean;
  radarOpacity: number;
  /** The published image time to show, or null when the layer is off. */
  satelliteTime?: number | null;
  overlays?: Partial<Record<OverlayId, OverlayData | null>>;
  route?: Record<string, unknown> | null;
  customOverlay?: Record<string, unknown> | null;
  /** A past storm's best track, drawn while one is picked in Storm history. */
  stormTrack?: Record<string, unknown> | null;
  toolMode?: ToolMode;
  onCameraChange?: (camera: CameraState) => void;
  onCameraMove?: (camera: CameraState) => void;
  onCursorChange?: (point: GeoPoint | null) => void;
  onToolResult?: (message: string | null) => void;
  onMapStatus?: (status: "loading" | "ready" | "error") => void;
}

const TRACK_LAYER_IDS = [TRACK_LINE_LAYER_ID, TRACK_POINT_LAYER_ID];

const CUSTOM_LAYER_IDS = [
  CUSTOM_FILL_LAYER_ID,
  CUSTOM_LINE_LAYER_ID,
  CUSTOM_POINT_LAYER_ID,
];
const TOOL_LAYER_IDS = [TOOL_LINE_LAYER_ID, TOOL_POINT_LAYER_ID];
const RADAR_LANE_LAYER_IDS = [
  `${RADAR_LAYER_ID}-observed`,
  `${RADAR_LAYER_ID}-forecast`,
];

/**
 * Keeps a late-arriving layer under everything that belongs above it. The
 * anchor has to be read from the style, because layers are added in whatever
 * order their data arrives, not in the order the adapters are declared.
 */
function firstExisting(map: maplibregl.Map, ids: string[]): string | undefined {
  const wanted = new Set(ids);
  for (const layer of map.getStyle().layers ?? []) {
    if (wanted.has(layer.id)) return layer.id;
  }
  return undefined;
}

/**
 * Bottom to top among the overlays: context first, warnings last. Typed as a
 * complete record, so adding an overlay without placing it in the stack is a
 * compile error rather than a layer that quietly sinks to the bottom.
 */
const OVERLAY_DEPTH: Record<OverlayId, number> = {
  tropical: 0,
  wildfires: 1,
  earthquakes: 2,
  alerts: 3,
};

function overlayLayerOrder(): string[] {
  return [...OVERLAY_ADAPTERS]
    .sort((left, right) => OVERLAY_DEPTH[left.id] - OVERLAY_DEPTH[right.id])
    .flatMap((adapter) =>
      adapter
        .layers(`${OVERLAY_SOURCE_PREFIX}${adapter.id}`)
        .map((layer) => layer.id),
    );
}

/**
 * Bottom to top, the order every OpenRadar layer belongs in. A layer is added
 * before the first of these that is already on the map, which keeps the stack
 * right no matter which data arrives first.
 */
function layerStackOrder(): string[] {
  return [
    SATELLITE_LAYER_ID,
    ...RADAR_LANE_LAYER_IDS,
    ...overlayLayerOrder(),
    ...TRACK_LAYER_IDS,
    ROUTE_LAYER_ID,
    ...CUSTOM_LAYER_IDS,
    ...TOOL_LAYER_IDS,
  ];
}

/**
 * The layers that belong above the one being added. A layer the order does not
 * know goes on top rather than under everything, which is the safer miss.
 */
function layersAbove(id: string): string[] {
  const order = layerStackOrder();
  const at = order.indexOf(id);
  return at < 0 ? [] : order.slice(at + 1);
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
    satelliteTime = null,
    overlays = {},
    route = null,
    customOverlay = null,
    stormTrack = null,
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
  const stormTrackRef = useRef<Record<string, unknown> | null>(stormTrack);
  const satelliteTimeRef = useRef(satelliteTime);
  const overlaysRef = useRef(overlays);
  const routeRef = useRef(route);
  const projectionRef = useRef(projection);
  const mapStyleRef = useRef(mapStyle);
  const toolModeRef = useRef<ToolMode>(toolMode);
  const drawPointsRef = useRef<GeoPoint[]>([]);
  const rangeStartRef = useRef<GeoPoint | null>(null);
  const rangeEndRef = useRef<GeoPoint | null>(null);
  const loggedMapErrorsRef = useRef(new Set<string>());
  const suppressCameraEventsRef = useRef(0);
  const radarSourceKeysRef = useRef<Record<RadarLane, string | null>>({
    observed: null,
    forecast: null,
  });
  // isStyleLoaded() also waits on tiles, so it can report false long after the
  // style is ready for new sources. The style.load event is the real signal.
  const styleReadyRef = useRef(false);

  const publishCamera = (next: CameraState) => {
    const container = containerRef.current;
    if (!container) return;
    container.dataset.camera = cameraKey(next);
  };

  const publishLayers = () => {
    const map = mapRef.current;
    const container = containerRef.current;
    if (!map || !container || !styleReadyRef.current) return;
    const ids = (map.getStyle().layers ?? [])
      .map((layer) => layer.id)
      .filter((id) => id.startsWith("openradar-"));
    container.dataset.layerStack = ids.join(" ");
    container.dataset.overlayLayers = ids
      .filter((id) => id.startsWith(OVERLAY_SOURCE_PREFIX))
      .join(" ");
  };

  const renderTools = () => {
    const map = mapRef.current;
    if (!map || !styleReadyRef.current) return;

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

  const syncSatellite = () => {
    const map = mapRef.current;
    if (!map || !styleReadyRef.current) return;
    const time = satelliteTimeRef.current;

    if (time === null) {
      if (map.getSource(SATELLITE_SOURCE_ID)) {
        if (map.getLayer(SATELLITE_LAYER_ID))
          map.removeLayer(SATELLITE_LAYER_ID);
        map.removeSource(SATELLITE_SOURCE_ID);
        publishLayers();
      }
      return;
    }

    const url = satelliteTileUrl(time);
    const source = map.getSource(SATELLITE_SOURCE_ID) as
      maplibregl.RasterTileSource | undefined;
    if (source) {
      source.setTiles?.([url]);
      return;
    }

    map.addSource(SATELLITE_SOURCE_ID, {
      type: "raster",
      tiles: [url],
      tileSize: 256,
      maxzoom: SATELLITE_MAX_ZOOM,
      attribution: SATELLITE_ATTRIBUTION,
    });
    // Satellite sits under everything, radar included.
    map.addLayer(
      {
        id: SATELLITE_LAYER_ID,
        type: "raster",
        source: SATELLITE_SOURCE_ID,
        paint: { "raster-opacity": 0.85 },
      },
      firstExisting(map, layersAbove(SATELLITE_LAYER_ID)),
    );
    publishLayers();
  };

  const syncRadarLane = (lane: RadarLane, frame: RadarFrame | undefined) => {
    const map = mapRef.current;
    if (!map) return;
    const sourceId = `${RADAR_SOURCE_ID}-${lane}`;
    const layerId = `${RADAR_LAYER_ID}-${lane}`;

    if (frame) {
      // Tile size, native zoom, and credit belong to the source, so a change of
      // provider inside one lane still means a fresh source.
      const key = `${frame.providerId}:${frame.tileSize}:${frame.maxZoom}`;
      if (map.getSource(sourceId) && radarSourceKeysRef.current[lane] !== key) {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        map.removeSource(sourceId);
      }
      radarSourceKeysRef.current[lane] = key;

      const source = map.getSource(sourceId) as
        maplibregl.RasterTileSource | undefined;
      if (source) {
        source.setTiles?.([frame.tileUrl]);
      } else {
        map.addSource(sourceId, {
          type: "raster",
          tiles: [frame.tileUrl],
          tileSize: frame.tileSize,
          maxzoom: frame.maxZoom,
          attribution: frame.attribution,
        });
        map.addLayer(
          {
            id: layerId,
            type: "raster",
            source: sourceId,
            paint: { "raster-opacity": 0 },
          },
          firstExisting(map, layersAbove(layerId)),
        );
        publishLayers();
      }
    }

    if (map.getLayer(layerId)) {
      map.setPaintProperty(
        layerId,
        "raster-opacity",
        frame && radarVisibleRef.current ? radarOpacityRef.current : 0,
      );
      map.setPaintProperty(layerId, "raster-fade-duration", 150);
    }
  };

  /**
   * Observed and forecast tiles keep separate sources. Scrubbing across the
   * boundary then only changes which one is opaque, instead of tearing down a
   * source and throwing away every tile it had cached.
   */
  const syncRadar = () => {
    const map = mapRef.current;
    const frame = radarFrameRef.current;
    if (!map || !styleReadyRef.current || !frame) return;
    const lane: RadarLane = frame.forecast ? "forecast" : "observed";
    syncRadarLane(lane, frame);
    syncRadarLane(lane === "observed" ? "forecast" : "observed", undefined);
  };

  const overlayLayerIds = () => {
    const map = mapRef.current;
    if (!map) return [];
    return OVERLAY_ADAPTERS.flatMap((adapter) =>
      adapter
        .layers(`${OVERLAY_SOURCE_PREFIX}${adapter.id}`)
        .map((layer) => layer.id),
    ).filter((id) => map.getLayer(id));
  };

  const syncOverlays = () => {
    const map = mapRef.current;
    if (!map || !styleReadyRef.current) return;

    for (const adapter of OVERLAY_ADAPTERS) {
      const sourceId = `${OVERLAY_SOURCE_PREFIX}${adapter.id}`;
      const data = overlaysRef.current[adapter.id] ?? null;
      const existing = map.getSource(sourceId) as
        maplibregl.GeoJSONSource | undefined;

      if (!data) {
        if (existing) {
          for (const layer of adapter.layers(sourceId)) {
            if (map.getLayer(layer.id)) map.removeLayer(layer.id);
          }
          map.removeSource(sourceId);
        }
        continue;
      }

      if (existing) {
        existing.setData(data as never);
        continue;
      }

      map.addSource(sourceId, {
        type: "geojson",
        data: data as never,
        attribution: adapter.attribution,
      });
      // Each overlay goes under whatever belongs above it, so the stack does
      // not depend on which adapter answered first.
      for (const layer of adapter.layers(sourceId)) {
        map.addLayer(layer, firstExisting(map, layersAbove(layer.id)));
      }
    }

    publishLayers();
  };

  const showOverlayPopup = (event: maplibregl.MapMouseEvent) => {
    const map = mapRef.current;
    if (!map) return;
    const layers = overlayLayerIds();
    if (!layers.length) return;

    const hit = map.queryRenderedFeatures(event.point, { layers })[0];
    if (!hit) return;
    const adapter = OVERLAY_ADAPTERS.find((candidate) =>
      hit.layer.id.startsWith(`${OVERLAY_SOURCE_PREFIX}${candidate.id}`),
    );
    if (!adapter) return;

    const description = adapter.describe(hit.properties ?? {});
    const node = document.createElement("div");
    node.className = "map-popup";
    const title = document.createElement("strong");
    title.textContent = description.title;
    node.append(title);
    for (const line of description.lines) {
      const row = document.createElement("small");
      row.textContent = line;
      node.append(row);
    }
    if (description.url) {
      const link = document.createElement("a");
      link.href = description.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = "Open the official product";
      node.append(link);
    }

    new maplibregl.Popup({ closeButton: true, maxWidth: "260px" })
      .setLngLat(event.lngLat)
      .setDOMContent(node)
      .addTo(map);
  };

  const syncRoute = () => {
    const map = mapRef.current;
    if (!map || !styleReadyRef.current) return;
    const data = routeRef.current;
    const source = map.getSource(ROUTE_SOURCE_ID) as
      maplibregl.GeoJSONSource | undefined;

    if (!data) {
      if (source) {
        if (map.getLayer(ROUTE_LAYER_ID)) map.removeLayer(ROUTE_LAYER_ID);
        map.removeSource(ROUTE_SOURCE_ID);
        publishLayers();
      }
      return;
    }

    if (source) {
      source.setData(data as never);
      return;
    }

    map.addSource(ROUTE_SOURCE_ID, { type: "geojson", data: data as never });
    map.addLayer(
      {
        id: ROUTE_LAYER_ID,
        type: "line",
        source: ROUTE_SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-width": 5,
          "line-color": [
            "case",
            ["<", ["coalesce", ["get", "precipitationChance"], -1], 0],
            // No reading for that hour, which is not the same as no rain.
            "#94a3b8",
            [
              "interpolate",
              ["linear"],
              ["get", "precipitationChance"],
              0,
              "#4ade80",
              30,
              "#facc15",
              60,
              "#fb923c",
              85,
              "#f43f5e",
            ],
          ],
        },
      },
      firstExisting(map, layersAbove(ROUTE_LAYER_ID)),
    );
    publishLayers();
  };

  const syncStormTrack = () => {
    const map = mapRef.current;
    const track = stormTrackRef.current;
    if (!map || !styleReadyRef.current) return;

    let source = map.getSource(TRACK_SOURCE_ID) as
      maplibregl.GeoJSONSource | undefined;
    if (!track) {
      if (source) {
        for (const id of TRACK_LAYER_IDS) {
          if (map.getLayer(id)) map.removeLayer(id);
        }
        map.removeSource(TRACK_SOURCE_ID);
      }
      publishLayers();
      return;
    }
    if (!source) {
      map.addSource(TRACK_SOURCE_ID, { type: "geojson", data: track as never });
      const beforeTools = firstExisting(map, layersAbove(TRACK_LINE_LAYER_ID));
      map.addLayer(
        {
          id: TRACK_LINE_LAYER_ID,
          type: "line",
          source: TRACK_SOURCE_ID,
          filter: ["==", ["geometry-type"], "LineString"],
          paint: {
            "line-color": ["coalesce", ["get", "color"], "#e2e8f0"],
            "line-width": ["coalesce", ["get", "width"], 2],
            "line-opacity": 0.85,
          },
        },
        beforeTools,
      );
      map.addLayer(
        {
          id: TRACK_POINT_LAYER_ID,
          type: "circle",
          source: TRACK_SOURCE_ID,
          filter: ["==", ["geometry-type"], "Point"],
          // Each six-hourly fix is coloured by the wind it carried.
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              3,
              3.5,
              8,
              7,
            ],
            "circle-color": ["coalesce", ["get", "color"], "#94a3b8"],
            "circle-stroke-color": "#0f172a",
            "circle-stroke-width": 1,
          },
        },
        beforeTools,
      );
      source = map.getSource(TRACK_SOURCE_ID) as maplibregl.GeoJSONSource;
    }
    source.setData(track as never);
    publishLayers();
  };

  const syncCustomOverlay = () => {
    const map = mapRef.current;
    const overlay = customOverlayRef.current;
    if (!map || !styleReadyRef.current) return;

    let source = map.getSource(CUSTOM_SOURCE_ID) as
      maplibregl.GeoJSONSource | undefined;
    if (!overlay) {
      // Switching the layer off has to take the shapes with it.
      if (source) {
        for (const id of CUSTOM_LAYER_IDS) {
          if (map.getLayer(id)) map.removeLayer(id);
        }
        map.removeSource(CUSTOM_SOURCE_ID);
      }
      publishLayers();
      return;
    }
    if (!source) {
      map.addSource(CUSTOM_SOURCE_ID, {
        type: "geojson",
        data: overlay as never,
      });
      const beforeTools = firstExisting(map, layersAbove(CUSTOM_FILL_LAYER_ID));
      map.addLayer(
        {
          id: CUSTOM_FILL_LAYER_ID,
          type: "fill",
          source: CUSTOM_SOURCE_ID,
          filter: ["==", ["geometry-type"], "Polygon"],
          // A placefile carries its own colours; plain GeoJSON does not.
          paint: {
            "fill-color": ["coalesce", ["get", "color"], "#60a5fa"],
            "fill-opacity": 0.18,
          },
        },
        beforeTools,
      );
      map.addLayer(
        {
          id: CUSTOM_LINE_LAYER_ID,
          type: "line",
          source: CUSTOM_SOURCE_ID,
          filter: [
            "in",
            ["geometry-type"],
            ["literal", ["LineString", "Polygon"]],
          ],
          paint: {
            "line-color": ["coalesce", ["get", "color"], "#93c5fd"],
            "line-width": ["coalesce", ["get", "width"], 2],
          },
        },
        beforeTools,
      );
      map.addLayer(
        {
          id: CUSTOM_POINT_LAYER_ID,
          type: "circle",
          source: CUSTOM_SOURCE_ID,
          filter: ["==", ["geometry-type"], "Point"],
          paint: {
            "circle-radius": 6,
            "circle-color": ["coalesce", ["get", "color"], "#60a5fa"],
            "circle-stroke-color": "#eff6ff",
            "circle-stroke-width": 1.5,
          },
        },
        beforeTools,
      );
      source = map.getSource(CUSTOM_SOURCE_ID) as maplibregl.GeoJSONSource;
    }
    source.setData(overlay as never);
    publishLayers();
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
    canvas: () => mapRef.current?.getCanvas() ?? null,
    onceIdle: async () => {
      // Let React flush the frame change and the map paint it before the wait
      // starts, or an idle already in flight resolves against the old frame.
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
      return new Promise<void>((resolve) => {
        const map = mapRef.current;
        if (!map) {
          resolve();
          return;
        }
        // A frame that needs no new tiles never fires idle, so the wait is
        // bounded rather than open ended.
        const timer = window.setTimeout(finish, 2500);
        function finish() {
          window.clearTimeout(timer);
          map?.off("idle", finish);
          resolve();
        }
        map.once("idle", finish);
      });
    },
    bounds: () => {
      const map = mapRef.current;
      if (!map) return null;
      const box = map.getBounds();
      return {
        west: box.getWest(),
        south: box.getSouth(),
        east: box.getEast(),
        north: box.getNorth(),
      };
    },
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
      styleReadyRef.current = true;
      map.setProjection({ type: projectionRef.current });
      syncSatellite();
      syncRadar();
      renderTools();
      syncOverlays();
      syncRoute();
      syncStormTrack();
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
      if (!toolModeRef.current) {
        showOverlayPopup(event);
      } else if (toolModeRef.current === "inspect") {
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
      if (!event.error) return;
      const message = event.error.message || String(event.error);
      // One line per distinct failure keeps a broken tile source from filling
      // the log during playback.
      if (loggedMapErrorsRef.current.has(message)) return;
      loggedMapErrorsRef.current.add(message);
      log.warn("map", message);
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
    styleReadyRef.current = false;
    radarSourceKeysRef.current = { observed: null, forecast: null };
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
    // The sync functions read the refs above; adding them as dependencies
    // would rebuild the map layers on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radarFrame, radarVisible, radarOpacity]);

  useEffect(() => {
    satelliteTimeRef.current = satelliteTime;
    syncSatellite();
    // The sync function reads the ref above; adding it as a dependency would
    // rebuild the map layers on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [satelliteTime]);

  useEffect(() => {
    overlaysRef.current = overlays;
    syncOverlays();
    // The sync functions read the refs above; adding them as dependencies
    // would rebuild the map layers on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlays]);

  useEffect(() => {
    routeRef.current = route;
    syncRoute();
    // The sync function reads the ref above; adding it as a dependency would
    // rebuild the map layers on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);

  useEffect(() => {
    customOverlayRef.current = customOverlay;
    syncCustomOverlay();
    // The sync function reads the ref above; adding it as a dependency would
    // rebuild the map layers on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customOverlay]);

  useEffect(() => {
    stormTrackRef.current = stormTrack;
    syncStormTrack();
    // The sync function reads the ref above; adding it as a dependency would
    // rebuild the map layers on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stormTrack]);

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
