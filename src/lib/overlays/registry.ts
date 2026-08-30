import type { LayerSpecification } from "maplibre-gl";
import { translate } from "../../i18n";

export type OverlayId =
  | "alerts"
  | "earthquakes"
  | "wildfires"
  | "tropical"
  | "spcOutlooks"
  | "spcDiscussions";

export interface OverlayBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface OverlayFeature {
  type: "Feature";
  geometry: Record<string, unknown>;
  properties: Record<string, unknown>;
}

export interface OverlayData {
  type: "FeatureCollection";
  features: OverlayFeature[];
}

export interface OverlayDescription {
  title: string;
  lines: string[];
  url?: string;
}

export interface OverlayAdapter {
  id: OverlayId;
  label: string;
  attribution: string;
  attributionUrl: string;
  host: string;
  /** How long a snapshot stays fresh before the map asks for another one. */
  refreshMs: number;
  /** A worldwide feed that ignores the viewport it is handed. */
  global?: boolean;
  fetchData: (
    bounds: OverlayBounds,
    signal?: AbortSignal,
  ) => Promise<OverlayData>;
  layers: (sourceId: string) => LayerSpecification[];
  describe: (properties: Record<string, unknown>) => OverlayDescription;
}

export const EMPTY_OVERLAY: OverlayData = {
  type: "FeatureCollection",
  features: [],
};

export function padBounds(
  bounds: OverlayBounds,
  factor: number,
): OverlayBounds {
  const width = (bounds.east - bounds.west) * factor;
  const height = (bounds.north - bounds.south) * factor;
  return {
    west: Math.max(-180, bounds.west - width),
    south: Math.max(-85, bounds.south - height),
    east: Math.min(180, bounds.east + width),
    north: Math.min(85, bounds.north + height),
  };
}

export function boundsContain(
  outer: OverlayBounds,
  inner: OverlayBounds,
): boolean {
  return (
    outer.west <= inner.west &&
    outer.south <= inner.south &&
    outer.east >= inner.east &&
    outer.north >= inner.north
  );
}

export function boundsQuery(bounds: OverlayBounds): string {
  return [bounds.west, bounds.south, bounds.east, bounds.north]
    .map((value) => value.toFixed(4))
    .join(",");
}

function walkCoordinates(
  value: unknown,
  visit: (lon: number, lat: number) => void,
) {
  if (!Array.isArray(value)) return;
  if (typeof value[0] === "number" && typeof value[1] === "number") {
    visit(value[0], value[1]);
    return;
  }
  for (const part of value) walkCoordinates(part, visit);
}

export function featureBounds(
  geometry: Record<string, unknown>,
): OverlayBounds | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  walkCoordinates(geometry.coordinates, (lon, lat) => {
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  });

  if (!Number.isFinite(west) || !Number.isFinite(south)) return null;
  return { west, south, east, north };
}

export function boundsOverlap(
  left: OverlayBounds,
  right: OverlayBounds,
): boolean {
  return (
    left.west <= right.east &&
    left.east >= right.west &&
    left.south <= right.north &&
    left.north >= right.south
  );
}

export function relativeTime(at: number, now = Date.now()): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return translate("time.justNow");
  if (minutes < 60) return translate("time.minutesAgo", { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 48) return translate("time.hoursAgo", { count: hours });
  return translate("time.daysAgo", { count: Math.round(hours / 24) });
}
