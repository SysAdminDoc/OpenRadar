import { CloudRain, Radar, Trash2 } from "lucide-react";
import { CommandBar, type SurfaceId, type ToolMode } from "./CommandBar";
import { RadarLegend, RadarTimeline, ZoomControls } from "./MapChrome";
import { ToastHost, type ToastMessage } from "./ToastHost";
import { LiveRegion } from "./LiveRegion";
import type { GeoPoint } from "../lib/geo";
import type { FlashWindow } from "../hooks/useLightning";
import { windLabel, type WindField } from "../lib/wind";
import { paletteLegend } from "../lib/legend";
import { mosaicLegend } from "../lib/mosaicLegend";
import { assignedPalette } from "../lib/palette";
import type { MrmsLayer } from "../hooks/useMrmsOverlays";
import type { OverlayData } from "../lib/overlays";
import { analysisDate, type SmokeDensity } from "../lib/overlays/smoke";
import {
  CLASSIFICATION_PRODUCT_KEYS,
  type Classification,
} from "../lib/classification";
import { liveAgeSeconds, type SweepImage } from "../lib/level2";
import {
  FORECAST_SMOKE_UNIT,
  forecastSmokeLabel,
  swatchOpacity,
  type SmokeField,
} from "../lib/forecastSmoke";
import { formatRadarTime } from "../lib/radar";
import type { RadarFrame } from "../lib/radar";
import type { AppSettings } from "../lib/settings";
import type { RadarTimelineState } from "../hooks/useRadarTimeline";
import {
  formatMeasure,
  formatNumber,
  locale,
  translate,
  useT,
  type StringKey,
} from "../i18n";
import { formatAge, useMeasurements } from "../lib/units";
import { useHighContrast } from "../hooks/useClock";

/** Past this the loop is old enough that the timeline should say so. */
const STALE_MINUTES = 20;

/**
 * The three boxes an analyst puts a plume in, and the colours the map paints
 * them. Written here beside the legend and read by nothing else, because the
 * map's own paint expression is the other half of the pair and the two have
 * to be looked at together to stay the same.
 */
const SMOKE_SCALE: Array<[SmokeDensity, string]> = [
  ["light", "#d97706"],
  ["medium", "#b45309"],
  ["heavy", "#78350f"],
];

/** How old a grid is, so a layer that has stopped updating cannot pass for live. */
function gridAge(time: number, nowMs: number): string {
  const minutes = Math.max(0, Math.floor(nowMs / 60_000 - time / 60));
  if (minutes < 1) return translate("chrome.justIn");
  return translate("chrome.age", { age: formatAge(minutes) });
}

const TOOL_LABELS: Record<Exclude<ToolMode, null>, StringKey> = {
  draw: "tool.draw",
  range: "tool.range",
  inspect: "tool.inspect",
  section: "tool.section",
};

