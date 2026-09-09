import type { RadarFrame } from "./providers/types";
import { translate } from "../i18n";
import { formatClock } from "./units";

export type { RadarFrame };

export function animationIntervalMs(speed: number): number {
  const clamped = Math.min(0.5, Math.max(-0.8, speed));
  const normalized = (clamped + 0.8) / 1.3;
  return Math.round(1800 - normalized * 1450);
}

/**
 * How fast the loop plays, in frames a second.
 *
 * `animationSpeed` is a position on a slider running from -0.8 to 0.5, and
 * the panel and the settings both printed the position: a fresh install read
 * "-0.1" under the word Speed. A negative unitless speed is a number nobody
 * can act on and it reads as a fault, which is what it looked like in the
 * 2026-09-08 inspection.
 *
 * Frames a second rather than the interval the slider actually sets, because
 * this goes up as the slider goes right and an interval goes down. A slider
 * labelled Speed whose number falls as it is pushed forward is the same
 * problem in a different coat. The range is 0.6 at the slowest end and 2.9 at
 * the fastest, and the default sits at 1.0.
 */
export function framesPerSecond(speed: number): number {
  return 1000 / animationIntervalMs(speed);
}

export function frameAgeMinutes(frame: RadarFrame, now = Date.now()): number {
  return Math.max(0, Math.floor((now - frame.time * 1000) / 60_000));
}

export function formatFrameTime(frame: RadarFrame | undefined): string {
  if (!frame) return translate("radar.waiting");
  return formatRadarTime(frame.time);
}

export function formatRadarTime(time: number): string {
  return formatClock(new Date(time * 1000), {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}
