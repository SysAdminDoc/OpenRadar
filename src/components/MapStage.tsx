import type { RefObject } from "react";
import { MapViewport, type MapViewportHandle } from "./MapViewport";
import type { ToolMode } from "./CommandBar";
import type { GeoPoint } from "../lib/geo";
import type { SweepImage } from "../lib/level2";
import type { OverlayData, OverlayId } from "../lib/overlays";
import { formatFrameTime, type RadarFrame } from "../lib/radar";
import type { AppSettings, CameraState } from "../lib/settings";

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
  activeTool: ToolMode;
  dualPane: boolean;
  compareOffset: number;
  onCompareOffset: (offset: number) => void;
  onCameraChange: (camera: CameraState) => void;
  onPrimaryMove: (camera: CameraState) => void;
  onSecondaryMove: (camera: CameraState) => void;
  onCursorChange: (point: GeoPoint | null) => void;
  onToolResult: (message: string | null) => void;
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
  const shared = {
    projection: settings.projection,
    mapStyle: settings.mapStyle,
    radarVisible: settings.radar.enabled,
    radarOpacity: settings.radar.opacity,
    overlays,
    route,
    customOverlay: settings.layers.customOverlay ? customOverlay : null,
    stormTrack,
    sweep,
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
          label="Secondary interactive weather map"
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
            {new Intl.DateTimeFormat(undefined, {
              hour: "numeric",
              minute: "2-digit",
            }).format(new Date(satelliteTime * 1000))}
            {satelliteAgeMinutes === null
              ? ""
              : ` · ${satelliteAgeMinutes} min old`}
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
                onClick={() => onCompareOffset(offset)}
              >
                {offset === 0 ? "Live" : `${offset} back`}
              </button>
            ))}
          </div>
          <small>{formatFrameTime(compareFrame)}</small>
        </div>
      ) : null}
    </div>
  );
}
