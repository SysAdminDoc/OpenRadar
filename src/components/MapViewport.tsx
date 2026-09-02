import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
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
import type { IncidentPackReference } from "../lib/settings";
import {
  OVERLAY_ADAPTERS,
  type OverlayBounds,
  type OverlayData,
  type OverlayId,
} from "../lib/overlays";
import { cachedUrl } from "../lib/tileCache";
import { log } from "../lib/log";
import { guardRadarRequest, type SatelliteProductId } from "../lib/providers";
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
import { formatHeight, useMeasurements } from "../lib/units";
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
import { translate, type StringKey } from "../i18n";
import { overlayBandOrder } from "../lib/overlayOrder";
import { popupFrom, safePopupUrl } from "../lib/mapPopup";
import { cameraMotion, useHighContrast } from "../hooks/useClock";
import { useMapSync } from "../hooks/useMapSync";
import { syncRasterLane, type RasterLane } from "../lib/mapLayers/raster";
import { syncSatelliteLane } from "../lib/mapLayers/satellite";
import { syncVectorLane, type VectorLane } from "../lib/mapLayers/vector";
import { syncRadarLane } from "../lib/mapLayers/radar";
import {
  syncImageLane,
  type ImageLane,
  type PinnedImage,
} from "../lib/mapLayers/image";
import { baseOpacity } from "../lib/mapLayers/opacity";
import { classificationPaint, type ClassStyle } from "../lib/classification";
import {
  CELL_FORECAST_LAYER_ID,
  CELL_LABEL_LAYER_ID,
  CELL_LAYER_IDS,
  CELL_POINT_LAYER_ID,
  CELL_TRACK_LAYER_ID,
  CLASSIFICATION_FILL_LAYER_ID,
  CLASSIFICATION_LINE_LAYER_ID,
  CLASSIFICATION_SOURCE_ID,
  FORECAST_SMOKE_LAYER_ID,
  FORECAST_SMOKE_SOURCE_ID,
  CUSTOM_FILL_LAYER_ID,
  CUSTOM_LINE_LAYER_ID,
  CUSTOM_POINT_LAYER_ID,
  FLASH_LAYER_ID,
  layerStackOrder,
  MRMS_LAYER_IDS,
  MRMS_SOURCE_PREFIX,
  PROBSEVERE_FILL_LAYER_ID,
  PROBSEVERE_LINE_LAYER_ID,
  RADAR_LAYER_ID,
  ROUTE_LAYER_ID,
  SATELLITE_LAYER_ID,
  SURGE_LAYER_ID,
  SWEEP_LAYER_ID,
  TOOL_LINE_LAYER_ID,
  TOOL_POINT_LAYER_ID,
  OVERLAY_SOURCE_PREFIX,
  TRACK_LINE_LAYER_ID,
  TRACK_POINT_LAYER_ID,
  WIND_LAYER_ID,
} from "../lib/layerStack";

const SURGE_LANE: RasterLane<SurgeCategory> = {
  sourceId: "openradar-surge-source",
  layerId: SURGE_LAYER_ID,
  attribution: SURGE_ATTRIBUTION,
  opacity: 0.7,
  fadeMs: 300,
  tileUrl: (category) => surgeTileUrl(category),
};
const PROBSEVERE_SOURCE_ID = "openradar-probsevere-source";
const CELL_SOURCE_ID = "openradar-cell-source";
const FLASH_SOURCE_ID = "openradar-flash-source";
/** How far a site's own sweep reaches, which is as far as a beam height
 * means anything: past it the picture is the mosaic again. */

const SWEEP_SOURCE_ID = "openradar-sweep-source";
const RADAR_SOURCE_ID = "openradar-radar-source";

type RadarLane = "observed" | "forecast";
const TOOL_SOURCE_ID = "openradar-tool-source";
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
  /**
   * When the reader last moved the map themselves, or null if they never
   * have.
   *
   * MapLibre stops a camera animation the moment a gesture starts, so an
   * interruption needs nothing from us. This is for the other half: not
   * taking the camera off somebody who is using it.
   */
  interactedAt: () => number | null;
}

