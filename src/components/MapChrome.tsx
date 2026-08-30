import {
  ChevronDown,
  Compass,
  Minus,
  Pause,
  Play,
  Plus,
  Radar,
} from "lucide-react";
import { legendScale, stopPosition, type LegendScaleId } from "../lib/legend";
import { formatFrameTime, type RadarFrame } from "../lib/radar";

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
  onToggle: () => void;
}

export function RadarLegend({
  open,
  radarEnabled,
  productLabel,
  eyebrow,
  scale,
  onToggle,
}: RadarLegendProps) {
  const reading = legendScale(scale);

  return (
    <button
      type="button"
      className={`radar-legend ${open ? "is-active" : ""}`}
      aria-expanded={open}
      onClick={onToggle}
    >
      <Radar size={18} />
      <span>
        <small>{radarEnabled ? eyebrow : "PRODUCT HIDDEN"}</small>
        <strong>{productLabel}</strong>
      </span>
      <ChevronDown size={16} />
      {reading ? (
        <>
          <i className={reading.ramp} aria-hidden="true" />
          <span
            className="legend-scale"
            aria-label={`${productLabel} from ${reading.min} to ${reading.max} ${reading.unit}`}
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
  const frame = frames[frameIndex];
  const forecast = frame?.forecast;
  return (
    <div
      className={`radar-timeline ${forecast ? "is-forecast" : ""}`}
      aria-label="Radar animation"
    >
      <button
        className="play-button"
        type="button"
        aria-label={playing ? "Pause radar animation" : "Play radar animation"}
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
              ? `${formatFrameTime(frame)} forecast`
              : formatFrameTime(frame))}
        </strong>
        <span>
          {frames.length
            ? [
                `${frameIndex + 1} of ${frames.length} radar frames`,
                forecast
                  ? `HRRR init ${initLabel(forecast.initUtc)}, +${forecast.leadMinutes} min`
                  : sourceLabel,
                forecast
                  ? null
                  : ageMinutes === null
                    ? null
                    : ageMinutes < 1
                      ? "live"
                      : `${ageMinutes} min old`,
              ]
                .filter(Boolean)
                .join(" · ")
            : "Connecting to radar"}
        </span>
      </div>
      <input
        type="range"
        min="0"
        max={Math.max(0, frames.length - 1)}
        value={Math.min(frameIndex, Math.max(0, frames.length - 1))}
        disabled={!frames.length}
        aria-label="Radar frame"
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
  return (
    <div className="zoom-controls" aria-label="Map navigation controls">
      <button
        type="button"
        aria-label="Reset north and pitch"
        onClick={onResetNorth}
      >
        <Compass size={20} style={{ transform: `rotate(${-bearing}deg)` }} />
      </button>
      <button type="button" aria-label="Zoom in" onClick={onZoomIn}>
        <Plus size={20} />
      </button>
      <button type="button" aria-label="Zoom out" onClick={onZoomOut}>
        <Minus size={20} />
      </button>
    </div>
  );
}
