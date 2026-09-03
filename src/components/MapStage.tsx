import { useMemo, type RefObject } from "react";
import { MapViewport, type MapViewportHandle } from "./MapViewport";
import type { ToolMode } from "./CommandBar";
import type { GeoPoint } from "../lib/geo";
import type { MrmsLayer } from "../hooks/useMrmsOverlays";
import type { SweepImage } from "../lib/level2";
import type { ClassStyle } from "../lib/classification";
import type { PinnedImage } from "../lib/mapLayers/image";
import { satelliteProduct } from "../lib/providers/satellite";
import type { WindField } from "../lib/wind";
import type { OverlayData, OverlayId } from "../lib/overlays";
import { formatFrameTime, type RadarFrame } from "../lib/radar";
import type { AppSettings, CameraState } from "../lib/settings";
import { useT } from "../i18n";
import { resolvedMapStyle } from "../lib/mapStyles";
import { formatAge, formatClock, useMeasurements } from "../lib/units";

/** How many frames back the compare pane can be held. */
const COMPARE_OFFSETS = [0, 3, 6, 12];

interface MapStageProps {
  settings: AppSettings;
  mapRef: RefObject<MapViewportHandle | null>;
  secondMapRef: RefObject<MapViewportHandle | null>;
  activeFrame: RadarFrame | undefined;
  compareFrame: RadarFrame | undefined;
  satelliteTime: number | null;
  compareSatelliteTime: number | null;
  /** Minutes between the satellite image and now, for its readout. */
  satelliteAgeMinutes: number | null;
  overlays: Partial<Record<OverlayId, OverlayData | null>>;
  route: Record<string, unknown> | null;
  customOverlay: Record<string, unknown> | null;
  stormTrack: Record<string, unknown> | null;
  /** One site's own sweep, drawn in place of the mosaic when it is set. */
  sweep: SweepImage | null;
  mrmsLayers: MrmsLayer[];
  flashes: Record<string, unknown> | null;
  /** Storm cells with their tracks, from the radar's own algorithm. */
  cells: Record<string, unknown> | null;
  /** What the same algorithm says is falling, with its own legend. */
  classification: {
    features: Record<string, unknown>;
    legend: ClassStyle[];
  } | null;
  /** The model's smoke for the primary pane's frame, or null off the tail. */
  forecastSmoke: PinnedImage | null;
  /** What the severe-probability model expects of each storm. */
  probSevere: Record<string, unknown> | null;
  /** How solid each overlay is drawn, as a fraction of its own design. */
  overlayOpacity: Record<string, number>;
  /** The order the overlays are drawn in, bottom first. */
  overlayOrder: string[];
  /** The flash window and the moment the fade is measured against. */
  flashWindowMinutes: number;
  flashClock: number;
  wind: WindField | null;
  activeTool: ToolMode;
  dualPane: boolean;
  compareOffset: number;
  onCompareOffset: (offset: number) => void;
  onCameraChange: (camera: CameraState) => void;
  onPrimaryMove: (camera: CameraState) => void;
  onSecondaryMove: (camera: CameraState) => void;
  onCursorChange: (point: GeoPoint | null) => void;
  onToolResult: (render: (() => string) | null) => void;
  /** The two ends of a cross-section, once the tool has both. */
  onSection: (from: GeoPoint, to: GeoPoint) => void;
  /** The one action a popup offered about what it describes. */
  onOverlayAction: (id: string) => void;
  onMapStatus: (status: "loading" | "ready" | "error" | "nogpu") => void;
}