interface MapViewportProps {
  label?: string;
  camera: CameraState;
  projection: ProjectionMode;
  mapStyle: MapStyleId;
  /** A completed local basemap archive selected for offline incident work. */
  incidentPack?: IncidentPackReference | null;
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
  /**
   * What the same algorithm says is falling, with the colours it says to draw
   * each class in. The legend arrives with the areas so the two cannot
   * disagree about what a colour means.
   */
  classification?: {
    features: Record<string, unknown>;
    legend: ClassStyle[];
  } | null;
  /** What the severe-probability model expects of each storm. */
  probSevere?: Record<string, unknown> | null;
  /**
   * The model's smoke for the hour on screen, pinned, or null off the
   * forecast tail. The primary pane's alone: the compare pane follows its
   * own frame and is handed nothing.
   */
  forecastSmoke?: PinnedImage | null;
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
  /** Which GOES-East view the satellite layer draws. */
  satelliteProductId?: SatelliteProductId;
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
  /**
   * The two ends of a cross-section, once both are down.
   *
   * Registered on the map once, so this has to be stable across renders the
   * way `onToolResult` is: a fresh function each render would leave the click
   * handler calling the first one forever.
   */
  onSection?: (from: GeoPoint, to: GeoPoint) => void;
  /**
   * The one thing a popup offered to do about what it is describing.
   *
   * The viewport renders the button and knows nothing about what the action
   * means; the workspace owns the settings it changes.
   */
  onOverlayAction?: (id: string) => void;
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
    incidentPack = null,
    radarFrame,
    radarVisible,
    radarOpacity,
    sweep = null,
    mrmsLayers = [],
    flashes = null,
    cells = null,
    classification = null,
    forecastSmoke = null,
    probSevere = null,
    overlayOpacity = {},
    overlayOrder = [],
    flashWindowMinutes = 5,
    flashClock,
    wind = null,
    satelliteTime = null,
    satelliteProductId = "geocolor",
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
    onSection,
    onOverlayAction,
    onMapStatus,
  }: MapViewportProps,
  ref: ForwardedRef<MapViewportHandle>,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  // When the reader last moved the map themselves, so nothing takes the
  // camera off somebody who is using it.
  const interactedAtRef = useRef<number | null>(null);
  const radarFrameRef = useRef<RadarFrame | undefined>(radarFrame);
  const radarVisibleRef = useRef(radarVisible);
  const radarOpacityRef = useRef(radarOpacity);
  const sweepRef = useRef<SweepImage | null>(sweep);
  const mrmsLayersRef = useRef<MrmsLayer[]>(mrmsLayers);
  const flashesRef = useRef<Record<string, unknown> | null>(flashes);
  const cellsRef = useRef<Record<string, unknown> | null>(cells);
  const classificationRef = useRef(classification);
  const forecastSmokeRef = useRef(forecastSmoke);
  const probSevereRef = useRef<Record<string, unknown> | null>(probSevere);
  // The layer specs are read once, when a source is first added, so the
  // preference has to be readable from inside the sync functions rather than
  // captured in a render.
  const highContrast = useHighContrast();
  // A layer that draws a measurement builds it into its own expression, so a
  // switch to metric has to rebuild the layer rather than only redraw it.
  const measurements = useMeasurements();
  const highContrastRef = useRef(highContrast);
  const overlayOpacityRef = useRef(overlayOpacity);
  const flashWindowRef = useRef(flashWindowMinutes);
  const flashClockRef = useRef(flashClock);
  const windRef = useRef<WindField | null>(wind);
  const windLayerRef = useRef<ReturnType<typeof createWindLayer> | null>(null);
  const customOverlayRef = useRef<Record<string, unknown> | null>(
    customOverlay,
  );
  const stormTrackRef = useRef<Record<string, unknown> | null>(stormTrack);
  // Read when the button is pressed rather than when the popup was built,
  // which can be many renders earlier.
  const onOverlayActionRef = useRef(onOverlayAction);
  const satelliteTimeRef = useRef(satelliteTime);
  const satelliteProductRef = useRef(satelliteProductId);
  // What is on the map now, which is not the same thing while a switch is
  // still to be applied.
  const drawnSatelliteRef = useRef(satelliteProductId);
  const surgeCategoryRef = useRef(surgeCategory);
  const overlaysRef = useRef(overlays);
  const routeRef = useRef(route);
  const projectionRef = useRef(projection);
  const styleIdentity = `${mapStyle}:${incidentPack?.id ?? ""}:${incidentPack?.sha256 ?? ""}`;
  const mapStyleRef = useRef(styleIdentity);
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
    // Which icons the symbol layers can actually find. MapLibre answers a
    // missing one with a transparent pixel and no complaint, so a layer whose
    // icons were never registered is on the stack and draws nothing at all.
    // Nothing outside this file can see that without being told.
    container.dataset.overlayIcons = OVERLAY_ADAPTERS.flatMap((adapter) =>
      (adapter.images?.() ?? [])
        .map((image) => image.id)
        // `hasImage` is not the question: this file answers a missing icon
        // with a one-pixel transparent square, so every id a layer names is
        // held whether or not the real thing was ever added. The size is what
        // separates the drawing from the placeholder.
        .filter((id) => (map.getImage(id)?.data.width ?? 0) > 1),
    ).join(" ");
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

  /**
   * Where a lane goes, which stays here because the stack has one owner.
   *
   * `layersAbove` knows the whole arrangement; the lane module knows nothing
   * about it and asks.
   */
  const under = (layerId: string) => {
    const map = mapRef.current;
    return map ? firstExisting(map, layersAbove(layerId)) : undefined;
  };

  const syncSatellite = () => {
    const map = mapRef.current;
    if (!map || !styleReadyRef.current) return;
    // Satellite sits under everything, radar included.
    const { drawn, changed } = syncSatelliteLane(
      map,
      SATELLITE_LAYER_ID,
      drawnSatelliteRef.current,
      satelliteProductRef.current,
      satelliteTimeRef.current,
      under,
    );
    drawnSatelliteRef.current = drawn;
    if (changed) publishLayers();
  };

  const syncSurge = () => {
    const map = mapRef.current;
    if (!map || !styleReadyRef.current) return;
    if (syncRasterLane(map, SURGE_LANE, surgeCategoryRef.current, under)) {
      publishLayers();
    }
  };

  const drawRadarLane = (lane: RadarLane, frame: RadarFrame | undefined) => {
    const map = mapRef.current;
    if (!map) return;
    const { added, opacity, key } = syncRadarLane(
      map,
      {
        sourceId: `${RADAR_SOURCE_ID}-${lane}`,
        layerId: `${RADAR_LAYER_ID}-${lane}`,
      },
      frame
        ? {
            tileUrl: frame.tileUrl,
            tileSize: frame.tileSize,
            maxZoom: frame.maxZoom,
            attribution: frame.attribution,
            key: `${frame.providerId}:${frame.tileSize}:${frame.maxZoom}`,
          }
        : null,
      // A single site's own sweep takes the map from the mosaic without
      // taking the mosaic off it.
      radarVisibleRef.current && !sweepRef.current
        ? radarOpacityRef.current
        : 0,
      radarSourceKeysRef.current[lane],
      under,
    );
    radarSourceKeysRef.current[lane] = key;
    if (added) publishLayers();
    if (lane === "observed" && containerRef.current) {
      // What the mosaic is actually contributing, which is zero while a
      // single site has the map.
      containerRef.current.dataset.mosaicOpacity = opacity.toFixed(2);
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
    drawRadarLane(lane, frame);
    drawRadarLane(lane === "observed" ? "forecast" : "observed", undefined);
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
      // Before the layers, because a symbol layer naming an icon the map does
      // not hold draws a transparent pixel and reports nothing.
      for (const image of adapter.images?.() ?? []) {
        if (map.hasImage(image.id)) continue;
        map.addImage(image.id, image, { pixelRatio: 2 });
      }
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
  const baseOpacityRef = useRef(new Map<string, Array<[string, unknown]>>());

  const rememberBaseOpacity = (layer: maplibregl.LayerSpecification) => {
    const held = baseOpacity(layer);
    if (held.length) baseOpacityRef.current.set(layer.id, held);
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
        for (const [property, base] of held) {
          map.setPaintProperty(
            layer.id,
            property as "fill-opacity",
            factor >= 1
              ? (base as never)
              : (["*", base, factor] as unknown as never),
          );
        }
      }
    }
  };

  /** One popup, from a title and some lines. */
  const openPopup = (
    map: maplibregl.Map,
    at: maplibregl.LngLat,
    description: {
      title: string;
      lines: string[];
      url?: string;
      action?: { id: string; label: string };
    },
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
    const safeUrl = safePopupUrl(description.url);
    if (safeUrl) {
      const link = document.createElement("a");
      link.href = safeUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = translate("popup.openProduct");
      node.append(link);
    }
    const popup = new maplibregl.Popup({
      closeButton: true,
      maxWidth: "260px",
    })
      .setLngLat(at)
      .setDOMContent(node)
      .addTo(map);
    // The layer that explains what this popup is about. It closes with the
    // click, because the reader asked to look at something else.
    if (description.action) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "map-popup__action";
      button.textContent = description.action.label;
      button.dataset.popupAction = description.action.id;
      button.addEventListener("click", () => {
        onOverlayActionRef.current?.(description.action?.id ?? "");
        popup.remove();
      });
      node.append(button);
    }
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
    const content = popupFrom(hits, layerStackOrder(overlayLayerOrder()));
    if (!content) return;
    openPopup(map, event.lngLat, content);
  };

  const ROUTE_LANE: VectorLane = {
    sourceId: ROUTE_SOURCE_ID,
    layers: () => [
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
    ],
  };

  const syncRoute = () => {
    const map = mapRef.current;
    if (!map || !styleReadyRef.current) return;
    if (syncVectorLane(map, ROUTE_LANE, routeRef.current, under)) {
      publishLayers();
    }
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
  const PROBSEVERE_LANE: VectorLane = {
    sourceId: PROBSEVERE_SOURCE_ID,
    layers: () => [
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
    ],
  };

  const syncProbSevere = () => {
    const map = mapRef.current;
    if (!map || !styleReadyRef.current) return;
    if (syncVectorLane(map, PROBSEVERE_LANE, probSevereRef.current, under)) {
      publishLayers();
    }
  };

  /**
   * The storm cells: where each is, where it has been, where it is going.
   *
   * Four layers over one source, because a track, a forecast position, the
   * storm itself and its name are four different things and MapLibre draws
   * one kind of geometry per layer.
   */
  const CLASSIFICATION_LANE: VectorLane = {
    sourceId: CLASSIFICATION_SOURCE_ID,
    // Read on every rebuild, because the colours arrive with the data: a
    // table copied to this side of the boundary drifts, and then the legend
    // and the map disagree about what a colour means.
    layers: () => {
      const fill = classificationPaint(classificationRef.current?.legend ?? []);
      return [
        {
          id: CLASSIFICATION_FILL_LAYER_ID,
          type: "fill",
          source: CLASSIFICATION_SOURCE_ID,
          paint: {
            "fill-color": fill,
            // Light enough to read the sweep through, because this is the
            // algorithm's reading of that sweep rather than a replacement
            // for it.
            "fill-opacity": 0.55,
          },
        },
        {
          id: CLASSIFICATION_LINE_LAYER_ID,
          type: "line",
          source: CLASSIFICATION_SOURCE_ID,
          paint: {
            "line-color": fill,
            "line-width": 0.4,
            "line-opacity": 0.5,
          },
        },
      ];
    },
  };

  const syncClassification = () => {
    const map = mapRef.current;
    if (!map || !styleReadyRef.current) return;
    if (
      syncVectorLane(
        map,
        CLASSIFICATION_LANE,
        classificationRef.current?.features ?? null,
        under,
      )
    ) {
      publishLayers();
    }
  };

  const CELL_LANE: VectorLane = {
    sourceId: CELL_SOURCE_ID,
    // Read on every rebuild rather than captured: the cells are drawn in one
    // colour with a second for rotation, so under more contrast the only
    // thing left to give them is weight, and the band is dropped and rebuilt
    // to apply it. The ordering between an ordinary storm and a rotating one
    // is kept: both move.
    layers: () => {
      const heavier = highContrastRef.current ? 1.6 : 1;
      return [
        {
          id: CELL_TRACK_LAYER_ID,
          type: "line",
          source: CELL_SOURCE_ID,
          filter: ["==", ["get", "kind"], "track"],
          paint: {
            "line-color": "#f8fafc",
            "line-width": 1.5 * heavier,
            "line-opacity": 0.75,
            // Dashed, so a track is never taken for a road or a boundary.
            "line-dasharray": [2, 2],
          },
        },
        {
          id: CELL_FORECAST_LAYER_ID,
          type: "circle",
          source: CELL_SOURCE_ID,
          filter: ["==", ["get", "kind"], "forecast"],
          paint: {
            // Fainter the further ahead it is, because it is less certain.
            "circle-radius": 3 * heavier,
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
              3 * heavier,
              ["get", "rotating"],
              3 * heavier,
              2 * heavier,
            ],
          },
        },
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
            "text-halo-width": 1.5 * heavier,
          },
        },
      ];
    },
  };

  const syncCells = () => {
    const map = mapRef.current;
    if (!map || !styleReadyRef.current) return;
    if (syncVectorLane(map, CELL_LANE, cellsRef.current, under)) {
      publishLayers();
    }
  };

  const FLASH_LANE: VectorLane = {
    sourceId: FLASH_SOURCE_ID,
    layers: () => [
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
    ],
  };

  const syncFlashes = () => {
    const map = mapRef.current;
    if (!map || !styleReadyRef.current) return;
    const changed = syncVectorLane(map, FLASH_LANE, flashesRef.current, under);
    // The fade is a paint property rather than data, so it is set after every
    // refill and not only when the layer arrives.
    if (flashesRef.current) fadeFlashes();
    if (changed) publishLayers();
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

  /**
   * One grid, addressed by its own source id.
   *
   * Replaced rather than re-pointed when the address changes: an MRMS grid is
   * a different field every time, and re-pointing leaves the old one on
   * screen until every tile of the new one has arrived, which reads as the
   * weather changing in patches.
   */
  const mrmsLane = (id: string): RasterLane<string> => ({
    sourceId: id,
    layerId: id,
    attribution:
      '<a href="https://www.nssl.noaa.gov/projects/mrms/">NOAA MRMS</a>',
    opacity: 0.85,
    // No fade at all. These carry discrete ramps, and a cross-fade between
    // two tiles blends two colours into a value that is in neither grid.
    fadeMs: 0,
    maxZoom: 10,
    replaceOnChange: true,
    tileUrl: (url) => url,
  });

  const syncMrmsLayers = () => {
    const map = mapRef.current;
    if (!map || !styleReadyRef.current) return;
    const wanted = new Map(
      mrmsLayersRef.current.map((layer) => [
        `${MRMS_SOURCE_PREFIX}${layer.product}`,
        layer,
      ]),
    );
    let changed = false;
    for (const id of MRMS_LAYER_IDS) {
      changed =
        syncRasterLane(map, mrmsLane(id), wanted.get(id)?.tileUrl, under) ||
        changed;
    }
    if (changed) publishLayers();
  };

  const SWEEP_LANE: ImageLane = {
    sourceId: SWEEP_SOURCE_ID,
    layerId: SWEEP_LAYER_ID,
    paint: {
      // The sweep is already drawn at the resolution it was decoded at, and
      // smoothing it turns gates into mush.
      "raster-resampling": "nearest",
      "raster-fade-duration": 0,
    },
  };

  const syncSweep = () => {
    const map = mapRef.current;
    if (!map || !styleReadyRef.current) return;
    const next = sweepRef.current;
    const changed = syncImageLane(
      map,
      SWEEP_LANE,
      next && radarVisibleRef.current
        ? {
            url: next.image,
            coordinates: sweepCorners(next),
            opacity: radarOpacityRef.current,
          }
        : null,
      under,
    );
    if (changed) publishLayers();
  };

  const FORECAST_SMOKE_LANE: ImageLane = {
    sourceId: FORECAST_SMOKE_SOURCE_ID,
    layerId: FORECAST_SMOKE_LAYER_ID,
    paint: {
      // A model field at three kilometres, smoothed rather than blocky:
      // unlike a sweep, nothing in it is a gate a reader would count.
      "raster-resampling": "linear",
      "raster-fade-duration": 0,
    },
  };

  const syncForecastSmoke = () => {
    const map = mapRef.current;
    if (!map || !styleReadyRef.current) return;
    if (
      syncImageLane(map, FORECAST_SMOKE_LANE, forecastSmokeRef.current, under)
    ) {
      publishLayers();
    }
  };

  const TRACK_LANE: VectorLane = {
    sourceId: TRACK_SOURCE_ID,
    layers: () => [
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
      {
        id: TRACK_POINT_LAYER_ID,
        type: "circle",
        source: TRACK_SOURCE_ID,
        filter: ["==", ["geometry-type"], "Point"],
        // Each six-hourly fix is coloured by the wind it carried.
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 3.5, 8, 7],
          "circle-color": ["coalesce", ["get", "color"], "#94a3b8"],
          "circle-stroke-color": "#0f172a",
          "circle-stroke-width": 1,
        },
      },
    ],
  };

  const syncStormTrack = () => {
    const map = mapRef.current;
    if (!map || !styleReadyRef.current) return;
    if (syncVectorLane(map, TRACK_LANE, stormTrackRef.current, under)) {
      publishLayers();
    }
  };

  const CUSTOM_LANE: VectorLane = {
    sourceId: CUSTOM_SOURCE_ID,
    layers: () => [
      {
        id: CUSTOM_FILL_LAYER_ID,
        type: "fill",
        source: CUSTOM_SOURCE_ID,
        filter: ["==", ["geometry-type"], "Polygon"],
        // A placefile carries its own colours; plain GeoJSON does not.
        paint: {
          "fill-color": ["coalesce", ["get", "color"], "#60a5fa"],
          // A file's own opacity rides on its features, since one set of
          // layers draws every imported file. Absent means full.
          "fill-opacity": ["*", 0.18, ["coalesce", ["get", "fileOpacity"], 1]],
        },
      },
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
          "line-opacity": ["coalesce", ["get", "fileOpacity"], 1],
        },
      },
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
          "circle-opacity": ["coalesce", ["get", "fileOpacity"], 1],
          "circle-stroke-opacity": ["coalesce", ["get", "fileOpacity"], 1],
        },
      },
    ],
  };

  const syncCustomOverlay = () => {
    const map = mapRef.current;
    if (!map || !styleReadyRef.current) return;
    if (syncVectorLane(map, CUSTOM_LANE, customOverlayRef.current, under)) {
      publishLayers();
    }
  };

  /**
   * One layer, one value, one redraw.
   *
   * Each of these was an effect written out by hand with a suppression on it,
   * because the sync it calls is a fresh closure every render. `useMapSync`
   * holds that closure in a ref of its own, so the dependency is honestly the
   * value alone and none of these needs the rule switched off.
   */
  useMapSync(satelliteTime, (next) => {
    satelliteTimeRef.current = next;
    syncSatellite();
  });
  useEffect(() => {
    onOverlayActionRef.current = onOverlayAction;
  }, [onOverlayAction]);
  useMapSync(satelliteProductId, (next) => {
    satelliteProductRef.current = next;
    syncSatellite();
  });
  useMapSync(surgeCategory, (next) => {
    surgeCategoryRef.current = next;
    syncSurge();
  });
  useMapSync(overlays, (next) => {
    overlaysRef.current = next;
    syncOverlays();
  });
  useMapSync(route, (next) => {
    routeRef.current = next;
    syncRoute();
  });
  useMapSync(customOverlay, (next) => {
    customOverlayRef.current = next;
    syncCustomOverlay();
  });
  useMapSync(wind, (next) => {
    windRef.current = next;
    syncWind();
  });
  useMapSync(probSevere, (next) => {
    probSevereRef.current = next;
    syncProbSevere();
  });
  useMapSync(cells, (next) => {
    cellsRef.current = next;
    syncCells();
  });
  useMapSync(classification, (next) => {
    classificationRef.current = next;
    syncClassification();
  });
  useMapSync(forecastSmoke, (next) => {
    forecastSmokeRef.current = next;
    syncForecastSmoke();
  });
  useMapSync(flashes, (next) => {
    flashesRef.current = next;
    syncFlashes();
  });
  useMapSync(mrmsLayers, (next) => {
    mrmsLayersRef.current = next;
    syncMrmsLayers();
  });
  useMapSync(stormTrack, (next) => {
    stormTrackRef.current = next;
    syncStormTrack();
  });

  useImperativeHandle(ref, () => ({
    // The zoom and compass buttons are the reader moving the map as much as
    // a drag is. They go through `easeTo` with no browser event, so the map
    // cannot tell them from a camera the app moved, and they are stamped
    // here instead.
    zoomIn: () => {
      interactedAtRef.current = Date.now();
      mapRef.current?.easeTo({
        zoom: Math.min(15, (mapRef.current?.getZoom() ?? 4) + 1),
      });
    },
    zoomOut: () => {
      interactedAtRef.current = Date.now();
      mapRef.current?.easeTo({
        zoom: Math.max(2.5, (mapRef.current?.getZoom() ?? 4) - 1),
      });
    },
    resetNorth: () => {
      interactedAtRef.current = Date.now();
      mapRef.current?.easeTo({ bearing: 0, pitch: 0, duration: 450 });
    },
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
    interactedAt: () => interactedAtRef.current,
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
        {
          padding: 80,
          maxZoom: 9,
          ...cameraMotion(900),
        },
      );
    },
    flyTo: (nextCamera) => {
      mapRef.current?.flyTo({
        center: nextCamera.center,
        zoom: nextCamera.zoom,
        bearing: nextCamera.bearing,
        pitch: nextCamera.pitch,
        ...cameraMotion(850),
      });
    },
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
      style: mapStyleDefinition(mapStyle, incidentPack),
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
      syncClassification();
      syncForecastSmoke();
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
    // A move the reader made rather than one the app made. MapLibre carries
    // the browser event that caused a gesture and carries none for a camera
    // it moved itself, which is the whole of the difference.
    //
    // `movestart` rather than the four gesture events: a keyboard pan goes
    // through `easeTo` with the original key event attached and fires none of
    // dragstart, zoomstart, rotatestart or pitchstart, so listening for those
    // left somebody panning with the arrow keys open to having the camera
    // taken off them.
    map.on("movestart", (event) => {
      if ("originalEvent" in event && event.originalEvent) {
        interactedAtRef.current = Date.now();
      }
    });
    map.on("mousemove", (event) =>
      onCursorChange?.({ lon: event.lngLat.lng, lat: event.lngLat.lat }),
    );
    map.on("mouseout", () => onCursorChange?.(null));
    const canvas = map.getCanvas();
    const onCanvasKeyDown = (event: KeyboardEvent) => {
      if (
        !toolModeRef.current ||
        (event.key !== "Enter" && event.key !== " ")
      ) {
        return;
      }
      event.preventDefault();
      const bounds = canvas.getBoundingClientRect();
      canvas.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          clientX: bounds.left + bounds.width / 2,
          clientY: bounds.top + bounds.height / 2,
        }),
      );
    };
    canvas.addEventListener("keydown", onCanvasKeyDown);
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
          if (rangeKm <= drawn.rangeKm) {
            beam = {
              feet: beamHeightFeet(rangeKm, drawn.elevationDegrees),
              tilt: drawn.elevationDegrees,
            };
          }
        }
        // What the radar's own algorithm called the gate under the click,
        // when that layer is on. Read now rather than when the line is
        // written, because the map under the cursor moves on.
        let classified: string | null = null;
        if (map.getLayer(CLASSIFICATION_FILL_LAYER_ID)) {
          const [hit] = map.queryRenderedFeatures(event.point, {
            layers: [CLASSIFICATION_FILL_LAYER_ID],
          });
          const legend = classificationRef.current?.legend ?? [];
          classified =
            legend.find((entry) => entry.class === hit?.properties?.class)
              ?.id ?? null;
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
          if (classified) {
            lines.push(
              translate("tool.classified", {
                class: translate(`hydrometeor.${classified}` as StringKey),
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
      } else if (toolModeRef.current === "section") {
        // The same two points a range measurement takes, and drawn the same
        // way, because it is the same line: one of them answers how far, the
        // other answers what the storm looks like from the side.
        if (!rangeStartRef.current || rangeEndRef.current) {
          rangeStartRef.current = point;
          rangeEndRef.current = null;
          onToolResult?.(() => translate("tool.sectionEndHint"));
        } else {
          const from = rangeStartRef.current;
          rangeEndRef.current = point;
          onToolResult?.(() => translate("tool.sectionTaken"));
          onSection?.(from, point);
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
      canvas.removeEventListener("keydown", onCanvasKeyDown);
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // The one suppression left in this file, and the only one that is about
    // the effect rather than about a closure. A map is built once and torn
    // down once: the camera, style and callbacks it is constructed with are
    // the opening state, and every later change reaches it through a
    // `useMapSync` below rather than by building a second map. Listing them
    // here would say the opposite.
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
    if (containerRef.current) {
      containerRef.current.dataset.incidentPack = incidentPack?.id ?? "";
    }
    const map = mapRef.current;
    if (!map || mapStyleRef.current === styleIdentity) return;
    mapStyleRef.current = styleIdentity;
    styleReadyRef.current = false;
    radarSourceKeysRef.current = { observed: null, forecast: null };
    map.setStyle(mapStyleDefinition(mapStyle, incidentPack));
  }, [incidentPack, mapStyle, styleIdentity]);

  // Four inputs draw one lane, so they arrive as one value rather than as
  // four dependencies with a suppression over them.
  const radarState = useMemo(
    () => ({ radarFrame, radarVisible, radarOpacity, sweep }),
    [radarFrame, radarVisible, radarOpacity, sweep],
  );
  useMapSync(radarState, (next) => {
    radarFrameRef.current = next.radarFrame;
    radarVisibleRef.current = next.radarVisible;
    radarOpacityRef.current = next.radarOpacity;
    sweepRef.current = next.sweep;
    if (containerRef.current) {
      containerRef.current.dataset.radarFrame = next.radarFrame
        ? String(next.radarFrame.time)
        : "";
    }
    syncRadar();
    syncSweep();
  });

  // A tick of the clock moves the fade and nothing else.
  const flashFade = useMemo(
    () => ({ flashClock, flashWindowMinutes }),
    [flashClock, flashWindowMinutes],
  );
  useMapSync(flashFade, (next) => {
    flashClockRef.current = next.flashClock;
    flashWindowRef.current = next.flashWindowMinutes;
    fadeFlashes();
  });

  useMapSync(overlayOrder, (next) => {
    // The stack is rebuilt from this, so it has to be in place before the
    // overlays are put back.
    overlayOrderChosen = next;
    const map = mapRef.current;
    if (!map || !styleReadyRef.current) return;
    // Taking them all off and adding them again is what puts them in the new
    // order: MapLibre places a layer relative to the ones already there.
    for (const adapter of OVERLAY_ADAPTERS) {
      const sourceId = `${OVERLAY_SOURCE_PREFIX}${adapter.id}`;
      if (!map.getSource(sourceId)) continue;
      for (const layer of adapter.layers(sourceId)) {
        if (map.getLayer(layer.id)) map.removeLayer(layer.id);
      }
      map.removeSource(sourceId);
    }
    syncOverlays();
  });

  useEffect(() => {
    overlayOpacityRef.current = overlayOpacity;
    applyOverlayOpacity();
  }, [overlayOpacity]);

  /**
   * A preference change has to reach layers that are already on the map.
   *
   * Widths are read once, when a source is first added, so the way to draw
   * them again is to drop them and let the sync put them back. The data is in
   * the refs, so nothing is fetched twice and there is no gap to see.
   */
  const preferences = useMemo(
    () => ({ highContrast, measurements }),
    [highContrast, measurements],
  );
  useMapSync(preferences, (next) => {
    highContrastRef.current = next.highContrast;
    const map = mapRef.current;
    if (!map || !styleReadyRef.current) return;
    for (const id of CELL_LAYER_IDS) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    if (map.getSource(CELL_SOURCE_ID)) map.removeSource(CELL_SOURCE_ID);
    for (const adapter of OVERLAY_ADAPTERS) {
      const sourceId = `${OVERLAY_SOURCE_PREFIX}${adapter.id}`;
      if (!map.getSource(sourceId)) continue;
      for (const layer of adapter.layers(sourceId)) {
        if (map.getLayer(layer.id)) map.removeLayer(layer.id);
      }
      map.removeSource(sourceId);
    }
    syncCells();
    syncOverlays();
  });

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
            : toolMode === "section"
              ? "tool.sectionStartHint"
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
