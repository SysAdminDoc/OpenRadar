import {
  BLANK_TILE_URL,
  createRollingRequestBudget,
  type RequestBudget,
} from "./budget";
import { log } from "../log";
import { recordFailure, recordSuccess } from "./health";
import { HRRR_HOST } from "./hrrr";
import { SATELLITE_HOST } from "./satellite";
import { geometProvider, isCanadianViewport } from "./geomet";
import { mrmsAvailable, mrmsProvider } from "./mrms";
import { nowcoastProvider } from "./nowcoast";
import { rainviewerProvider } from "./rainviewer";
import { ridgeProvider } from "./ridge";
import {
  covers,
  type ProviderId,
  type RadarFrame,
  type RadarProvider,
} from "./types";
import { cachedSince } from "../tileCache";
import { translate } from "../../i18n";

export const NOAA_PROVIDERS: RadarProvider[] = [
  mrmsProvider,
  ridgeProvider,
  nowcoastProvider,
];
export const RADAR_PROVIDERS: RadarProvider[] = [
  ...NOAA_PROVIDERS,
  geometProvider,
  rainviewerProvider,
];

type BudgetKind = "tile" | "discovery";

/** What the Diagnostics panel lists, including sources outside the chain. */
export const DIAGNOSTIC_SOURCES: Array<{ id: ProviderId; label: string }> = [
  ...RADAR_PROVIDERS.map((provider) => ({
    id: provider.id,
    label: provider.label,
  })),
  { id: "hrrr", label: "HRRR forecast" },
];

const budgets = new Map<string, RequestBudget>();

function budget(key: string, limit: number, windowMs: number): RequestBudget {
  const existing = budgets.get(key);
  if (existing) return existing;
  const created = createRollingRequestBudget(limit, windowMs);
  budgets.set(key, created);
  return created;
}

function budgetFor(provider: RadarProvider, kind: BudgetKind): RequestBudget {
  return budget(
    `${provider.id}:${kind}`,
    kind === "tile" ? provider.tileBudgetLimit : provider.discoveryBudgetLimit,
    provider.budgetWindowMs,
  );
}

/** Hosts whose tiles are counted, including sources outside the failover chain. */
const GUARDED_TILE_HOSTS: Array<{ host: string; key: string; limit: number }> =
  [
    ...RADAR_PROVIDERS.map((provider) => ({
      host: provider.host,
      key: `${provider.id}:tile`,
      limit: provider.tileBudgetLimit,
    })),
    // The Iowa State cache is a courtesy service and asks for restraint.
    { host: HRRR_HOST, key: "hrrr:tile", limit: 900 },
    { host: SATELLITE_HOST, key: "satellite:tile", limit: 900 },
  ];

/**
 * NOAA sources win wherever they reach. RainViewer is personal-use only, so it
 * is reserved for viewports the mosaics do not cover rather than used as a
 * failover inside them.
 */
export function providerChain(lon: number, lat: number): RadarProvider[] {
  // Canada's own service leads over its own country, even where the American
  // mosaics reach across the border. RainViewer stays behind it so an outage
  // means a worse picture rather than none.
  if (isCanadianViewport(lon, lat)) {
    return [geometProvider, rainviewerProvider];
  }

  const noaa = NOAA_PROVIDERS.filter(
    (provider) =>
      covers(provider, lon, lat) &&
      // MRMS grids are decoded natively, so a browser preview never sees it
      // and falls straight through to the mosaics.
      (provider.id !== "mrms" || mrmsAvailable()),
  );
  if (noaa.length) return noaa;
  // Canada has its own service, and it is a better answer there than a
  // personal-use feed. RainViewer is what is left for everywhere else, and it
  // stays on the end of the Canadian chain too: GeoMet going down should mean
  // a worse picture, not no picture.
  if (covers(geometProvider, lon, lat)) {
    return [geometProvider, rainviewerProvider];
  }
  return [rainviewerProvider];
}

/** MRMS covers more than the model does, so the model asks the mosaic. */
export function isConusViewport(lon: number, lat: number): boolean {
  return covers(ridgeProvider, lon, lat);
}

export function coverageKey(lon: number, lat: number): string {
  return providerChain(lon, lat)
    .map((provider) => provider.id)
    .join("+");
}

export interface RadarTimeline {
  provider: RadarProvider;
  frames: RadarFrame[];
  /**
   * How old the bytes behind this loop are, when the native side answered
   * from its cache rather than from the network. Null for a live answer.
   */
  cachedAgeSeconds: number | null;
}

export async function fetchRadarTimeline(
  center: [number, number],
  loopMinutes: number,
  signal?: AbortSignal,
): Promise<RadarTimeline> {
  const chain = providerChain(center[0], center[1]);
  const failures: string[] = [];
  // Anything reported as cached after this moment belongs to this attempt.
  const startedAt = Date.now();

  for (const provider of chain) {
    const budget = budgetFor(provider, "discovery");
    if (!budget.tryConsume()) {
      recordFailure(provider.id, translate("radar.budgetReached"));
      log.warn("radar", `${provider.label} is over its request budget`);
      failures.push(`${provider.label} is over its request budget`);
      continue;
    }

    try {
      const frames = await provider.fetchFrames(loopMinutes, signal);
      if (!frames.length) throw new Error(translate("radar.noFrames"));
      recordSuccess(provider.id, frames.length);
      log.info("radar", `${provider.label} returned ${frames.length} frames`);
      // A reply that came off the disk is still a reply, and the map is right
      // to draw it. It is not live, though, and the timeline has to say so.
      return {
        provider,
        frames,
        cachedAgeSeconds: cachedSince(startedAt),
      };
    } catch (error) {
      // A caller that aborted mid-response can surface a TypeError rather than
      // an AbortError, and that is not a provider failure.
      if (signal?.aborted) throw error;
      if (error instanceof DOMException && error.name === "AbortError")
        throw error;
      const message =
        error instanceof Error
          ? error.message
          : translate("radar.requestFailedShort");
      recordFailure(provider.id, message);
      log.warn("radar", `${provider.label} failed: ${message}`);
      failures.push(`${provider.label}: ${message}`);
    }
  }

  throw new Error(
    failures.length ? failures.join(" ") : translate("radar.noProvider"),
  );
}

function hostMatches(url: string, host: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === host || hostname.endsWith(`.${host}`);
  } catch {
    return false;
  }
}

/**
 * Every provider request the map makes passes through here, so a runaway
 * playback session degrades to blank tiles instead of hammering a public
 * service past its budget.
 */
export function guardRadarRequest(url: string): string {
  const guarded = GUARDED_TILE_HOSTS.find((candidate) =>
    hostMatches(url, candidate.host),
  );
  if (!guarded) return url;

  const counter = budget(guarded.key, guarded.limit, 60_000);
  if (!counter.tryConsume()) return BLANK_TILE_URL;
  return url;
}

export function resetRadarBudgets() {
  budgets.clear();
}

export { BLANK_TILE_URL } from "./budget";
export {
  providerHealth,
  recordFailure,
  recordSuccess,
  resetHealth,
  subscribeHealth,
  type ProviderHealth,
} from "./health";
export type {
  ForecastStamp,
  ProviderId,
  RadarFrame,
  RadarProvider,
} from "./types";
export {
  SATELLITE_ATTRIBUTION,
  SATELLITE_MAX_ZOOM,
  satelliteFrameTime,
  satelliteTileUrl,
} from "./satellite";
export {
  HRRR_MAX_FRAMES,
  fetchHrrrRun,
  hrrrFrames,
  type HrrrRun,
} from "./hrrr";
