import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type ForwardedRef,
} from "react";
import * as maplibregl from "maplibre-gl";
import type { ExpressionSpecification } from "maplibre-gl";
import {
  flashColorExpression,
  flashOpacityExpression,
} from "../hooks/useLightning";
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
import { cachedUrl } from "../lib/tileCache";
import { log } from "../lib/log";
import {
  SATELLITE_ATTRIBUTION,
  SATELLITE_MAX_ZOOM,
  guardRadarRequest,
  satelliteTileUrl,
} from "../lib/providers";
import type { MrmsLayer } from "../hooks/useMrmsOverlays";
import {
  beamHeightFeet,
  sweepCorners,
  sweepSite,
  type SweepImage,
} from "../lib/level2";
import { createWindLayer } from "../lib/windLayer";
import type { WindField } from "../lib/wind";
import type { RadarFrame } from "../lib/radar";
import { formatHeight } from "../lib/units";
import {
  cameraKey,
  sameCamera,
  type CameraState,
  type MapStyleId,
  type ProjectionMode,
} from "../lib/settings";
import type { ToolMode } from "./CommandBar";
import {
  SURGE_ATTRIBUTION,
  surgeTileUrl,
  type SurgeCategory,
} from "../lib/surge";
import { translate } from "../i18n";
import { overlayBandOrder } from "../lib/overlayOrder";
import {
  CELL_FORECAST_LAYER_ID,
  CELL_LABEL_LAYER_ID,
  CELL_LAYER_IDS,
  CELL_POINT_LAYER_ID,
  CELL_TRACK_LAYER_ID,
  CUSTOM_FILL_LAYER_ID,
  CUSTOM_LAYER_IDS,
  CUSTOM_LINE_LAYER_ID,
  CUSTOM_POINT_LAYER_ID,
  FLASH_LAYER_ID,
  layerStackOrder,
  MRMS_LAYER_IDS,
  MRMS_SOURCE_PREFIX,
  PROBSEVERE_FILL_LAYER_ID,
  PROBSEVERE_LAYER_IDS,
  PROBSEVERE_LINE_LAYER_ID,
  RADAR_LAYER_ID,
  ROUTE_LAYER_ID,
  SATELLITE_LAYER_ID,
  SURGE_LAYER_ID,
  SWEEP_LAYER_ID,
  TOOL_LINE_LAYER_ID,
  TOOL_POINT_LAYER_ID,
  topmost,
  TRACK_LAYER_IDS,
  TRACK_LINE_LAYER_ID,
  TRACK_POINT_LAYER_ID,
  WIND_LAYER_ID,
} from "../lib/layerStack";

const SATELLITE_SOURCE_ID = "openradar-satellite-source";
const SURGE_SOURCE_ID = "openradar-surge-source";
const PROBSEVERE_SOURCE_ID = "openradar-probsevere-source";
const CELL_SOURCE_ID = "openradar-cell-source";
const FLASH_SOURCE_ID = "openradar-flash-source";
/** How far a site's own sweep reaches, which is as far as a beam height
 * means anything: past it the picture is the mosaic again. */
const MAX_SWEEP_RANGE_KM = 230;

const SWEEP_SOURCE_ID = "openradar-sweep-source";
const RADAR_SOURCE_ID = "openradar-radar-source";

type RadarLane = "observed" | "forecast";
const TOOL_SOURCE_ID = "openradar-tool-source";
const OVERLAY_SOURCE_PREFIX = "openradar-overlay-";
const ROUTE_SOURCE_ID = "openradar-route-source";
const TRACK_SOURCE_ID = "openradar-track-source";
const CUSTOM_SOURCE_ID = "openradar-custom-source";

