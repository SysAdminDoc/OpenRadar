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
import { translate, useT, type StringKey } from "../i18n";

/** Past this the loop is old enough that the timeline should say so. */
const STALE_MINUTES = 20;

/** How old a grid is, so a layer that has stopped updating cannot pass for live. */
function gridAge(time: number, nowMs: number): string {
  const minutes = Math.max(0, Math.floor(nowMs / 60_000 - time / 60));
  if (minutes < 1) return translate("chrome.justIn");
  return translate("chrome.minutesOld", { count: minutes });
}

const TOOL_LABELS: Record<Exclude<ToolMode, null>, StringKey> = {
  draw: "tool.draw",
  range: "tool.range",
  inspect: "tool.inspect",
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
  const t = useT();
  const stale =
    radarAgeMinutes !== null && radarAgeMinutes >= STALE_MINUTES
      ? t("chrome.stale", { count: radarAgeMinutes })
      : null;
  // Frames that are on screen because the network is gone, not because they
  // just arrived. Saying which is the difference between a map you can trust
  // and one that quietly lies about the weather.
  const cached = timeline.cached
    ? radarAgeMinutes === null
      ? t("chrome.cached")
      : t("chrome.cachedAge", { count: radarAgeMinutes })
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
            <strong>{t(TOOL_LABELS[activeTool])}</strong>
            {toolResult}
          </span>
          <button type="button" onClick={onClearTools}>
            <Trash2 size={15} /> {t("chrome.toolClear")}
          </button>
        </div>
      ) : null}

      <RadarLegend
        open={productOpen}
        radarEnabled={settings.radar.enabled}
        productLabel={
          sweep
            ? t("chrome.sweepProduct", {
                station: sweep.station,
                product: sweep.product,
              })
            : rainRate
              ? t("chrome.rainRate")
              : t("chrome.composite")
        }
        eyebrow={
          sweep
            ? t(sweep.dealiased ? "chrome.tiltDealiased" : "chrome.tilt", {
                degrees: sweep.elevationDegrees.toFixed(2),
              })
            : t("chrome.liveProduct")
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
        <div className="product-legends" aria-label={t("chrome.extraScales")}>
          {windReduced ? (
            <div className="product-legend">
              <strong>{t("chrome.wind")}</strong>
              <small>{t("chrome.windReduced")}</small>
            </div>
          ) : null}
          {wind ? (
            <div className="product-legend" data-wind-run={wind.init}>
              <strong>
                {t("chrome.windAt10")}
                <em>{windLabel(wind, clock)}</em>
              </strong>
              <small>{t("chrome.windNote")}</small>
            </div>
          ) : null}
          {lightning ? (
            <div className="product-legend product-legend--flashes">
              <strong>
                {t("chrome.flashes")}
                <em>{gridAge(lightning.observed, clock)}</em>
              </strong>
              <ol>
                <li>
                  <i style={{ background: "#fef9c3" }} aria-hidden="true" />
                  {t("chrome.now")}
                </li>
                <li>
                  <i style={{ background: "#f59e0b" }} aria-hidden="true" />
                  {t("chrome.windowMinutes", {
                    count: lightning.windowMinutes,
                  })}
                </li>
                <li>
                  {t("chrome.flashCount", {
                    count: lightning.flashes.length.toLocaleString(),
                    more: lightning.trimmed ? "+" : "",
                    satellite: lightning.satellite,
                  })}
                  {lightning.filesRead < lightning.filesExpected
                    ? t("chrome.filesRead", {
                        read: lightning.filesRead,
                        expected: lightning.filesExpected,
                      })
                    : ""}
                </li>
              </ol>
              <small>{t("chrome.flashNote")}</small>
            </div>
          ) : null}
          {mrmsLayers.map((layer) => (
            <div key={layer.product} className="product-legend">
              <strong>
                {layer.unit
                  ? t("chrome.layerUnit", {
                      label: layer.label,
                      unit: layer.unit,
                    })
                  : layer.label}
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
                <small>{t("chrome.densityNote")}</small>
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