export function MapStage({
  settings,
  mapRef,
  secondMapRef,
  activeFrame,
  compareFrame,
  satelliteTime,
  compareSatelliteTime,
  satelliteAgeMinutes,
  overlays,
  route,
  customOverlay,
  stormTrack,
  sweep,
  mrmsLayers,
  flashes,
  cells,
  classification,
  forecastSmoke,
  probSevere,
  overlayOpacity,
  overlayOrder,
  flashWindowMinutes,
  flashClock,
  wind,
  activeTool,
  dualPane,
  compareOffset,
  onCompareOffset,
  onCameraChange,
  onPrimaryMove,
  onSecondaryMove,
  onCursorChange,
  onToolResult,
  onSection,
  onOverlayAction,
  onMapStatus,
}: MapStageProps) {
  const t = useT();
  // Redraws when the units or the clock change, since this is on screen the
  // whole time and would otherwise keep showing the old ones.
  useMeasurements();
  const incidentPack =
    settings.incidentPacks.references.find(
      (pack) => pack.id === settings.incidentPacks.selectedId,
    ) ?? null;
  // While the model's smoke has the primary pane, the analysis comes off
  // it: not faded, off. A faded layer still answers clicks and still counts
  // as drawn, and a plume must be one kind of statement at a time. The
  // compare pane follows its own frame and keeps whatever it has.
  const primaryOverlays = useMemo(
    () => (forecastSmoke ? { ...overlays, smoke: null } : overlays),
    [forecastSmoke, overlays],
  );
  const chosenSatellite = satelliteProduct(settings.satelliteProduct);
  const shared = {
    projection: settings.projection,
    satelliteProductId: settings.satelliteProduct,
    // Auto is resolved here rather than in the viewport, so everything that
    // reads the drawn style, the compare pane included, agrees on one answer.
    mapStyle: resolvedMapStyle(settings.mapStyle, settings.theme),
    incidentPack,
    radarVisible: settings.radar.enabled,
    radarOpacity: settings.radar.opacity,
    overlays,
    route,
    counties: settings.layers.counties,
    customOverlay: settings.layers.customOverlay ? customOverlay : null,
    stormTrack,
    sweep,
    mrmsLayers,
    flashes,
    cells,
    classification,
    probSevere,
    overlayOpacity,
    overlayOrder,
    flashWindowMinutes,
    flashClock,
    wind,
    surgeCategory: settings.layers.surge ? settings.surgeCategory : null,
    toolMode: activeTool,
  };

  return (
    <div className="map-stage">
      <MapViewport
        ref={mapRef}
        camera={settings.camera}
        radarFrame={activeFrame}
        satelliteTime={satelliteTime}
        forecastSmoke={forecastSmoke}
        onCameraChange={onCameraChange}
        onCameraMove={onPrimaryMove}
        onCursorChange={onCursorChange}
        onToolResult={onToolResult}
        onSection={onSection}
        onOverlayAction={onOverlayAction}
        onMapStatus={onMapStatus}
        {...shared}
        overlays={primaryOverlays}
      />
      {dualPane ? (
        <MapViewport
          ref={secondMapRef}
          label={t("stage.secondary")}
          camera={settings.camera}
          radarFrame={compareFrame}
          satelliteTime={compareSatelliteTime}
          onCameraChange={onCameraChange}
          onCameraMove={onSecondaryMove}
          onToolResult={onToolResult}
          onSection={onSection}
          onOverlayAction={onOverlayAction}
          {...shared}
        />
      ) : null}

      {satelliteTime !== null ? (
        <div
          className="satellite-chip"
          data-satellite={settings.satelliteProduct}
        >
          <strong>
            {t("stage.satellite", { product: t(chosenSatellite.key) })}
          </strong>
          <small>
            {formatClock(new Date(satelliteTime * 1000))}
            {satelliteAgeMinutes === null
              ? ""
              : t("stage.satelliteAge", {
                  age: formatAge(satelliteAgeMinutes),
                })}
          </small>
          {/* GeoColor is a rendering and the infrared band is a measurement
              with a scale. A picture of cloud tops that does not say which it
              is invites somebody to read a temperature off a colour that has
              none. */}
          <small className="satellite-chip__legend">
            {t(chosenSatellite.legendKey)}
          </small>
        </div>
      ) : null}

      {dualPane ? (
        <div className="pane-compare">
          <strong>{t("stage.compare")}</strong>
          <div
            className="segmented-control"
            role="group"
            aria-label={t("stage.compareOffset")}
          >
            {COMPARE_OFFSETS.map((offset) => (
              <button
                type="button"
                key={offset}
                className={compareOffset === offset ? "is-active" : ""}
                aria-pressed={compareOffset === offset}
                onClick={() => onCompareOffset(offset)}
              >
                {offset === 0
                  ? t("stage.live")
                  : t("stage.back", { count: offset })}
              </button>
            ))}
          </div>
          <small>
            {compareFrame
              ? formatFrameTime(compareFrame)
              : t("stage.compareUnavailable")}
          </small>
        </div>
      ) : null}
    </div>
  );
}
