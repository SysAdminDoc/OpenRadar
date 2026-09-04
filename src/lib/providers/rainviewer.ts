import { serviceAnswer } from "../serviceAnswer";
import { withinLoop, type RadarFrame, type RadarProvider } from "./types";
import { cachedUrl } from "../tileCache";
import { noteCachedResponse } from "../tileCache";
import { translate } from "../../i18n";

interface RainViewerPayload {
  host?: unknown;
  radar?: { past?: unknown };
}

const DISCOVERY_URL = "https://api.rainviewer.com/public/weather-maps.json";
const FRAME_PATH_PATTERN = /^\/v2\/radar\/[A-Za-z0-9_-]+$/;
const ATTRIBUTION = '<a href="https://www.rainviewer.com/">RainViewer</a>';

export function trustedRainViewerOrigin(value: unknown): string | null {
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

export function parseRainViewerFrames(payload: unknown): RadarFrame[] {
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
    byTime.set(frame.time, {
      providerId: "rainviewer",
      time: frame.time,
      tileUrl: `${host}${frame.path}/512/{z}/{x}/{y}/2/1_1.png`,
      tileSize: 512,
      maxZoom: 7,
      attribution: ATTRIBUTION,
    });
  }

  return [...byTime.values()].sort((left, right) => left.time - right.time);
}

/**
 * Only used outside the NOAA mosaics. RainViewer's free tier is personal use
 * with a 100 request per minute ceiling, so it is the last resort rather than
 * the default layer.
 */
export const rainviewerProvider: RadarProvider = {
  id: "rainviewer",
  label: "RainViewer",
  attribution: ATTRIBUTION,
  attributionUrl: "https://www.rainviewer.com/",
  host: "rainviewer.com",
  coverage: [],
  tileBudgetLimit: 90,
  discoveryBudgetLimit: 10,
  budgetWindowMs: 60_000,
  fetchFrames: async (loopMinutes, signal, _center, cacheReport) => {
    const response = await fetch(cachedUrl(DISCOVERY_URL), {
      signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    noteCachedResponse(response, cacheReport);
    if (!response.ok) {
      throw new Error(
        translate("provider.failed", {
          answer: serviceAnswer(response.status),
        }),
      );
    }
    const frames = parseRainViewerFrames(await response.json());
    if (!frames.length) {
      throw new Error(translate("radar.rainviewerEmpty"));
    }
    return withinLoop(frames, loopMinutes);
  },
};
