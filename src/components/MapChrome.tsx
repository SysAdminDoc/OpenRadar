import {
  ChevronDown,
  Compass,
  Minus,
  Pause,
  Play,
  Plus,
  Radar,
} from "lucide-react";
import {
  legendScale,
  stopPosition,
  type LegendScale,
  type LegendScaleId,
} from "../lib/legend";
import {
  formatFrameTime,
  formatRadarTime,
  type RadarFrame,
} from "../lib/radar";
import { formatMeasure, useT } from "../i18n";
import { formatAge, utcHourLabel } from "../lib/units";
import { rangeFill } from "../lib/rangeFill";

function initLabel(initUtc: string): string {
  return utcHourLabel(new Date(initUtc).getTime());
}

interface RadarLegendProps {
  open: boolean;
  radarEnabled: boolean;
  /** What the map is actually drawing, mosaic or one site's own sweep. */
  productLabel: string;
  eyebrow: string;
  /** A moment with no standard ramp has no scale to draw. */
  scale: LegendScaleId;
  /** A loaded colour table's own scale, which replaces the built-in one. */
  paletteScale?: LegendScale | null;
  /** Whether the picture beside this bar was drawn on the contrast ramps. */
  highContrast?: boolean;
  /**
   * Whether the picture beside this bar was drawn by reading between the
   * gates. Said out loud, so nobody reads an interpolated edge as a measured
   * one.
   */
  smoothed?: boolean;
  onToggle: () => void;
}

export function RadarLegend({
  open,
  radarEnabled,
  productLabel,
  eyebrow,
  scale,
  paletteScale = null,
  highContrast = false,
  smoothed = false,
  onToggle,
}: RadarLegendProps) {
  const t = useT();
  const reading = paletteScale ?? legendScale(scale, highContrast);

  return (
    <button
      type="button"
      className={`radar-legend ${open ? "is-active" : ""}`}
      aria-expanded={open}
      onClick={onToggle}
    >
      <Radar size={18} />
      <span>
        <small>{radarEnabled ? eyebrow : t("legend.hidden")}</small>
        <strong>{productLabel}</strong>
        {radarEnabled && smoothed ? (
          <small className="legend-smoothed">{t("legend.smoothed")}</small>
        ) : null}
      </span>
      <ChevronDown size={16} />
      {reading ? (
        <>
          <i
            className={reading.ramp}
            style={
              reading.gradient ? { background: reading.gradient } : undefined
            }
            aria-hidden="true"
          />
          <span
            className="legend-scale"
            // A group rather than an image, and the honest reason is that a
            // group is what this is: a set of readings along a scale. The
            // first version of this comment said `img` was hiding the
            // readings, which was wrong. The whole thing sits inside a
            // `button`, and `button` is on the same presentational-children
            // list `img` is, so the readings were never separately exposed
            // under either role. What the role is actually for is giving the
            // `aria-label` below something to be the name of.
            role="group"
            aria-label={t("legend.scale", {
              product: productLabel,
              min: formatMeasure(reading.min),
              max: formatMeasure(reading.max),
              unit: reading.unit,
            })}
          >
            {reading.stops.map((stop) => (
              <em
                key={stop}
                style={{ left: `${stopPosition(reading, stop)}%` }}
              >
                {formatMeasure(stop)}
              </em>
            ))}
          </span>
        </>
      ) : null}
    </button>
  );
}

interface RadarTimelineProps {
  frames: RadarFrame[];
  frameIndex: number;
  playing: boolean;
  error: string | null;
  sourceLabel: string | null;
  ageMinutes: number | null;
  historical?: { collected: string; sourceLabel: string } | null;
  onFrameIndex: (index: number) => void;
  onPlaying: (playing: boolean) => void;
}

