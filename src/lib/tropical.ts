import type { OverlayData } from "./overlays";

export interface ActiveStorm {
  id: string;
  name: string;
  stormType: string;
  windKt: number;
  gustKt: number | null;
  pressureMb: number | null;
  lat: number;
  lon: number;
  advisoryNumber: string;
  advisoryDate: string;
  advisoryUrl: string;
}

function pointCoordinates(
  geometry: Record<string, unknown>,
): [number, number] | null {
  if (geometry.type !== "Point") return null;
  const coordinates = geometry.coordinates;
  if (!Array.isArray(coordinates)) return null;
  const [lon, lat] = coordinates.map(Number);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return [lon, lat];
}

/**
 * The forecast-points layer carries one record per forecast hour. The hour-zero
 * record is where the storm is now, which is the row the panel lists.
 *
 * The storm list at nhc.noaa.gov/CurrentStorms.json would carry the same names
 * but serves no cross-origin header, so the map service is the only feed a
 * browser can read directly.
 */
export function activeStorms(data: OverlayData): ActiveStorm[] {
  const storms: ActiveStorm[] = [];

  for (const feature of data.features) {
    if (feature.properties.kind !== "point") continue;
    // Number(null) is 0, which would read a record with no forecast hour as
    // the storm's current position.
    const tau = feature.properties.tau;
    if (typeof tau !== "number" || tau !== 0) continue;
    const point = pointCoordinates(feature.geometry);
    if (!point) continue;

    const bin = String(feature.properties.bin ?? "").toLowerCase();
    const wind = Number(feature.properties.maxWind);
    storms.push({
      id: bin || `${point[0]},${point[1]}`,
      name: String(feature.properties.name ?? "Unnamed"),
      stormType: String(feature.properties.stormType ?? ""),
      windKt: Number.isFinite(wind) ? wind : 0,
      gustKt: Number(feature.properties.gust) || null,
      pressureMb: Number(feature.properties.pressure) || null,
      lon: point[0],
      lat: point[1],
      advisoryNumber: String(feature.properties.advisory ?? ""),
      advisoryDate: String(feature.properties.advisoryDate ?? ""),
      advisoryUrl: bin ? `https://www.nhc.noaa.gov/graphics_${bin}.shtml` : "",
    });
  }

  return storms.sort((left, right) => right.windKt - left.windKt);
}