interface WorkspaceChromeProps {
  settings: AppSettings;
  timeline: RadarTimelineState;
  frames: RadarFrame[];
  /** The single-site sweep on the map, which the legend names. */
  sweep: SweepImage | null;
  /**
   * Where that sweep sits in the site's loop, when the reader has scrubbed
   * off the newest volume. Null the rest of the time.
   */
  sweepLoop: { index: number; count: number } | null;
  /** MRMS products drawn over the radar, each with its own scale. */
  mrmsLayers: MrmsLayer[];
  /** The GOES flash window on the map, when that layer is on. */
  lightning: FlashWindow | null;
  /** The day's smoke analysis, when that layer is on, for its own scale. */
  smoke: OverlayData | null;
  /** What the held site's own algorithm says is falling, when that layer is on. */
  classification: Classification | null;
  /** The model's smoke for the hour on screen, when the playhead is on the tail. */
  forecastSmoke: SmokeField | null;
  /** The wind field the particles follow, when that layer is on. */
  wind: WindField | null;
  /** True when the wind layer is switched on but held back for reduced motion. */
  windReduced: boolean;
  /** Milliseconds, ticking once a minute, for the freshness readouts. */
  clock: number;
  /**
   * The same, ticking every second, for the legend over a live sweep.
   *
   * A piece of the volume in progress arrives every eleven or twelve seconds,
   * so an age read off the minute clock said nought for everything collected
   * since the last tick and then jumped a minute when the radar stalled.
   */
  liveClock: number;
  radarAgeMinutes: number | null;
  cursor: GeoPoint | null;
  activeTool: ToolMode;
  toolResult: (() => string) | null;
  activeSurface: SurfaceId;
  productOpen: boolean;
  dualPane: boolean;
  toasts: ToastMessage[];
  /** The last warning the watch announced, for the assertive live region. */
  announcement: { said: number; text: string };
  /** The nearby readout, when the reader has it open, for the polite one. */
  readout: string;
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
  sweepLoop,
  mrmsLayers,
  lightning,
  smoke,
  classification,
  forecastSmoke,
  wind,
  windReduced,
  clock,
  liveClock,
  radarAgeMinutes,
  cursor,
  activeTool,
  toolResult,
  activeSurface,
  productOpen,
  dualPane,
  toasts,
  announcement,
  readout,
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
  const historicalSweep =
    sweep && sweep.source.kind !== "recent" ? sweep : null;
  // Redraws when the units or the clock change, since this is on screen the
  // whole time and would otherwise keep showing the old ones.
  useMeasurements();
  const stale =
    radarAgeMinutes !== null && radarAgeMinutes >= STALE_MINUTES
      ? t("chrome.stale", { age: formatAge(radarAgeMinutes) })
      : null;
  // Frames that are on screen because the network is gone, not because they
  // just arrived. Saying which is the difference between a map you can trust
  // and one that quietly lies about the weather.
  const cached = timeline.cached
    ? radarAgeMinutes === null
      ? t("chrome.cached")
      : t("chrome.cachedAge", { age: formatAge(radarAgeMinutes) })
    : null;
  // Not every mosaic is reflectivity in dBZ, and not every reflectivity
  // mosaic is painted with the same ramp, so the source says which bar
  // describes it.
  const mosaic = mosaicLegend(frames[timeline.frameIndex]?.providerId);
  const productLabel = sweep
    ? t("chrome.sweepProduct", {
        station: sweep.station,
        product: sweep.product,
      })
    : t(mosaic.labelKey);
  const productEyebrow = sweep
    ? sweepEyebrow(sweep, liveClock, sweepLoop)
    : t("chrome.liveProduct");
  const sourceHealthy = historicalSweep
    ? true
    : Boolean(frames.length) && !timeline.error;
  const freshness = historicalSweep
    ? t("timeline.historical")
    : timeline.cached
      ? cached
      : timeline.error
        ? t("chrome.sourceIssue")
        : radarAgeMinutes === null
          ? t("chrome.connecting")
          : radarAgeMinutes < 1
            ? t("chrome.updatedNow")
            : t("chrome.updatedAge", { age: formatAge(radarAgeMinutes) });
  // A loaded colour table describes what is on screen only where it was
  // actually applied, which is the locally decoded products and no others.
  // Only when the layer is actually drawing something. An empty analysis is a
  // real answer and gets its own note beside the switch, not a legend for
  // three colours that are not on the map.
  // And not while the model's smoke has the map: the analysis is hidden then,
  // and a scale for a layer that is not drawn would say it was.
  const smokeScale =
    smoke?.features.length && !forecastSmoke
      ? { analysed: Number(smoke.features[0].properties.analysed) || null }
      : null;
  const drawnUnit = sweep?.unit ?? mosaic.unit;
  const paletteApplied = sweep
    ? sweep.paletteApplied
    : frames[timeline.frameIndex]?.providerId === "mrms";
  // Which of the reader's tables is in force for the unit on screen, rather
  // than "the table", so a velocity scale does not describe reflectivity.
  const drawnPalette = assignedPalette(
    settings.palettes,
    settings.paletteAssignments,
    drawnUnit,
  );
  const paletteScale =
    drawnPalette && paletteApplied
      ? paletteLegend(drawnPalette, drawnUnit)
      : null;
  // Which ramp the bar has to be drawn from. A sweep says how it was drawn,
  // because it was drawn when it was asked for and a reader who has just
  // turned contrast on is still looking at the picture they had. The mosaic
  // has no such record: its tiles are asked for again on the change, so the
  // preference as it stands now is the answer.
  const liveHighContrast = useHighContrast();
  const drawnHighContrast = sweep ? sweep.highContrast : liveHighContrast;

