export interface RadarFrame {
  time: number;
  path: string;
  host: string;
}

interface RainViewerPayload {
  generated?: unknown;
  host?: unknown;
  radar?: {
    past?: unknown;
  };
}

const DISCOVERY_URL = "https://api.rainviewer.com/public/weather-maps.json";
const FRAME_PATH_PATTERN = /^\/v2\/radar\/[A-Za-z0-9_-]+$/;

function trustedRainViewerOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      (host !== "rainviewer.com" && !host.endsWith(".rainviewer.com"))
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function parseRadarFrames(payload: unknown): RadarFrame[] {
  if (!payload || typeof payload !== "object") return [];
  const raw = payload as RainViewerPayload;
  const host = trustedRainViewerOrigin(raw.host);
  if (!host || !Array.isArray(raw.radar?.past)) return [];

  const byTime = new Map<number, RadarFrame>();
  for (const item of raw.radar.past) {
    if (!item || typeof item !== "object") continue;
    const frame = item as { time?: unknown; path?: unknown };
    if (
      typeof frame.time !== "number" ||
      !Number.isFinite(frame.time) ||
      typeof frame.path !== "string" ||
      !FRAME_PATH_PATTERN.test(frame.path)
    ) {
      continue;
    }
    byTime.set(frame.time, { time: frame.time, path: frame.path, host });
  }

  return [...byTime.values()].sort((left, right) => left.time - right.time);
}

export async function fetchRadarFrames(
  signal?: AbortSignal,
): Promise<RadarFrame[]> {
  const response = await fetch(DISCOVERY_URL, {
    signal,
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(`Radar discovery returned ${response.status}.`);
  const frames = parseRadarFrames(await response.json());
  if (!frames.length)
    throw new Error("Radar discovery returned no usable frames.");
  return frames;
}

export function radarTileTemplate(frame: RadarFrame): string {
  const host = trustedRainViewerOrigin(frame.host);
  if (!host || !FRAME_PATH_PATTERN.test(frame.path)) {
    throw new Error("Radar frame source is not trusted.");
  }
  return `${host}${frame.path}/512/{z}/{x}/{y}/2/1_1.png`;
}

export function animationIntervalMs(speed: number): number {
  const clamped = Math.min(0.5, Math.max(-0.8, speed));
  const normalized = (clamped + 0.8) / 1.3;
  return Math.round(1800 - normalized * 1450);
}

export function frameAgeMinutes(frame: RadarFrame, now = Date.now()): number {
  return Math.max(0, Math.floor((now - frame.time * 1000) / 60_000));
}

export function formatFrameTime(frame: RadarFrame | undefined): string {
  if (!frame) return "Waiting for radar";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(frame.time * 1000));
}
