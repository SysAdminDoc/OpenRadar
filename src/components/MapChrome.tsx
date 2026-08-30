import {
  ChevronDown,
  Compass,
  Minus,
  Pause,
  Play,
  Plus,
  Radar,
} from "lucide-react";
import { formatFrameTime, type RadarFrame } from "../lib/radar";

interface RadarLegendProps {
  open: boolean;
  radarEnabled: boolean;
  onToggle: () => void;
}

export function RadarLegend({
  open,
  radarEnabled,
  onToggle,
}: RadarLegendProps) {
  return (
    <button
      type="button"
      className={`radar-legend ${open ? "is-active" : ""}`}
      aria-expanded={open}
      onClick={onToggle}
    >
      <Radar size={18} />
      <span>
        <small>{radarEnabled ? "LIVE PRODUCT" : "PRODUCT HIDDEN"}</small>
        <strong>Composite Radar</strong>
      </span>
      <ChevronDown size={16} />
      <i className="legend-ramp" aria-hidden="true" />
    </button>
  );
}

interface RadarTimelineProps {
  frames: RadarFrame[];
  frameIndex: number;
  playing: boolean;
  error: string | null;
  onFrameIndex: (index: number) => void;
  onPlaying: (playing: boolean) => void;
}

export function RadarTimeline({
  frames,
  frameIndex,
  playing,
  error,
  onFrameIndex,
  onPlaying,
}: RadarTimelineProps) {
  const frame = frames[frameIndex];
  return (
    <div className="radar-timeline" aria-label="Radar animation">
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
        <strong>{error ?? formatFrameTime(frame)}</strong>
        <span>
          {frames.length
            ? `${frameIndex + 1} of ${frames.length} radar frames`
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
