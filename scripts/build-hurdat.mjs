// Turns the two HURDAT2 text files into the compact record the app ships.
//
//   node scripts/build-hurdat.mjs <atlantic.txt> <pacific.txt>
//
// The source files are at https://www.nhc.noaa.gov/data/hurdat/ and are only
// reissued once a year, so the result is committed rather than downloaded on
// every build.
import fs from "node:fs";
import path from "node:path";

const OUTPUT = path.join(process.cwd(), "public", "hurdat.json");

/** Status codes HURDAT2 uses, in the order the app stores them. */
const STATUSES = [
  "TD",
  "TS",
  "HU",
  "EX",
  "SD",
  "SS",
  "LO",
  "WV",
  "DB",
  "ET",
  "PT",
  "ST",
  "TY",
];

function coordinate(text) {
  const value = Number.parseFloat(text);
  if (!Number.isFinite(value)) return null;
  const hemisphere = text.trim().slice(-1).toUpperCase();
  return hemisphere === "S" || hemisphere === "W" ? -value : value;
}

function pointTime(day, time) {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(4, 6));
  const date = Number(day.slice(6, 8));
  const hour = Number(time.slice(0, 2));
  const minute = Number(time.slice(2, 4));
  return Math.floor(Date.UTC(year, month - 1, date, hour, minute) / 1000);
}

/**
 * Accumulated cyclone energy: the sum of the squared maximum winds at each
 * synoptic hour while the storm is at least a tropical storm, in ten-thousands
 * of knots squared.
 */
function accumulatedEnergy(points) {
  let total = 0;
  for (const [time, , , wind, status] of points) {
    if (wind < 34) continue;
    if (!["TS", "HU", "SS"].includes(STATUSES[status])) continue;
    const hour = new Date(time * 1000).getUTCHours();
    if (hour % 6 !== 0) continue;
    total += wind * wind;
  }
  return Math.round((total / 10_000) * 100) / 100;
}

function parseBasin(text, basin) {
  const storms = [];
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    const header = line.split(",").map((part) => part.trim());
    if (header.length < 3 || !/^[A-Z]{2}\d{6}$/.test(header[0])) continue;

    const count = Number(header[2]);
    const points = [];
    for (let step = 1; step <= count; step += 1) {
      const row = (lines[index + step] ?? "").split(",").map((p) => p.trim());
      if (row.length < 7) continue;
      const lat = coordinate(row[4]);
      const lon = coordinate(row[5]);
      const wind = Number(row[6]);
      const status = STATUSES.indexOf(row[3]);
      if (lat === null || lon === null || !Number.isFinite(wind)) continue;
      points.push([
        pointTime(row[0], row[1]),
        Math.round(lat * 10) / 10,
        Math.round(lon * 10) / 10,
        wind < 0 ? 0 : wind,
        status < 0 ? STATUSES.indexOf("LO") : status,
      ]);
    }
    index += count;
    if (!points.length) continue;

    storms.push({
      i: header[0],
      n: header[1] === "UNNAMED" ? "" : header[1],
      y: Number(header[0].slice(4)),
      b: basin,
      a: accumulatedEnergy(points),
      p: points,
    });
  }

  return storms;
}

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

const record = {
  generated: new Date().toISOString().slice(0, 10),
  statuses: STATUSES,
  storms,
};

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(record));
const bytes = fs.statSync(OUTPUT).size;
console.log(
  `${storms.length} storms, ${storms.reduce((sum, storm) => sum + storm.p.length, 0)} points, ${(bytes / 1024 / 1024).toFixed(2)} MB`,
);
