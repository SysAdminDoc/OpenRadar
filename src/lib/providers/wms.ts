import { withinLoop, type BoundingBox, type ProviderId } from "./types";
import type { RadarFrame, RadarProvider } from "./types";

export interface WmsStep {
  time: number;
  iso: string;
}

export interface WmsProviderConfig {
  id: ProviderId;
  label: string;
  detail: string;
  attribution: string;
  attributionUrl: string;
  host: string;
  owsUrl: string;
  layer: string;
  coverage: BoundingBox[];
  tileBudgetLimit: number;
  discoveryBudgetLimit: number;
  budgetWindowMs: number;
  maxZoom: number;
  maxFrames: number;
}

const TILE_SIZE = 256;
/** A ceiling on how many frames one capabilities document can produce. */
const MAX_STEPS = 240;

function localName(element: Element): string {
  return element.tagName.replace(/^.*:/, "");
}

function firstChild(parent: Element, tag: string): Element | null {
  for (const child of Array.from(parent.children)) {
    if (localName(child) === tag) return child;
  }
  return null;
}

/** ISO 8601 durations, which is all a WMS TIME period may be. */
export function durationSeconds(period: string): number | null {
  const match =
    /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(
      period.trim().toUpperCase(),
    );
  if (!match) return null;
  const [, days, hours, minutes, seconds] = match;
  const total =
    Number(days ?? 0) * 86_400 +
    Number(hours ?? 0) * 3_600 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0);
  return total > 0 ? total : null;
}

/**
 * A TIME value is either one instant or a `start/end/period` interval. GeoServer
 * usually lists instants, but the interval form is legal and would otherwise
 * read as no times at all.
 */
function expandTimeValue(value: string): WmsStep[] {
  if (!value.includes("/")) {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) return [];
    return [{ time: Math.floor(parsed / 1000), iso: value }];
  }

  const [start, end, period] = value.split("/");
  const from = Date.parse(start ?? "");
  const to = Date.parse(end ?? "");
  const stepSeconds = durationSeconds(period ?? "");
  if (!Number.isFinite(from) || !Number.isFinite(to) || !stepSeconds) return [];

  const stepMs = stepSeconds * 1000;
  // A month-long interval would otherwise fill the cap with instants from its
  // first day, and every one of them would fall outside the loop window.
  const total = Math.floor((to - from) / stepMs) + 1;
  const first = total > MAX_STEPS ? to - (MAX_STEPS - 1) * stepMs : from;

  const steps: WmsStep[] = [];
  for (let at = first; at <= to; at += stepMs) {
    steps.push({
      time: Math.floor(at / 1000),
      iso: new Date(at).toISOString(),
    });
  }
  return steps;
}

/**
 * Reads the TIME dimension a WMS layer publishes in its capabilities document.
 * GeoServer lists every retained observation, so the returned steps are the
 * exact strings the server will accept back in a GetMap request.
 */
export function parseWmsTimeSteps(xml: string, layer: string): WmsStep[] {
  const document = new DOMParser().parseFromString(xml, "text/xml");
  if (document.getElementsByTagName("parsererror").length) return [];

  const layers = Array.from(document.getElementsByTagName("*")).filter(
    (element) => localName(element) === "Layer",
  );
  const match = layers.find(
    (element) => firstChild(element, "Name")?.textContent?.trim() === layer,
  );
  if (!match) return [];

  const dimension = Array.from(match.children).find(
    (child) =>
      localName(child) === "Dimension" &&
      child.getAttribute("name")?.toLowerCase() === "time",
  );
  const raw = dimension?.textContent ?? "";

  const byTime = new Map<number, WmsStep>();
  for (const part of raw.split(",")) {
    const value = part.trim();
    if (!value) continue;
    for (const step of expandTimeValue(value)) {
      byTime.set(step.time, step);
    }
  }

  return [...byTime.values()]
    .sort((left, right) => left.time - right.time)
    .slice(-MAX_STEPS);
}

export function wmsTileUrl(owsUrl: string, layer: string, iso: string): string {
  const query = new URLSearchParams({
    service: "WMS",
    version: "1.1.1",
    request: "GetMap",
    layers: layer,
    styles: "",
    format: "image/png",
    transparent: "true",
    width: String(TILE_SIZE),
    height: String(TILE_SIZE),
    srs: "EPSG:3857",
    time: iso,
  });
  // MapLibre substitutes the bbox token, so it must survive URL encoding.
  return `${owsUrl}?${query.toString()}&bbox={bbox-epsg-3857}`;
}

export function createWmsProvider(config: WmsProviderConfig): RadarProvider {
  const capabilitiesUrl = `${config.owsUrl}?service=WMS&version=1.3.0&request=GetCapabilities`;

  return {
    id: config.id,
    label: config.label,
    detail: config.detail,
    attribution: config.attribution,
    attributionUrl: config.attributionUrl,
    coverage: config.coverage,
    tileBudgetLimit: config.tileBudgetLimit,
    discoveryBudgetLimit: config.discoveryBudgetLimit,
    budgetWindowMs: config.budgetWindowMs,
    host: config.host,
    fetchFrames: async (loopMinutes, signal) => {
      const response = await fetch(capabilitiesUrl, {
        signal,
        headers: { Accept: "application/xml" },
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`The service returned ${response.status}.`);
      }
      const steps = parseWmsTimeSteps(await response.text(), config.layer);
      if (!steps.length) {
        throw new Error("No radar times were published.");
      }

      const frames: RadarFrame[] = steps.map((step) => ({
        providerId: config.id,
        time: step.time,
        tileUrl: wmsTileUrl(config.owsUrl, config.layer, step.iso),
        tileSize: TILE_SIZE,
        maxZoom: config.maxZoom,
        attribution: config.attribution,
      }));

      return withinLoop(frames, loopMinutes).slice(-config.maxFrames);
    },
  };
}
