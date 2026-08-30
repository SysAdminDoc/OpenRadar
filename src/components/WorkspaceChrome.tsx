import { CloudRain, Trash2 } from "lucide-react";
import { CommandBar, type SurfaceId, type ToolMode } from "./CommandBar";
import { RadarLegend, RadarTimeline, ZoomControls } from "./MapChrome";
import { ToastHost, type ToastMessage } from "./ToastHost";
import type { GeoPoint } from "../lib/geo";
import type { MrmsLayer } from "../hooks/useMrmsOverlays";
import type { SweepImage } from "../lib/level2";
import type { RadarFrame } from "../lib/radar";
import type { AppSettings } from "../lib/settings";
import type { RadarTimelineState } from "../hooks/useRadarTimeline";

/** Past this the loop is old enough that the timeline should say so. */
const STALE_MINUTES = 20;

/** How old a grid is, so a layer that has stopped updating cannot pass for live. */
function gridAge(time: number, nowMs: number): string {
  const minutes = Math.max(0, Math.floor(nowMs / 60_000 - time / 60));
  if (minutes < 1) return "just in";
  return `${minutes} min old`;
}

const TOOL_LABELS: Record<Exclude<ToolMode, null>, string> = {
  draw: "Draw",
  range: "Range",
  inspect: "Inspector",
};

interface WorkspaceChromeProps {
  settings: AppSettings;
  timeline: RadarTimelineState;
  frames: RadarFrame[];
  /** The single-site sweep on the map, which the legend names. */
  sweep: SweepImage | null;
  /** MRMS products drawn over the radar, each with its own scale. */
  mrmsLayers: MrmsLayer[];
  /** Milliseconds, ticking once a minute, for the freshness readouts. */
  clock: number;
  radarAgeMinutes: number | null;
  cursor: GeoPoint | null;
  activeTool: ToolMode;
  toolResult: string | null;
  activeSurface: SurfaceId;
  productOpen: boolean;
  dualPane: boolean;
  toasts: ToastMessage[];
  onClearTools: () => void;
  onToggleProduct: () => void;
  onSurface: (surface: SurfaceId) => void;
  onTool: (tool: ToolMode) => void;
  onLocate: () => void;
  onDualPane: () => void;
  onProjection: () => void;
  onPreset: (index: number) => void;
  onShare: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetNorth: () => void;
  onDismissToast: (id: number) => void;
}

/** Everything drawn over the map: the timeline, the controls, and the credits. */
export function WorkspaceChrome({
  settings,
  timeline,
  frames,
  sweep,
  mrmsLayers,
  clock,
  radarAgeMinutes,
  cursor,
  activeTool,
  toolResult,
  activeSurface,
  productOpen,
  dualPane,
  toasts,
  onClearTools,
  onToggleProduct,
  onSurface,
  onTool,
  onLocate,
  onDualPane,
  onProjection,
  onPreset,
  onShare,
  onZoomIn,
  onZoomOut,
  onResetNorth,
  onDismissToast,
}: WorkspaceChromeProps) {
  const stale =
    radarAgeMinutes !== null && radarAgeMinutes >= STALE_MINUTES
      ? `Radar is stale · ${radarAgeMinutes} min old`
      : null;

  return (
    <>
      {cursor ? (
        <div className="map-readout" aria-live="off">
          {`${cursor.lat.toFixed(3)}°, ${cursor.lon.toFixed(3)}°`}
        </div>
      ) : null}

      {activeTool ? (
        <div className="tool-hud">
          <span>
            <strong>{TOOL_LABELS[activeTool]}</strong>
            {toolResult}
          </span>
          <button type="button" onClick={onClearTools}>
            <Trash2 size={15} /> Clear
          </button>
        </div>
      ) : null}

      <RadarLegend
        open={productOpen}
        radarEnabled={settings.radar.enabled}
        productLabel={
          sweep ? `${sweep.station} ${sweep.product}` : "Composite Radar"
        }
        eyebrow={
          sweep ? `${sweep.elevationDegrees.toFixed(2)}° TILT` : "LIVE PRODUCT"
        }
        scale={
          sweep
            ? sweep.unit === "dBZ"
              ? "reflectivity"
              : sweep.unit === "m/s" && sweep.product === "Velocity"
                ? "velocity"
                : "none"
            : "reflectivity"
        }
        onToggle={onToggleProduct}
      />
      {mrmsLayers.length ? (
        <div className="product-legends" aria-label="Extra product scales">
          {mrmsLayers.map((layer) => (
            <div key={layer.product} className="product-legend">
              <strong>
                {layer.label}
                {layer.unit ? ` (${layer.unit})` : ""}
                <em>{gridAge(layer.time, clock)}</em>
              </strong>
              <ol>
                {layer.stops.map(([value, color]) => (
                  <li key={value}>
                    <i style={{ background: color }} aria-hidden="true" />
                    {value}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      ) : null}
      <RadarTimeline
        frames={frames}
        frameIndex={timeline.frameIndex}
        playing={timeline.playing}
        sourceLabel={timeline.sourceLabel}
        ageMinutes={radarAgeMinutes}
        error={timeline.error ?? stale}
        onFrameIndex={timeline.selectFrame}
        onPlaying={timeline.setPlaying}
      />
      <ZoomControls
        bearing={settings.camera.bearing}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onResetNorth={onResetNorth}
      />
      <CommandBar
        activeSurface={activeSurface}
        activeTool={activeTool}
        dualPane={dualPane}
        projection={settings.projection}
        presets={settings.presets.map(Boolean)}
        onSurface={onSurface}
        onTool={onTool}
        onLocate={onLocate}
        onDualPane={onDualPane}
        onProjection={onProjection}
        onPreset={onPreset}
        onShare={onShare}
      />
      <ToastHost messages={toasts} onDismiss={onDismissToast} />

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
        {timeline.attribution ? (
          <a href={timeline.attribution.url} target="_blank" rel="noreferrer">
            {timeline.attribution.label}
          </a>
        ) : null}
      </div>
      <div className="map-watermark" aria-hidden="true">
        <CloudRain size={18} />
      </div>
    </>
  );
}
