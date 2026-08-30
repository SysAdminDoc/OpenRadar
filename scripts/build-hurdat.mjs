// Turns the two HURDAT2 text files into the record the app ships.
//
//   node scripts/build-hurdat.mjs <atlantic.txt> <pacific.txt>
//
// The source files are at https://www.nhc.noaa.gov/data/hurdat/ and are only
// reissued once a year, so the result is committed rather than downloaded on
// every build. The parsing itself lives in scripts/hurdat-parse.mjs, which has
// its own tests.
//
// The output is split, because the whole record is nearly three megabytes and
// opening the History panel used to read all of it before the search box would
// answer. What a search needs is a name and a year; what it does not need is a
// hundred and seventy years of six-hourly positions. So:
//
//   public/hurdat/index.json      every storm, no track, as plain arrays
//   public/hurdat/<decade>.json   the tracks, keyed by storm, ten years apart
//
// A storm's own decade is fetched when someone picks it, and kept for the rest
// of the session.
import fs from "node:fs";
import path from "node:path";
import { STATUSES, parseBasin } from "./hurdat-parse.mjs";

const OUTPUT_DIR = path.join(process.cwd(), "public", "hurdat");

const [atlanticPath, pacificPath] = process.argv.slice(2);
if (!atlanticPath || !pacificPath) {
  console.error(
    "usage: node scripts/build-hurdat.mjs <atlantic.txt> <pacific.txt>",
  );
  process.exit(1);
}

const storms = [
  ...parseBasin(fs.readFileSync(atlanticPath, "utf8"), "AL"),
  ...parseBasin(fs.readFileSync(pacificPath, "utf8"), "EP"),
].sort((left, right) => right.y - left.y || left.i.localeCompare(right.i));

/** The decade a storm belongs to, which is the file its track lives in. */
function decadeOf(year) {
  return Math.floor(year / 10) * 10;
}

// One row per storm: id, name, ACE, peak wind, first and last fix in whole
// seconds, and how many fixes there are. The year and basin are not stored
// because the id already carries both.
const index = storms.map((storm) => [
  storm.i,
  storm.n,
  storm.a,
  storm.p.reduce((peak, point) => Math.max(peak, point[3]), 0),
  storm.p[0][0],
  storm.p[storm.p.length - 1][0],
  storm.p.length,
]);

const tracks = new Map();
for (const storm of storms) {
  const decade = decadeOf(storm.y);
  if (!tracks.has(decade)) tracks.set(decade, {});
  tracks.get(decade)[storm.i] = storm.p;
}

fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(
  path.join(OUTPUT_DIR, "index.json"),
  JSON.stringify({
    generated: new Date().toISOString().slice(0, 10),
    statuses: STATUSES,
    storms: index,
  }),
);
for (const [decade, byId] of tracks) {
  fs.writeFileSync(
    path.join(OUTPUT_DIR, `${decade}.json`),
    JSON.stringify(byId),
  );
}

const indexBytes = fs.statSync(path.join(OUTPUT_DIR, "index.json")).size;
const trackBytes = [...tracks.keys()].reduce(
  (sum, decade) =>
    sum + fs.statSync(path.join(OUTPUT_DIR, `${decade}.json`)).size,
  0,
);
console.log(
  `${storms.length} storms, ${storms.reduce((sum, storm) => sum + storm.p.length, 0)} points`,
);
console.log(
  `index ${(indexBytes / 1024).toFixed(0)} KB, ${tracks.size} decade files totalling ${(trackBytes / 1024 / 1024).toFixed(2)} MB`,
);
