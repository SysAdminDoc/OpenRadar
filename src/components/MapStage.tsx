import type { RefObject } from "react";
import { MapViewport, type MapViewportHandle } from "./MapViewport";
import type { ToolMode } from "./CommandBar";
import type { GeoPoint } from "../lib/geo";
import type { MrmsLayer } from "../hooks/useMrmsOverlays";
import type { SweepImage } from "../lib/level2";
import type { WindField } from "../lib/wind";
import type { OverlayData, OverlayId } from "../lib/overlays";
import { formatFrameTime, type RadarFrame } from "../lib/radar";
import type { AppSettings, CameraState } from "../lib/settings";
import { useT } from "../i18n";
import { resolvedMapStyle } from "../lib/mapStyles";
import { formatClock, useMeasurements } from "../lib/units";

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
  onMapStatus: (status: "loading" | "ready" | "error") => void;
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
  onMapStatus,
}: MapStageProps) {
  const t = useT();
  // Redraws when the units or the clock change, since this is on screen the
  // whole time and would otherwise keep showing the old ones.
  useMeasurements();
  const shared = {
    projection: settings.projection,
    // Auto is resolved here rather than in the viewport, so everything that
    // reads the drawn style, the compare pane included, agrees on one answer.
    mapStyle: resolvedMapStyle(settings.mapStyle, settings.theme),
    radarVisible: settings.radar.enabled,
    radarOpacity: settings.radar.opacity,
    overlays,
    route,
    customOverlay: settings.layers.customOverlay ? customOverlay : null,
    stormTrack,
    sweep,
    mrmsLayers,
    flashes,
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
        onCameraChange={onCameraChange}
        onCameraMove={onPrimaryMove}
        onCursorChange={onCursorChange}
        onToolResult={onToolResult}
        onMapStatus={onMapStatus}
        {...shared}
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
          {...shared}
        />
      ) : null}

      {satelliteTime !== null ? (
        <div className="satellite-chip">
          <strong>GOES-East GeoColor</strong>
          <small>
            {formatClock(new Date(satelliteTime * 1000))}
            {satelliteAgeMinutes === null
              ? ""
              : t("stage.satelliteAge", { count: satelliteAgeMinutes })}
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
          <small>{formatFrameTime(compareFrame)}</small>
        </div>
      ) : null}
    </div>
  );
}
