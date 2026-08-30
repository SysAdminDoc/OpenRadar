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
  budgetLimit: number;
  budgetWindowMs: number;
  maxZoom: number;
  maxFrames: number;
}

const TILE_SIZE = 256;

function localName(element: Element): string {
  return element.tagName.replace(/^.*:/, "");
}

function firstChild(parent: Element, tag: string): Element | null {
  for (const child of Array.from(parent.children)) {
    if (localName(child) === tag) return child;
  }
  return null;
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
    const iso = part.trim();
    if (!iso) continue;
    const parsed = Date.parse(iso);
    if (!Number.isFinite(parsed)) continue;
    const time = Math.floor(parsed / 1000);
    byTime.set(time, { time, iso });
  }

  return [...byTime.values()].sort((left, right) => left.time - right.time);
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
    budgetLimit: config.budgetLimit,
    budgetWindowMs: config.budgetWindowMs,
    host: config.host,
    fetchFrames: async (loopMinutes, signal) => {
      const response = await fetch(capabilitiesUrl, {
        signal,
        headers: { Accept: "application/xml" },
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`${config.label} returned ${response.status}.`);
      }
      const steps = parseWmsTimeSteps(await response.text(), config.layer);
      if (!steps.length) {
        throw new Error(`${config.label} published no radar times.`);
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