export interface MapViewportHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  resetNorth: () => void;
  flyTo: (camera: CameraState) => void;
  /** Frames a box, choosing the zoom that fits it rather than a fixed one. */
  fitBounds: (bounds: OverlayBounds) => void;
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
  /** One site's own sweep, which stands in for the mosaic while it is set. */
  sweep?: SweepImage | null;
  /** Locally decoded MRMS products drawn over the radar. */
  mrmsLayers?: MrmsLayer[];
  /** GOES lightning flashes, newest brightest. */
  flashes?: Record<string, unknown> | null;
  /** Storm cells with their tracks, from the radar's own algorithm. */
  cells?: Record<string, unknown> | null;
  /** What the severe-probability model expects of each storm. */
  probSevere?: Record<string, unknown> | null;
  /** How solid each overlay is drawn, as a fraction of its own design. */
  overlayOpacity?: Record<string, number>;
  /** The order the overlays are drawn in, bottom first. */
  overlayOrder?: string[];
  /**
   * How long the flash window runs, in minutes, and the moment to fade
   * against. The fade is a paint property rather than part of the data, so it
   * advances without the whole collection being uploaded again.
   */
  flashWindowMinutes?: number;
  /**
   * Required, because there is no honest default: reading the clock here
   * would be reading it during render, and any fixed value would fade every
   * flash to one end of the ramp.
   */
  flashClock: number;
  /** The wind field the particles follow, or null when the layer is off. */
  wind?: WindField | null;
  /** The published image time to show, or null when the layer is off. */
  satelliteTime?: number | null;
  /** The hurricane category the surge picture is for, or null for no picture. */
  surgeCategory?: SurgeCategory | null;
  overlays?: Partial<Record<OverlayId, OverlayData | null>>;
  route?: Record<string, unknown> | null;
  customOverlay?: Record<string, unknown> | null;
  /** A past storm's best track, drawn while one is picked in Storm history. */
  stormTrack?: Record<string, unknown> | null;
  toolMode?: ToolMode;
  onCameraChange?: (camera: CameraState) => void;
  onCameraMove?: (camera: CameraState) => void;
  onCursorChange?: (point: GeoPoint | null) => void;
  /**
   * How to write the readout, not the readout itself: it is held while the
   * units can still change underneath it, so it has to be written on demand.
   */
  onToolResult?: (render: (() => string) | null) => void;
  onMapStatus?: (status: "loading" | "ready" | "error") => void;
}

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
let overlayOrderChosen: string[] = [];

function overlayLayerOrder(): string[] {
  const order = overlayBandOrder(overlayOrderChosen);
  return [...OVERLAY_ADAPTERS]
    .sort((left, right) => order.indexOf(left.id) - order.indexOf(right.id))
    .flatMap((adapter) =>
      adapter
        .layers(`${OVERLAY_SOURCE_PREFIX}${adapter.id}`)
        .map((layer) => layer.id),
    );
}


/**
 * The layers that belong above the one being added. A layer the order does not
 * know goes on top rather than under everything, which is the safer miss.
 */
