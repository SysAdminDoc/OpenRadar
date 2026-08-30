export type ProviderId = "ridge" | "nowcoast" | "rainviewer";

export interface RadarFrame {
  providerId: ProviderId;
  time: number;
  tileUrl: string;
  tileSize: number;
  maxZoom: number;
  attribution: string;
}

export interface BoundingBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface RadarProvider {
  id: ProviderId;
  label: string;
  detail: string;
  attribution: string;
  attributionUrl: string;
  /** Regions the provider covers. An empty list means worldwide. */
  coverage: BoundingBox[];
  /** Requests the provider tolerates inside `budgetWindowMs`. */
  budgetLimit: number;
  budgetWindowMs: number;
  /** Host used to attribute tile requests back to this provider. */
  host: string;
  fetchFrames: (
    loopMinutes: number,
    signal?: AbortSignal,
  ) => Promise<RadarFrame[]>;
}

export function covers(provider: RadarProvider, lon: number, lat: number) {
  if (!provider.coverage.length) return true;
  return provider.coverage.some(
    (box) =>
      lat >= box.south &&
      lat <= box.north &&
      lon >= box.west &&
      lon <= box.east,
  );
}

export function withinLoop(
  frames: RadarFrame[],
  loopMinutes: number,
): RadarFrame[] {
  const newest = frames.at(-1)?.time ?? 0;
  const cutoff = newest - loopMinutes * 60;
  return frames.filter((frame) => frame.time >= cutoff);
}
