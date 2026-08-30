/**
 * Builds the tide station index the app ships with.
 *
 * NOAA lists three and a half thousand stations that publish tide
 * predictions, with a good deal of metadata the app has no use for. The
 * nearest-station search has to be instant and has to work with no network,
 * so the list is trimmed to what the search needs and bundled, the way the
 * storm archive is.
 *
 * Run it when NOAA adds or retires stations, which is a handful of times a
 * year: `node scripts/build-tide-stations.mjs`. Commit the result.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE =
  "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions&units=english";

const response = await fetch(SOURCE, {
  headers: { Accept: "application/json" },
});
if (!response.ok) {
  throw new Error(`NOAA returned ${response.status} for the station list.`);
}

const payload = await response.json();
const stations = Array.isArray(payload.stations) ? payload.stations : [];
if (!stations.length) throw new Error("The station list came back empty.");

const trimmed = [];
for (const station of stations) {
  const id = String(station.id ?? "").trim();
  const name = String(station.name ?? "").trim();
  const lat = Number(station.lat);
  const lon = Number(station.lng);
  if (!id || !name) continue;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  trimmed.push({
    id,
    name,
    state: String(station.state ?? "").trim(),
    // Four places is about ten metres, which is far finer than a tide
    // station's own position matters.
    lat: Number(lat.toFixed(4)),
    lon: Number(lon.toFixed(4)),
  });
}

// Sorted so the file is stable between runs and a rebuild that changes nothing
// produces no diff.
trimmed.sort((left, right) => left.id.localeCompare(right.id));

const out = join(process.cwd(), "public", "tide-stations.json");
writeFileSync(out, `${JSON.stringify(trimmed)}\n`);
console.log(`${trimmed.length} stations written to ${out}`);