export function RadarTimeline({
  frames,
  frameIndex,
  playing,
  error,
  sourceLabel,
  ageMinutes,
  historical = null,
  onFrameIndex,
  onPlaying,
}: RadarTimelineProps) {
  const t = useT();
  const frame = frames[frameIndex];
  const historicalTime = historical
    ? Date.parse(historical.collected) / 1000
    : Number.NaN;
  const showingHistory = Number.isFinite(historicalTime);
  const forecast = showingHistory ? undefined : frame?.forecast;
  const lastFrame = showingHistory ? 0 : Math.max(0, frames.length - 1);
  const atFrame = showingHistory ? 0 : Math.min(frameIndex, lastFrame);
  return (
    <div
      className={`radar-timeline ${forecast ? "is-forecast" : ""}${showingHistory ? " is-historical" : ""}`}
      role="group"
      aria-label={t("timeline.label")}
    >
      <button
        className="play-button"
        type="button"
        aria-label={
          playing && !showingHistory ? t("timeline.pause") : t("timeline.play")
        }
        aria-pressed={showingHistory ? false : playing}
        disabled={showingHistory || !frames.length}
        onClick={() => onPlaying(!playing)}
      >
        {playing ? (
          <Pause size={18} fill="currentColor" />
        ) : (
          <Play size={18} fill="currentColor" />
        )}
      </button>
      <div className="timeline-copy">
        <strong>
          {showingHistory
            ? formatRadarTime(historicalTime)
            : (error ??
              (forecast
                ? t("timeline.forecastAt", { time: formatFrameTime(frame) })
                : formatFrameTime(frame)))}
        </strong>
        <span>
          {showingHistory
            ? [
                t("timeline.frames", { index: 1, total: 1 }),
                historical?.sourceLabel ?? sourceLabel,
                t("timeline.historical"),
              ].join(" \u00b7 ")
            : frames.length
              ? [
                  t("timeline.frames", {
                    index: frameIndex + 1,
                    total: frames.length,
                  }),
                  forecast
                    ? t("timeline.hrrr", {
                        init: initLabel(forecast.initUtc),
                        lead: forecast.leadMinutes,
                      })
                    : sourceLabel,
                  forecast
                    ? null
                    : ageMinutes === null
                      ? null
                      : ageMinutes < 1
                        ? t("timeline.live")
                        : t("timeline.age", { age: formatAge(ageMinutes) }),
                ]
                  .filter(Boolean)
                  .join(" · ")
              : t("timeline.connecting")}
        </span>
      </div>
      <input
        type="range"
        min="0"
        max={lastFrame}
        value={atFrame}
        style={rangeFill(atFrame, 0, lastFrame)}
        disabled={showingHistory || !frames.length}
        aria-label={t("timeline.frame")}
        aria-valuetext={
          showingHistory
            ? formatRadarTime(historicalTime)
            : frame
              ? forecast
                ? t("timeline.forecastAt", { time: formatFrameTime(frame) })
                : formatFrameTime(frame)
              : t("timeline.connecting")
        }
        onChange={(event) => onFrameIndex(Number(event.target.value))}
      />
      <button
        className="timeline-live-button"
        type="button"
        aria-label={t("timeline.goLive")}
        disabled={
          showingHistory || !frames.length || frameIndex === frames.length - 1
        }
        onClick={() => onFrameIndex(frames.length - 1)}
      >
        {t("timeline.live")}
      </button>
    </div>
  );
}

interface ZoomControlsProps {
  bearing: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetNorth: () => void;
}

export function ZoomControls({
  bearing,
  onZoomIn,
  onZoomOut,
  onResetNorth,
}: ZoomControlsProps) {
  const t = useT();
  return (
    <div className="zoom-controls" role="group" aria-label={t("zoom.controls")}>
      <button
        type="button"
        aria-label={t("zoom.resetNorth")}
        onClick={onResetNorth}
      >
        <Compass size={20} style={{ transform: `rotate(${-bearing}deg)` }} />
      </button>
      <button type="button" aria-label={t("zoom.in")} onClick={onZoomIn}>
        <Plus size={20} />
      </button>
      <button type="button" aria-label={t("zoom.out")} onClick={onZoomOut}>
        <Minus size={20} />
      </button>
    </div>
  );
}