  return (
    <>
      <header className="top-status" aria-label={t("chrome.workspaceStatus")}>
        <div className="app-brand">
          <span className="brand-mark" aria-hidden="true">
            <Radar size={18} />
          </span>
          <span>
            <strong>OpenRadar</strong>
            <small>{t("chrome.workstation")}</small>
          </span>
        </div>
        <div className="top-status__center">
          <Radar size={16} aria-hidden="true" />
          <strong>{t("chrome.radarWorkspace")}</strong>
          <span className="top-status__divider" aria-hidden="true" />
          <span>{freshness}</span>
        </div>
        <div className="top-status__health">
          <span
            className={sourceHealthy ? "status-dot is-live" : "status-dot"}
            aria-hidden="true"
          />
          <span>
            {sourceHealthy
              ? t("chrome.sourceHealthy")
              : t("chrome.sourceWaiting")}
          </span>
          <span
            className={
              sourceHealthy && !historicalSweep
                ? "live-chip is-live"
                : "live-chip"
            }
          >
            {historicalSweep
              ? t("timeline.historical")
              : sourceHealthy
                ? t("timeline.live")
                : t("chrome.standby")}
          </span>
        </div>
      </header>

      {cursor ? (
        <div className="map-readout" aria-live="off">
          {`${formatNumber(cursor.lat, 3)}°, ${formatNumber(cursor.lon, 3)}°`}
        </div>
      ) : null}

      {/* Mounted whether or not a tool is chosen, and empty until one is.
          A live region announces a change to itself; one that arrives with
          its words already in it is often not read at all, so the first tool
          somebody picked went unannounced. `LiveRegion` says as much about
          every announcement in the app, and this was one of five places that
          did not follow it. Hidden from sight when empty rather than
          unmounted, because `hidden` would take it out of the tree the same
          way. */}
      <div
        className="tool-hud"
        role="status"
        aria-live="polite"
        data-empty={activeTool ? undefined : "1"}
      >
        {activeTool ? (
          <>
            <span>
              <strong>{t(TOOL_LABELS[activeTool])}</strong>
              {toolResult ? (
                <span className="tool-hud__result">{toolResult()}</span>
              ) : null}
              <small>{t("chrome.toolKeyboard")}</small>
            </span>
            <button type="button" onClick={onClearTools}>
              <Trash2 size={15} /> {t("chrome.toolClear")}
            </button>
          </>
        ) : null}
      </div>

      <RadarLegend
        open={productOpen}
        radarEnabled={settings.radar.enabled}
        productLabel={productLabel}
        eyebrow={productEyebrow}
        scale={
          sweep
            ? sweep.unit === "dBZ"
              ? "reflectivity"
              : sweep.unit === "m/s" && sweep.product === "Velocity"
                ? sweep.dealiased
                  ? "velocity-wide"
                  : "velocity"
                : "none"
            : mosaic.scale
        }
        paletteScale={paletteScale}
        highContrast={drawnHighContrast}
        onToggle={onToggleProduct}
      />
      {mrmsLayers.length ||
      lightning ||
      wind ||
      windReduced ||
      smokeScale ||
      classification ||
      forecastSmoke ? (
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
              <ol role="list">
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
                    count: lightning.flashes.length.toLocaleString(
                      locale(settings.language),
                    ),
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
          {smokeScale ? (
            <div className="product-legend" data-smoke-legend="1">
              <strong>
                {t("layer.smoke")}
                <em>
                  {smokeScale.analysed
                    ? t("chrome.smokeAnalysed", {
                        when: analysisDate(smokeScale.analysed),
                      })
                    : t("chrome.smokeAnalysedUnknown")}
                </em>
              </strong>
              {/* Three names rather than a gradient. Heavy is not three times
                  light; an analyst put each polygon in one of three boxes. */}
              <ol role="list" className="is-categorical">
                {SMOKE_SCALE.map(([density, color]) => (
                  <li key={density}>
                    <i style={{ background: color }} aria-hidden="true" />
                    {t(`smoke.${density}` as "smoke.light")}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
          {forecastSmoke ? (
            <div className="product-legend" data-forecast-smoke-legend="1">
              {/* The unit sits in the run line rather than the heading: the
                  heading is set in capitals, and a capital micro sign is a
                  Greek mu that reads as an M, which would make this
                  milligrams. */}
              <strong>
                {t("chrome.forecastSmoke")}
                <em>
                  {FORECAST_SMOKE_UNIT}
                  {" · "}
                  {forecastSmokeLabel(forecastSmoke, clock)}
                </em>
              </strong>
              {/* The scale the picture was painted with, sent with it, and
                  each swatch as solid as its step is on the map. */}
              <ol role="list">
                {forecastSmoke.ramp.map((stop) => (
                  <li key={stop.at}>
                    <i
                      style={{
                        background: stop.color,
                        opacity: swatchOpacity(stop),
                      }}
                      aria-hidden="true"
                    />
                    {stop.at}
                  </li>
                ))}
              </ol>
              <small>
                {t("chrome.forecastSmokeValid", {
                  time: formatRadarTime(Date.parse(forecastSmoke.valid) / 1000),
                })}{" "}
                {t("chrome.forecastSmokeNote")}
              </small>
            </div>
          ) : null}
          {classification ? (
            <div className="product-legend" data-classification-legend="1">
              <strong>
                {t("layer.classification")}
                <em>
                  {t(CLASSIFICATION_PRODUCT_KEYS[classification.product])}
                  {" · "}
                  {gridAge(Date.parse(classification.observed) / 1000, clock)}
                </em>
              </strong>
              {/* Every class the layer can draw, whether or not this volume
                  holds it: a legend that lists only what is on screen cannot
                  be read against what is not. */}
              <ol role="list" className="is-categorical">
                {classification.legend.map((style) => (
                  <li key={style.id}>
                    <i style={{ background: style.color }} aria-hidden="true" />
                    {t(`hydrometeor.${style.id}` as StringKey)}
                  </li>
                ))}
              </ol>
              <small>{t("chrome.classificationNote")}</small>
            </div>
          ) : null}
          {mrmsLayers.map((layer) => (
            <div key={layer.product} className="product-legend">
              <strong>
                {layer.unit
                  ? t("chrome.layerUnit", {
                      label: t(layer.labelKey),
                      unit: layer.unit,
                    })
                  : t(layer.labelKey)}
                <em>{gridAge(layer.time, clock)}</em>
              </strong>
              {/* A grid whose numbers are names is listed as names. A
                  gradient of category numbers would say that six is more than
                  three, and it is not: it is convection rather than snow. */}
              <ol
                role="list"
                className={layer.categories ? "is-categorical" : undefined}
              >
                {(layer.categories ?? layer.stops).map((entry) => {
                  const [value, color] = entry;
                  const id = entry[2];
                  return (
                    <li key={value}>
                      <i style={{ background: color }} aria-hidden="true" />
                      {id
                        ? t(`precipType.${id}` as StringKey)
                        : formatMeasure(value)}
                    </li>
                  );
                })}
              </ol>
              {layer.product === "lightning" ? (
                <small>{t("chrome.densityNote")}</small>
              ) : null}
              {layer.product === "precip-type" ? (
                <small>{t("chrome.precipTypeNote")}</small>
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
        historical={
          historicalSweep
            ? {
                collected: historicalSweep.collected,
                sourceLabel: historicalSweep.source.label,
              }
            : null
        }
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
      <LiveRegion polite={readout} assertive={announcement} />

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
        {historicalSweep?.source.url ? (
          <a href={historicalSweep.source.url} target="_blank" rel="noreferrer">
            {historicalSweep.source.label}
          </a>
        ) : historicalSweep ? (
          <span>{historicalSweep.source.label}</span>
        ) : timeline.attribution ? (
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

/**
 * What the legend says above the product name, for a single-site sweep.
 *
 * A sweep drawn from the volume in progress says so and says how old it is,
 * because the whole point of it is that the picture is seconds behind rather
 * than minutes. The age is the cut's own collection time against the clock,
 * so a slow fetch shows as what it is.
 */
function sweepEyebrow(
  sweep: SweepImage,
  clock: number,
  loop: { index: number; count: number } | null,
): string {
  const tilt = withOldest(tiltEyebrow(sweep, clock, loop), sweep, clock);
  // A terminal radar is named as such, with its reach: the picture is
  // another instrument's, drawn to another distance, and the legend has to
  // say so where the tilt is said.
  if (sweep.radar !== "TDWR") return tilt;
  return `${tilt} · ${translate("chrome.terminalRadar", {
    range: Math.round(sweep.rangeKm),
  })}`;
}

/**
 * The age of the oldest sweep on screen, when there is more than one.
 *
 * A live picture is the volume being swept now over the last one finished, and
 * with persistence on the older half is drawn faded rather than at full
 * strength. Reporting only the newer half's age would make a decayed picture
 * read as fresher than it is, which is the one thing a legend must not do.
 */
function withOldest(line: string, sweep: SweepImage, clock: number): string {
  if (!sweep.beneathCollected) return line;
  const behind = Date.parse(sweep.beneathCollected);
  if (!Number.isFinite(behind)) return line;
  const minutes = Math.max(0, Math.floor((clock - behind) / 60_000));
  return `${line} · ${translate("chrome.behind", { count: minutes })}`;
}

function tiltEyebrow(
  sweep: SweepImage,
  clock: number,
  loop: { index: number; count: number } | null,
): string {
  const age = liveAgeSeconds(sweep, clock);
  const degrees = formatNumber(sweep.elevationDegrees, 2);
  // A volume the loop reached back for arrives from the archive, so without
  // this it read as HISTORICAL: the same word the app uses for a volume the
  // reader chose by hand, in a view that has not left the present. What is
  // true is where in the loop they are and when that volume was collected,
  // and the time has to be the picture's own rather than the step's, because
  // a site scans every four to six minutes and the timeline steps every two.
  if (loop) {
    return translate("chrome.tiltLoop", {
      degrees,
      index: loop.index,
      count: loop.count,
      time: formatRadarTime(Date.parse(sweep.collected) / 1000),
    });
  }
  if (sweep.source.kind !== "recent") {
    return translate("chrome.tiltHistorical", { degrees });
  }
  if (age === null) {
    return translate(sweep.dealiased ? "chrome.tiltDealiased" : "chrome.tilt", {
      degrees,
    });
  }
  return translate(
    sweep.dealiased ? "chrome.tiltLiveDealiased" : "chrome.tiltLive",
    { degrees, seconds: String(age) },
  );
}
