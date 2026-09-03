/**
 * Builds the county and state outlines the app ships with.
 *
 * Warnings and storm reports are read by county: "a tornado warning for
 * Polk, Dallas and Story" means nothing on a map with no county lines on it.
 * Every other radar application draws them and this one could not.
 *
 * The Census publishes cartographic boundary files, which are the generalised
 * outlines meant for exactly this rather than the survey-accurate ones. The
 * KML build is taken rather than the shapefile because it is text: no binary
 * geometry reader, and the same coordinate blocks the smoke layer already
 * knows how to read.
 *
 * Run it when the Census publishes a new vintage, which is once a year:
 * `node scripts/build-counties.mjs`. Commit the result.
 */
import { inflateRawSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const VINTAGE = 2024;
const SOURCE = `https://www2.census.gov/geo/tiger/GENZ${VINTAGE}/kml/cb_${VINTAGE}_us_county_20m.zip`;

/** The most a bundled outline is allowed to cost on disk. */
const MAX_BYTES = 1024 * 1024;

/**
 * How far a point may be moved to drop it, in degrees.
 *
 * The 20m file is already generalised for a national view; this takes out the
 * points that survived it and still cannot be seen. About a hundred metres,
 * which is a third of a pixel at the zoom where county lines start to matter.
 */
const TOLERANCE = 0.001;

/** Coordinates are written to this many decimals, which is about ten metres. */
const PLACES = 4;

/**
 * Reads a zip from its central directory.
 *
 * The directory is authoritative about sizes; a local header may leave them
 * for a trailing descriptor, which is what makes the naive read of the first
 * entry work on some files and silently truncate others.
 */
function unzip(buffer) {
  const end = findEndOfDirectory(buffer);
  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  const files = new Map();
  for (let entry = 0; entry < count; entry += 1) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) {
      throw new Error(`the central directory entry ${entry} is not one`);
    }
    const method = buffer.readUInt16LE(at + 10);
    const compressed = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const offset = buffer.readUInt32LE(at + 42);
    const name = buffer.toString("utf8", at + 46, at + 46 + nameLength);

    // The local header's own name and extra lengths, which differ from the
    // directory's and are what the data actually starts after.
    if (buffer.readUInt32LE(offset) !== 0x04034b50) {
      throw new Error(`${name} does not start with a local header`);
    }
    const localName = buffer.readUInt16LE(offset + 26);
    const localExtra = buffer.readUInt16LE(offset + 28);
    const start = offset + 30 + localName + localExtra;
    const body = buffer.subarray(start, start + compressed);
    if (method === 0) files.set(name, body);
    else if (method === 8) files.set(name, inflateRawSync(body));
    else throw new Error(`${name} is compressed a way this cannot read`);

    at += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function findEndOfDirectory(buffer) {
  // The record is 22 bytes plus a comment of up to 64k, so it is found by
  // walking back from the end rather than by seeking.
  for (let at = buffer.length - 22; at >= 0; at -= 1) {
    if (buffer.readUInt32LE(at) === 0x06054b50) return at;
  }
  throw new Error("this is not a zip file");
}

/** Every ring in the document, as arrays of [lon, lat]. */
function rings(kml) {
  const found = [];
  const pattern = /<coordinates>([\s\S]*?)<\/coordinates>/g;
  let match;
  while ((match = pattern.exec(kml)) !== null) {
    const ring = [];
    for (const point of match[1].trim().split(/\s+/)) {
      const [lon, lat] = point.split(",").map(Number);
      if (Number.isFinite(lon) && Number.isFinite(lat)) ring.push([lon, lat]);
    }
    if (ring.length > 3) found.push(ring);
  }
  return found;
}

/**
 * Douglas-Peucker, iteratively.
 *
 * Iteratively because a few of these rings are tens of thousands of points
 * long and the recursive form runs out of stack on them.
 */
function simplify(ring, tolerance) {
  if (ring.length < 3) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = 1;
  keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let furthest = -1;
    let worst = tolerance;
    for (let at = first + 1; at < last; at += 1) {
      const away = perpendicular(ring[at], ring[first], ring[last]);
      if (away > worst) {
        worst = away;
        furthest = at;
      }
    }
    if (furthest > 0) {
      keep[furthest] = 1;
      stack.push([first, furthest], [furthest, last]);
    }
  }
  return ring.filter((_, at) => keep[at]);
}

function perpendicular(point, from, to) {
  const [x, y] = point;
  const [x1, y1] = from;
  const [x2, y2] = to;
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(x - x1, y - y1);
  const along = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
  const held = Math.max(0, Math.min(1, along));
  return Math.hypot(x - (x1 + held * dx), y - (y1 + held * dy));
}

const round = (value) => Number(value.toFixed(PLACES));

const response = await fetch(SOURCE);
if (!response.ok) {
  throw new Error(`the Census returned ${response.status} for ${SOURCE}`);
}
const archive = Buffer.from(await response.arrayBuffer());
const files = unzip(archive);
const kml = [...files.entries()].find(([name]) => name.endsWith(".kml"));
if (!kml) throw new Error("the archive holds no KML");

const outlines = [];
let points = 0;
for (const ring of rings(kml[1].toString("utf8"))) {
  const thinned = simplify(ring, TOLERANCE).map(([lon, lat]) => [
    round(lon),
    round(lat),
  ]);
  if (thinned.length < 3) continue;
  points += thinned.length;
  outlines.push(thinned);
}
if (outlines.length < 3000) {
  throw new Error(`only ${outlines.length} outlines, which is not the country`);
}

// One feature holding every outline, because nothing asks a county line a
// question: it is drawn and that is all. A feature apiece would be three
// thousand of them for the map to keep track of.
const collection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { source: `US Census cartographic boundaries ${VINTAGE}` },
      geometry: { type: "MultiLineString", coordinates: outlines },
    },
  ],
};

const body = JSON.stringify(collection);
// Measured in bytes rather than characters, and refused before anything is
// written: a script that writes the file and then complains has still left an
// over-budget asset on disk for somebody to commit.
const bytes = Buffer.byteLength(body);
if (bytes > MAX_BYTES) {
  throw new Error(
    `counties.json would be ${(bytes / 1024).toFixed(0)} kB, past the ${MAX_BYTES / 1024} kB it is allowed. Raise TOLERANCE and run it again.`,
  );
}
const path = join(process.cwd(), "public", "counties.json");
writeFileSync(path, body);
console.log(
  `${outlines.length} outlines, ${points} points, ${(bytes / 1024).toFixed(0)} kB`,
);
