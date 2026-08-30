import {
  relativeTime,
  type OverlayAdapter,
  type OverlayData,
  type OverlayFeature,
} from "./registry";

const FEED =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson";

export function parseEarthquakes(payload: unknown): OverlayData {
  const raw = payload as { features?: unknown };
  const features = Array.isArray(raw?.features) ? raw.features : [];
  const parsed: OverlayFeature[] = [];

  for (const item of features) {
    if (!item || typeof item !== "object") continue;
    const feature = item as {
      geometry?: { type?: unknown; coordinates?: unknown };
      properties?: Record<string, unknown>;
    };
    const coordinates = feature.geometry?.coordinates;
    if (feature.geometry?.type !== "Point" || !Array.isArray(coordinates)) {
      continue;
    }
    const [lon, lat, depth] = coordinates.map(Number);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;

    const properties = feature.properties ?? {};
    const magnitude = Number(properties.mag);
    if (!Number.isFinite(magnitude)) continue;

    parsed.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: {
        magnitude,
        place: typeof properties.place === "string" ? properties.place : "",
        depthKm: Number.isFinite(depth) ? depth : null,
        time: Number(properties.time) || null,
        url: typeof properties.url === "string" ? properties.url : "",
      },
    });
  }

  parsed.sort(
    (left, right) =>
      Number(right.properties.magnitude) - Number(left.properties.magnitude),
  );
  return { type: "FeatureCollection", features: parsed };
}

export const earthquakesOverlay: OverlayAdapter = {
  id: "earthquakes",
  label: "Earthquakes",
  attribution: '<a href="https://earthquake.usgs.gov/">USGS earthquakes</a>',
  attributionUrl: "https://earthquake.usgs.gov/",
  host: "earthquake.usgs.gov",
  refreshMs: 5 * 60_000,
  // The summary feed is worldwide and small, so the viewport does not filter it.
  fetchData: async (_bounds, signal) => {
    const response = await fetch(FEED, {
      signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`USGS returned ${response.status}.`);
    }
    return parseEarthquakes(await response.json());
  },
  layers: (sourceId) => [
    {
      id: `${sourceId}-circle`,
      type: "circle",
      source: sourceId,
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["get", "magnitude"],
          2.5,
          4,
          5,
          9,
          7,
          16,
        ],
        "circle-color": [
          "interpolate",
          ["linear"],
          ["get", "magnitude"],
          2.5,
          "#fde68a",
          5,
          "#fb923c",
          7,
          "#f43f5e",
        ],
        "circle-opacity": 0.72,
        "circle-stroke-color": "#0b1018",
        "circle-stroke-width": 1,
      },
    },
  ],
  describe: (properties) => {
    const time = Number(properties.time);
    const depth = Number(properties.depthKm);
    return {
      title:
        `M ${Number(properties.magnitude).toFixed(1)} ${String(properties.place ?? "")}`.trim(),
      lines: [
        Number.isFinite(time)
          ? `Recorded ${relativeTime(time)}`
          : "Time unknown",
        Number.isFinite(depth)
          ? `Depth ${depth.toFixed(0)} km`
          : "Depth unknown",
        "Source: USGS",
      ],
      url: typeof properties.url === "string" ? properties.url : undefined,
    };
  },
};