function layersAbove(id: string): string[] {
  const order = layerStackOrder(overlayLayerOrder());
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
    label = translate("map.label"),
    camera,
    projection,
    mapStyle,
    radarFrame,
    radarVisible,
    radarOpacity,
    sweep = null,
    mrmsLayers = [],
    flashes = null,
    cells = null,
    probSevere = null,
    overlayOpacity = {},
    overlayOrder = [],
    flashWindowMinutes = 5,
    flashClock,
    wind = null,
    satelliteTime = null,
    surgeCategory = null,
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
  const sweepRef = useRef<SweepImage | null>(sweep);
  const mrmsLayersRef = useRef<MrmsLayer[]>(mrmsLayers);
  const flashesRef = useRef<Record<string, unknown> | null>(flashes);
  const cellsRef = useRef<Record<string, unknown> | null>(cells);
  const probSevereRef = useRef<Record<string, unknown> | null>(probSevere);
  const overlayOpacityRef = useRef(overlayOpacity);
  const flashWindowRef = useRef(flashWindowMinutes);
  const flashClockRef = useRef(flashClock);
  const windRef = useRef<WindField | null>(wind);
  const windLayerRef = useRef<ReturnType<typeof createWindLayer> | null>(null);
  const customOverlayRef = useRef<Record<string, unknown> | null>(
    customOverlay,
  );
  const stormTrackRef = useRef<Record<string, unknown> | null>(stormTrack);
  const satelliteTimeRef = useRef(satelliteTime);
  const surgeCategoryRef = useRef(surgeCategory);
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
    // A custom layer has no entry in the style, so it has to be named here or
    // nothing outside this file can tell whether it is on the map.
    if (map.getLayer(WIND_LAYER_ID)) ids.push(WIND_LAYER_ID);
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

  const syncSurge = () => {
    const map = mapRef.current;
    if (!map || !styleReadyRef.current) return;
    const category = surgeCategoryRef.current;

    if (category === null) {
      if (map.getSource(SURGE_SOURCE_ID)) {
        if (map.getLayer(SURGE_LAYER_ID)) map.removeLayer(SURGE_LAYER_ID);
        map.removeSource(SURGE_SOURCE_ID);
        publishLayers();
      }
      return;
    }

    const url = surgeTileUrl(category);
    const source = map.getSource(SURGE_SOURCE_ID) as
      maplibregl.RasterTileSource | undefined;
    if (source) {
      source.setTiles?.([url]);
      return;
    }

    map.addSource(SURGE_SOURCE_ID, {
      type: "raster",
      tiles: [url],
      tileSize: 256,
      attribution: SURGE_ATTRIBUTION,
    });
    map.addLayer(
      {
        id: SURGE_LAYER_ID,
        type: "raster",
        source: SURGE_SOURCE_ID,
        paint: { "raster-opacity": 0.7 },
      },
      firstExisting(map, layersAbove(SURGE_LAYER_ID)),
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
      const opacity =
        frame && radarVisibleRef.current && !sweepRef.current
          ? radarOpacityRef.current
          : 0;
      map.setPaintProperty(layerId, "raster-opacity", opacity);
      map.setPaintProperty(layerId, "raster-fade-duration", 150);
      if (lane === "observed" && containerRef.current) {
        // What the mosaic is actually contributing, which is zero while a
        // single site has the map.
        containerRef.current.dataset.mosaicOpacity = opacity.toFixed(2);
      }
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
        rememberBaseOpacity(layer);
      }
    }

    applyOverlayOpacity();
    publishLayers();
  };

  /**
   * The opacity each overlay layer was designed with.
   *
   * A reader's slider multiplies this rather than replacing it. Several of
   * these are expressions rather than numbers, so the alert fill stays fainter
   * than its outline and a faded flash stays fainter than a fresh one:
   * flattening them to one value would throw away the design and leave the
   * layer readable only at full.
   */
  const baseOpacityRef = useRef(new Map<string, [string, unknown]>());

  const rememberBaseOpacity = (layer: maplibregl.LayerSpecification) => {
    const property =
      layer.type === "fill"
        ? "fill-opacity"
        : layer.type === "line"
          ? "line-opacity"
          : layer.type === "circle"
            ? "circle-opacity"
            : null;
    if (!property) return;
    const paint = (layer.paint ?? {}) as Record<string, unknown>;
    // A layer that never said gets MapLibre's own default of one.
    baseOpacityRef.current.set(layer.id, [property, paint[property] ?? 1]);
  };

  const applyOverlayOpacity = () => {
    const map = mapRef.current;
    if (!map || !styleReadyRef.current) return;
    for (const adapter of OVERLAY_ADAPTERS) {
      const factor = overlayOpacityRef.current[adapter.id] ?? 1;
      const sourceId = `${OVERLAY_SOURCE_PREFIX}${adapter.id}`;
      for (const layer of adapter.layers(sourceId)) {
        if (!map.getLayer(layer.id)) continue;
        const held = baseOpacityRef.current.get(layer.id);
        if (!held) continue;
        const [property, base] = held;
        map.setPaintProperty(
          layer.id,
          property as "fill-opacity",
          factor >= 1
            ? (base as never)
            : (["*", base, factor] as unknown as never),
        );
      }
    }
  };

  /** One popup, from a title and some lines. */
  const openPopup = (
    map: maplibregl.Map,
    at: maplibregl.LngLat,
    description: { title: string; lines: string[]; url?: string },
  ) => {
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
      link.textContent = translate("popup.openProduct");
      node.append(link);
    }
    new maplibregl.Popup({ closeButton: true, maxWidth: "260px" })
      .setLngLat(at)
      .setDOMContent(node)
      .addTo(map);
  };

  const showOverlayPopup = (event: maplibregl.MapMouseEvent) => {
    const map = mapRef.current;
    if (!map) return;

    const clickable = [...overlayLayerIds(), PROBSEVERE_FILL_LAYER_ID].filter(
      (id) => map.getLayer(id),
    );
    if (!clickable.length) return;

    const hits = map.queryRenderedFeatures(event.point, { layers: clickable });
    // The click answers with whatever the reader can see, which is the same
    // order the map draws in rather than a second list beside it.
    const hit = topmost(hits, layerStackOrder(overlayLayerOrder()));
    if (!hit) return;

    if (hit.layer.id === PROBSEVERE_FILL_LAYER_ID) {
      const properties = hit.properties ?? {};
      const detail = String(properties.detail ?? "");
      openPopup(map, event.lngLat, {
        title: translate("probSevere.title"),
        lines: [
          translate("probSevere.headline", {
            percent: String(properties.severe ?? 0),
          }),
          translate("probSevere.kinds", {
            hail: String(properties.hail ?? 0),
            wind: String(properties.wind ?? 0),
            tornado: String(properties.tornado ?? 0),
          }),
          ...(detail ? [detail] : []),
          translate("probSevere.note"),
        ],
      });
      return;
    }

    const adapter = OVERLAY_ADAPTERS.find((candidate) =>
      hit.layer.id.startsWith(`${OVERLAY_SOURCE_PREFIX}${candidate.id}`),
    );
    if (!adapter) return;

    openPopup(map, event.lngLat, adapter.describe(hit.properties ?? {}));
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

  const syncWind = () => {
    const map = mapRef.current;
    const field = windRef.current;
    if (!map || !styleReadyRef.current) return;

    if (!field) {
      if (map.getLayer(WIND_LAYER_ID)) map.removeLayer(WIND_LAYER_ID);
      windLayerRef.current = null;
      publishLayers();
      return;
    }
    if (windLayerRef.current && map.getLayer(WIND_LAYER_ID)) {
      windLayerRef.current.setField(field);
      return;
    }

    const layer = createWindLayer({
      id: WIND_LAYER_ID,
      field,
      onError: (message) => log.warn("wind", message),
    });
    windLayerRef.current = layer;
    map.addLayer(layer, firstExisting(map, layersAbove(WIND_LAYER_ID)));
    publishLayers();
  };

  const flashColor = () =>
    flashColorExpression(
      flashClockRef.current,
      flashWindowRef.current,
    ) as ExpressionSpecification;

  const flashOpacity = () =>
    flashOpacityExpression(
      flashClockRef.current,
      flashWindowRef.current,
    ) as ExpressionSpecification;

  /**
   * What the severe-probability model expects of each storm.
   *
   * Drawn as an outline with a wash inside, shaded by the headline number, so
   * a glance across the map picks out the two cells the model is worried about
   * among the forty it is not.
   */
  const syncProbSevere = () => {
    const map = mapRef.current;
    const drawn = probSevereRef.current;
    if (!map || !styleReadyRef.current) return;

    let source = map.getSource(PROBSEVERE_SOURCE_ID) as
      maplibregl.GeoJSONSource | undefined;
    if (!drawn) {
      if (source) {
        for (const id of PROBSEVERE_LAYER_IDS) {
          if (map.getLayer(id)) map.removeLayer(id);
        }
        map.removeSource(PROBSEVERE_SOURCE_ID);
      }
      publishLayers();
      return;
    }

    if (!source) {
      map.addSource(PROBSEVERE_SOURCE_ID, {
        type: "geojson",
        data: drawn as never,
      });
      map.addLayer(
        {
          id: PROBSEVERE_FILL_LAYER_ID,
          type: "fill",
          source: PROBSEVERE_SOURCE_ID,
          paint: {
            "fill-color": [
              "interpolate",
              ["linear"],
              ["get", "severe"],
              10,
              "#fde68a",
              50,
              "#fb923c",
              90,
              "#dc2626",
            ],
            // Light enough to read the radar through: this is guidance about
            // the storm underneath, not a replacement for looking at it.
            "fill-opacity": 0.18,
          },
        },
        firstExisting(map, layersAbove(PROBSEVERE_FILL_LAYER_ID)),
      );
      map.addLayer(
        {
          id: PROBSEVERE_LINE_LAYER_ID,
          type: "line",
          source: PROBSEVERE_SOURCE_ID,
          paint: {
            "line-color": [
              "interpolate",
              ["linear"],
              ["get", "severe"],
              10,
              "#fde68a",
              50,
              "#fb923c",
              90,
              "#dc2626",
            ],
            "line-width": [
              "interpolate",
              ["linear"],
              ["get", "severe"],
              10,
              1,
              90,
              2.5,
            ],
          },
        },
        firstExisting(map, layersAbove(PROBSEVERE_LINE_LAYER_ID)),
      );
      source = map.getSource(PROBSEVERE_SOURCE_ID) as maplibregl.GeoJSONSource;
    }
    source.setData(drawn as never);
    publishLayers();
  };

  /**
   * The storm cells: where each is, where it has been, where it is going.
   *
   * Four layers over one source, because a track, a forecast position, the
   * storm itself and its name are four different things and MapLibre draws
   * one kind of geometry per layer.
   */
  const syncCells = () => {
    const map = mapRef.current;
    const drawn = cellsRef.current;
    if (!map || !styleReadyRef.current) return;

    let source = map.getSource(CELL_SOURCE_ID) as
      maplibregl.GeoJSONSource | undefined;
    if (!drawn) {
      if (source) {
        for (const id of CELL_LAYER_IDS) {
          if (map.getLayer(id)) map.removeLayer(id);
        }
        map.removeSource(CELL_SOURCE_ID);
      }
      publishLayers();
      return;
    }

    if (!source) {
      map.addSource(CELL_SOURCE_ID, { type: "geojson", data: drawn as never });
      map.addLayer(
        {
          id: CELL_TRACK_LAYER_ID,
          type: "line",
          source: CELL_SOURCE_ID,
          filter: ["==", ["get", "kind"], "track"],
          paint: {
            "line-color": "#f8fafc",
            "line-width": 1.5,
            "line-opacity": 0.75,
            // Dashed, so a track is never taken for a road or a boundary.
            "line-dasharray": [2, 2],
          },
        },
        firstExisting(map, layersAbove(CELL_TRACK_LAYER_ID)),
      );
      map.addLayer(
        {
          id: CELL_FORECAST_LAYER_ID,
          type: "circle",
          source: CELL_SOURCE_ID,
          filter: ["==", ["get", "kind"], "forecast"],
          paint: {
            // Fainter the further ahead it is, because it is less certain.
            "circle-radius": 3,
            "circle-color": "#f8fafc",
            "circle-opacity": [
              "interpolate",
              ["linear"],
              ["get", "minutes"],
              15,
              0.8,
              60,
              0.3,
            ],
            "circle-stroke-width": 0,
          },
        },
        firstExisting(map, layersAbove(CELL_FORECAST_LAYER_ID)),
      );
      map.addLayer(
        {
          id: CELL_POINT_LAYER_ID,
          type: "circle",
          source: CELL_SOURCE_ID,
          filter: [
            "any",
            ["==", ["get", "kind"], "cell"],
            // A circulation the tracking algorithm found no storm for is
            // still a circulation, and it is drawn where it is.
            ["==", ["get", "kind"], "rotation"],
          ],
          paint: {
            "circle-radius": 7,
            "circle-color": "rgba(0,0,0,0)",
            // A storm with rotation in it is the one to look at first.
            "circle-stroke-color": [
              "case",
              ["==", ["get", "kind"], "rotation"],
              "#f87171",
              ["get", "rotating"],
              "#f87171",
              "#f8fafc",
            ],
            "circle-stroke-width": [
              "case",
              ["==", ["get", "kind"], "rotation"],
              3,
              ["get", "rotating"],
              3,
              2,
            ],
          },
        },
        firstExisting(map, layersAbove(CELL_POINT_LAYER_ID)),
      );
      map.addLayer(
        {
          id: CELL_LABEL_LAYER_ID,
          type: "symbol",
          source: CELL_SOURCE_ID,
          filter: [
            "any",
            ["==", ["get", "kind"], "cell"],
            ["==", ["get", "kind"], "rotation"],
          ],
          layout: {
            "text-field": ["get", "id"],
            "text-size": 11,
            "text-offset": [0, -1.4],
            "text-allow-overlap": false,
          },
          paint: {
            "text-color": "#f8fafc",
            "text-halo-color": "rgba(9, 11, 16, 0.85)",
            "text-halo-width": 1.5,
          },
        },
        firstExisting(map, layersAbove(CELL_LABEL_LAYER_ID)),
      );
      source = map.getSource(CELL_SOURCE_ID) as maplibregl.GeoJSONSource;
    }
    source.setData(drawn as never);
    publishLayers();
  };

  const syncFlashes = () => {
    const map = mapRef.current;
    const points = flashesRef.current;
    if (!map || !styleReadyRef.current) return;

    let source = map.getSource(FLASH_SOURCE_ID) as
      maplibregl.GeoJSONSource | undefined;
    if (!points) {
      if (source) {
        if (map.getLayer(FLASH_LAYER_ID)) map.removeLayer(FLASH_LAYER_ID);
        map.removeSource(FLASH_SOURCE_ID);
      }
      publishLayers();
      return;
    }
    if (!source) {
      map.addSource(FLASH_SOURCE_ID, {
        type: "geojson",
        data: points as never,
      });
      map.addLayer(
        {
          id: FLASH_LAYER_ID,
          type: "circle",
          source: FLASH_SOURCE_ID,
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 2, 9, 5],
            // A flash from a minute ago is bright; one from five minutes ago is
            // a faint trail behind the storm.
            "circle-color": flashColor(),
            "circle-opacity": flashOpacity(),
            "circle-stroke-width": 0,
          },
        },
        firstExisting(map, layersAbove(FLASH_LAYER_ID)),
      );
      source = map.getSource(FLASH_SOURCE_ID) as maplibregl.GeoJSONSource;
    }
    source.setData(points as never);
    fadeFlashes();
    publishLayers();
  };

  /**
   * Moves the fade on without touching the data.
   *
   * How old a flash is depends on the clock, and the clock ticks every minute.
   * Working the age into each feature meant rebuilding and re-uploading the
   * whole collection every time, for a picture that differs only in how bright
   * the old flashes are. Two paint properties say the same thing.
   */
  const fadeFlashes = () => {
    const map = mapRef.current;
    if (!map || !map.getLayer(FLASH_LAYER_ID)) return;
    map.setPaintProperty(FLASH_LAYER_ID, "circle-color", flashColor());
    map.setPaintProperty(FLASH_LAYER_ID, "circle-opacity", flashOpacity());
  };

  const syncMrmsLayers = () => {
    const map = mapRef.current;
    if (!map || !styleReadyRef.current) return;
    const wanted = new Map(
      mrmsLayersRef.current.map((layer) => [
        `${MRMS_SOURCE_PREFIX}${layer.product}`,
        layer,
      ]),
    );

    for (const id of MRMS_LAYER_IDS) {
      const layer = wanted.get(id);
      const source = map.getSource(id) as
        maplibregl.RasterTileSource | undefined;

      if (!layer) {
        if (source) {
          if (map.getLayer(id)) map.removeLayer(id);
          map.removeSource(id);
        }
        continue;
      }

      // A new grid is a new set of tiles, so the source is replaced rather
      // than asked to refresh what it already has.
      if (source && source.tiles?.[0] !== layer.tileUrl) {
        if (map.getLayer(id)) map.removeLayer(id);
        map.removeSource(id);
      }
      if (!map.getSource(id)) {
        map.addSource(id, {
          type: "raster",
          tiles: [layer.tileUrl],
          tileSize: 256,
          maxzoom: 10,
          attribution:
            '<a href="https://www.nssl.noaa.gov/projects/mrms/">NOAA MRMS</a>',
        });
        map.addLayer(
          {
            id,
            type: "raster",
            source: id,
            paint: { "raster-opacity": 0.85, "raster-fade-duration": 0 },
          },
          firstExisting(map, layersAbove(id)),
        );
      }
    }
    publishLayers();
  };

  const syncSweep = () => {
    const map = mapRef.current;
    const next = sweepRef.current;
    if (!map || !styleReadyRef.current) return;

    const source = map.getSource(SWEEP_SOURCE_ID) as
      maplibregl.ImageSource | undefined;
    if (!next || !radarVisibleRef.current) {
      if (source) {
        if (map.getLayer(SWEEP_LAYER_ID)) map.removeLayer(SWEEP_LAYER_ID);
        map.removeSource(SWEEP_SOURCE_ID);
      }
      publishLayers();
      return;
    }

    const corners = sweepCorners(next);
    if (!source) {
      map.addSource(SWEEP_SOURCE_ID, {
        type: "image",
        url: next.image,
        coordinates: corners,
      });
      map.addLayer(
        {
          id: SWEEP_LAYER_ID,
          type: "raster",
          source: SWEEP_SOURCE_ID,
          paint: {
            "raster-opacity": radarOpacityRef.current,
            // The sweep is already drawn at the resolution it was decoded at,
            // and smoothing it turns gates into mush.
            "raster-resampling": "nearest",
            "raster-fade-duration": 0,
          },
        },
        firstExisting(map, layersAbove(SWEEP_LAYER_ID)),
      );
    } else {
      // updateImage takes both together, which is what keeps a new volume from
      // being drawn over the previous one's footprint for a frame.
      source.updateImage({ url: next.image, coordinates: corners });
      map.setPaintProperty(
        SWEEP_LAYER_ID,
        "raster-opacity",
        radarOpacityRef.current,
      );
    }
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
    fitBounds: (bounds) => {
      const map = mapRef.current;
      if (!map) return;
      // A box that crosses the date line is written with its east edge west of
      // its west edge. MapLibre reads it correctly if the east edge is carried
      // past 180 rather than wrapped back round.
      const east = bounds.east < bounds.west ? bounds.east + 360 : bounds.east;
      map.fitBounds(
        [
          [bounds.west, bounds.south],
          [east, bounds.north],
        ],
        { padding: 80, maxZoom: 9, duration: 900 },
      );
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
      // Guarded first, so a request the budget refuses is never fetched at
      // all, and then routed through the cache so it survives going offline.
      transformRequest: (url) => ({ url: cachedUrl(guardRadarRequest(url)) }),
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
      syncSurge();
      syncRadar();
      syncSweep();
      syncMrmsLayers();
      syncFlashes();
      syncWind();
      syncProbSevere();
      syncCells();
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
        const zoom = map.getZoom();
        // During a single-site view, how high the beam is over the spot that
        // was clicked. The same picture at the same tilt means something else
        // eighty miles further out, because the beam has climbed.
        const drawn = sweepRef.current;
        let beam: { feet: number; tilt: number } | null = null;
        if (drawn) {
          const site = sweepSite(drawn);
          const rangeKm = haversineMiles(site, point) * 1.609344;
          if (rangeKm <= MAX_SWEEP_RANGE_KM) {
            beam = {
              feet: beamHeightFeet(rangeKm, drawn.elevationDegrees),
              tilt: drawn.elevationDegrees,
            };
          }
        }
        // The height is left in feet and written out later, because the units
        // can change while this reading is still on screen.
        onToolResult?.(() => {
          const lines = [
            translate("tool.inspectAt", {
              lat: point.lat.toFixed(4),
              lon: point.lon.toFixed(4),
              zoom: zoom.toFixed(2),
            }),
          ];
          if (beam) {
            lines.push(
              translate("tool.beamHeight", {
                height: formatHeight(beam.feet),
                tilt: beam.tilt.toFixed(2),
              }),
            );
          }
          return lines.join(" · ");
        });
      } else if (toolModeRef.current === "draw") {
        drawPointsRef.current = [...drawPointsRef.current, point];
        renderTools();
        const points = drawPointsRef.current.length;
        onToolResult?.(() => translate("tool.pathPoints", { count: points }));
      } else if (toolModeRef.current === "range") {
        if (!rangeStartRef.current || rangeEndRef.current) {
          rangeStartRef.current = point;
          rangeEndRef.current = null;
          onToolResult?.(() => translate("tool.endHint"));
        } else {
          rangeEndRef.current = point;
          const miles = haversineMiles(rangeStartRef.current, point);
          onToolResult?.(() =>
            translate("tool.rangeResult", { distance: formatDistance(miles) }),
          );
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
    // Which basemap is actually drawn, which is not the same as the setting:
    // Auto resolves against the theme before it gets here.
    if (containerRef.current) containerRef.current.dataset.mapStyle = mapStyle;
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
    sweepRef.current = sweep;
    if (containerRef.current) {
      containerRef.current.dataset.radarFrame = radarFrame
        ? String(radarFrame.time)
        : "";
    }
    syncRadar();
    syncSweep();
    // The sync functions read the refs above; adding them as dependencies
    // would rebuild the map layers on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radarFrame, radarVisible, radarOpacity, sweep]);

  useEffect(() => {
    satelliteTimeRef.current = satelliteTime;
    syncSatellite();
    // The sync function reads the ref above; adding it as a dependency would
    // rebuild the map layers on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [satelliteTime]);

  useEffect(() => {
    surgeCategoryRef.current = surgeCategory;
    syncSurge();
    // The sync function reads the ref above; adding it as a dependency would
    // rebuild the map layers on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surgeCategory]);

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
    windRef.current = wind;
    syncWind();
    // The sync function reads the ref above; adding it as a dependency would
    // rebuild the map layers on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wind]);

  useEffect(() => {
    // A tick of the clock moves the fade and nothing else.
    flashClockRef.current = flashClock;
    flashWindowRef.current = flashWindowMinutes;
    fadeFlashes();
    // The fade function reads the refs above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashClock, flashWindowMinutes]);

  useEffect(() => {
    // The stack is rebuilt from this, so it has to be in place before the
    // overlays are put back.
    overlayOrderChosen = overlayOrder;
    const map = mapRef.current;
    if (map && styleReadyRef.current) {
      // Taking them all off and adding them again is what puts them in the
      // new order: MapLibre places a layer relative to the ones already there.
      for (const adapter of OVERLAY_ADAPTERS) {
        const sourceId = `${OVERLAY_SOURCE_PREFIX}${adapter.id}`;
        if (!map.getSource(sourceId)) continue;
        for (const layer of adapter.layers(sourceId)) {
          if (map.getLayer(layer.id)) map.removeLayer(layer.id);
        }
        map.removeSource(sourceId);
      }
      syncOverlays();
    }
    // The sync function reads refs rather than props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayOrder]);

  useEffect(() => {
    overlayOpacityRef.current = overlayOpacity;
    applyOverlayOpacity();
  }, [overlayOpacity]);

  useEffect(() => {
    probSevereRef.current = probSevere;
    syncProbSevere();
    // The sync function reads the ref above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probSevere]);

  useEffect(() => {
    cellsRef.current = cells;
    syncCells();
    // The sync function reads the ref above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells]);

  useEffect(() => {
    flashesRef.current = flashes;
    syncFlashes();
    // The sync function reads the ref above; adding it as a dependency would
    // rebuild the map layers on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashes]);

  useEffect(() => {
    mrmsLayersRef.current = mrmsLayers;
    syncMrmsLayers();
    // The sync function reads the ref above; adding it as a dependency would
    // rebuild the map layers on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mrmsLayers]);

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
    const hint =
      toolMode === "draw"
        ? "tool.drawHint"
        : toolMode === "range"
          ? "tool.startHint"
          : toolMode === "inspect"
            ? "tool.inspectHint"
            : null;
    onToolResult?.(hint === null ? null : () => translate(hint));
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
