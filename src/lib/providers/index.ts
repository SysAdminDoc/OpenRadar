import {
  BLANK_TILE_URL,
  createRollingRequestBudget,
  type RequestBudget,
} from "./budget";
import { log } from "../log";
import { recordFailure, recordSuccess } from "./health";
import { nowcoastProvider } from "./nowcoast";
import { rainviewerProvider } from "./rainviewer";
import { ridgeProvider } from "./ridge";
import { covers, type RadarFrame, type RadarProvider } from "./types";

export const NOAA_PROVIDERS: RadarProvider[] = [
  ridgeProvider,
  nowcoastProvider,
];
export const RADAR_PROVIDERS: RadarProvider[] = [
  ...NOAA_PROVIDERS,
  rainviewerProvider,
];

type BudgetKind = "tile" | "discovery";

const budgets = new Map<string, RequestBudget>();

function budgetFor(provider: RadarProvider, kind: BudgetKind): RequestBudget {
  const key = `${provider.id}:${kind}`;
  const existing = budgets.get(key);
  if (existing) return existing;
  const created = createRollingRequestBudget(
    kind === "tile" ? provider.tileBudgetLimit : provider.discoveryBudgetLimit,
    provider.budgetWindowMs,
  );
  budgets.set(key, created);
  return created;
}

/**
 * NOAA sources win wherever they reach. RainViewer is personal-use only, so it
 * is reserved for viewports the mosaics do not cover rather than used as a
 * failover inside them.
 */
export function providerChain(lon: number, lat: number): RadarProvider[] {
  const noaa = NOAA_PROVIDERS.filter((provider) => covers(provider, lon, lat));
  return noaa.length ? noaa : [rainviewerProvider];
}

export function coverageKey(lon: number, lat: number): string {
  return providerChain(lon, lat)
    .map((provider) => provider.id)
    .join("+");
}

export interface RadarTimeline {
  provider: RadarProvider;
  frames: RadarFrame[];
}

export async function fetchRadarTimeline(
  center: [number, number],
  loopMinutes: number,
  signal?: AbortSignal,
): Promise<RadarTimeline> {
  const chain = providerChain(center[0], center[1]);
  const failures: string[] = [];

  for (const provider of chain) {
    const budget = budgetFor(provider, "discovery");
    if (!budget.tryConsume()) {
      recordFailure(provider.id, "Request budget reached");
      log.warn("radar", `${provider.label} is over its request budget`);
      failures.push(`${provider.label} is over its request budget`);
      continue;
    }

    try {
      const frames = await provider.fetchFrames(loopMinutes, signal);
      if (!frames.length) throw new Error("No frames were published.");
      recordSuccess(provider.id, frames.length);
      log.info("radar", `${provider.label} returned ${frames.length} frames`);
      return { provider, frames };
    } catch (error) {
      // A caller that aborted mid-response can surface a TypeError rather than
      // an AbortError, and that is not a provider failure.
      if (signal?.aborted) throw error;
      if (error instanceof DOMException && error.name === "AbortError")
        throw error;
      const message =
        error instanceof Error ? error.message : "The request failed.";
      recordFailure(provider.id, message);
      log.warn("radar", `${provider.label} failed: ${message}`);
      failures.push(`${provider.label}: ${message}`);
    }
  }

  throw new Error(
    failures.length ? failures.join(" ") : "No radar provider is available.",
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
  const provider = RADAR_PROVIDERS.find((candidate) =>
    hostMatches(url, candidate.host),
  );
  if (!provider) return url;

  const budget = budgetFor(provider, "tile");
  if (!budget.tryConsume()) return BLANK_TILE_URL;
  return url;
}

export function resetRadarBudgets() {
  budgets.clear();
}

export { BLANK_TILE_URL } from "./budget";
export {
  providerHealth,
  resetHealth,
  subscribeHealth,
  type ProviderHealth,
} from "./health";
export type { ProviderId, RadarFrame, RadarProvider } from "./types";
