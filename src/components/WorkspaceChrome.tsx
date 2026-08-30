import { CloudRain, Trash2 } from "lucide-react";
import { CommandBar, type SurfaceId, type ToolMode } from "./CommandBar";
import { RadarLegend, RadarTimeline, ZoomControls } from "./MapChrome";
import { ToastHost, type ToastMessage } from "./ToastHost";
import type { GeoPoint } from "../lib/geo";
import type { FlashWindow } from "../hooks/useLightning";
import { windLabel, type WindField } from "../lib/wind";
import { paletteLegend } from "../lib/legend";
import { paletteApplies } from "../lib/palette";
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
  /** The GOES flash window on the map, when that layer is on. */
  lightning: FlashWindow | null;
  /** The wind field the particles follow, when that layer is on. */
  wind: WindField | null;
  /** True when the wind layer is switched on but held back for reduced motion. */
  windReduced: boolean;
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
  lightning,
  wind,
  windReduced,
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
  // Frames that are on screen because the network is gone, not because they
  // just arrived. Saying which is the difference between a map you can trust
  // and one that quietly lies about the weather.
  const cached = timeline.cached
    ? radarAgeMinutes === null
      ? "Showing the last view"
      : `Showing the last view · ${radarAgeMinutes} min old`
    : null;
  // Canada's radar is a rain rate in millimetres an hour, not reflectivity in
  // dBZ. Showing a dBZ scale over it would be describing the wrong quantity.
  const rainRate = frames[timeline.frameIndex]?.providerId === "geomet";
  // A loaded colour table describes what is on screen only where it was
  // actually applied, which is the locally decoded products and no others.
  const drawnUnit = sweep?.unit ?? (rainRate ? "mm/h" : "dBZ");
  const paletteApplied = sweep
    ? sweep.paletteApplied
    : frames[timeline.frameIndex]?.providerId === "mrms";
  const paletteScale =
    settings.palette &&
    paletteApplied &&
    paletteApplies(settings.palette, drawnUnit)
      ? paletteLegend(settings.palette, drawnUnit)
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
          sweep
            ? `${sweep.station} ${sweep.product}`
            : rainRate
              ? "Rain Rate"
              : "Composite Radar"
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
            : rainRate
              ? "rain-rate"
              : "reflectivity"
        }
        paletteScale={paletteScale}
        onToggle={onToggleProduct}
      />
      {mrmsLayers.length || lightning || wind || windReduced ? (
        <div className="product-legends" aria-label="Extra product scales">
          {windReduced ? (
            <div className="product-legend">
              <strong>Wind</strong>
              <small>
                Held back because this device asks for less movement.
              </small>
            </div>
          ) : null}
          {wind ? (
            <div className="product-legend" data-wind-run={wind.init}>
              <strong>
                Wind at 10 m<em>{windLabel(wind, clock)}</em>
              </strong>
              <small>
                Model guidance, not an observation. Particles show direction and
                relative speed.
              </small>
            </div>
          ) : null}
          {lightning ? (
            <div className="product-legend product-legend--flashes">
              <strong>
                Lightning flashes
                <em>{gridAge(lightning.observed, clock)}</em>
              </strong>
              <ol>
                <li>
                  <i style={{ background: "#fef9c3" }} aria-hidden="true" />
                  now
                </li>
                <li>
                  <i style={{ background: "#f59e0b" }} aria-hidden="true" />
                  {lightning.windowMinutes} min
                </li>
                <li>
                  {lightning.flashes.length.toLocaleString()}
                  {lightning.trimmed ? "+" : ""} from {lightning.satellite}
                  {lightning.filesRead < lightning.filesExpected
                    ? ` · ${lightning.filesRead} of ${lightning.filesExpected} files`
                    : ""}
                </li>
              </ol>
              <small>
                Total lightning, not a strike report. Use official warnings for
                life-safety decisions.
              </small>
            </div>
          ) : null}
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
              {layer.product === "lightning" ? (
                <small>
                  Where flashes were, not where the next one will be. Use
                  official warnings for life-safety decisions.
                </small>
              ) : null}
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
        error={timeline.error ?? cached ?? stale}
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
