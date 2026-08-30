import type { RadarFrame } from "./providers/types";
import { translate } from "../i18n";

export type { RadarFrame };

export function animationIntervalMs(speed: number): number {
  const clamped = Math.min(0.5, Math.max(-0.8, speed));
  const normalized = (clamped + 0.8) / 1.3;
  return Math.round(1800 - normalized * 1450);
}

export function frameAgeMinutes(frame: RadarFrame, now = Date.now()): number {
  return Math.max(0, Math.floor((now - frame.time * 1000) / 60_000));
}

export function formatFrameTime(frame: RadarFrame | undefined): string {
  if (!frame) return translate("radar.waiting");
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(frame.time * 1000));
}
