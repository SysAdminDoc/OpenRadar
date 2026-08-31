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
import { formatFrameTime, type RadarFrame } from "../lib/radar";
import { useT } from "../i18n";

function initLabel(initUtc: string): string {
  const at = new Date(initUtc);
  return `${String(at.getUTCHours()).padStart(2, "0")}Z`;
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
  onToggle: () => void;
}

export function RadarLegend({
  open,
  radarEnabled,
  productLabel,
  eyebrow,
  scale,
  paletteScale = null,
  onToggle,
}: RadarLegendProps) {
  const t = useT();
  const reading = paletteScale ?? legendScale(scale);

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
            aria-label={t("legend.scale", {
              product: productLabel,
              min: reading.min,
              max: reading.max,
              unit: reading.unit,
            })}
          >
            {reading.stops.map((stop) => (
              <em
                key={stop}
                style={{ left: `${stopPosition(reading, stop)}%` }}
              >
                {stop}
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
  onFrameIndex,
  onPlaying,
}: RadarTimelineProps) {
  const t = useT();
  const frame = frames[frameIndex];
  const forecast = frame?.forecast;
  return (
    <div
      className={`radar-timeline ${forecast ? "is-forecast" : ""}`}
      aria-label={t("timeline.label")}
    >
      <button
        className="play-button"
        type="button"
        aria-label={playing ? t("timeline.pause") : t("timeline.play")}
        aria-pressed={playing}
        disabled={!frames.length}
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
          {error ??
            (forecast
              ? t("timeline.forecastAt", { time: formatFrameTime(frame) })
              : formatFrameTime(frame))}
        </strong>
        <span>
          {frames.length
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
                      : t("timeline.minutesOld", { count: ageMinutes }),
              ]
                .filter(Boolean)
                .join(" · ")
            : t("timeline.connecting")}
        </span>
      </div>
      <input
        type="range"
        min="0"
        max={Math.max(0, frames.length - 1)}
        value={Math.min(frameIndex, Math.max(0, frames.length - 1))}
        disabled={!frames.length}
        aria-label={t("timeline.frame")}
        aria-valuetext={
          frame
            ? forecast
              ? t("timeline.forecastAt", { time: formatFrameTime(frame) })
              : formatFrameTime(frame)
            : t("timeline.connecting")
        }
        onChange={(event) => onFrameIndex(Number(event.target.value))}
      />
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
    <div className="zoom-controls" aria-label={t("zoom.controls")}>
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
