// Turns the two HURDAT2 text files into the compact record the app ships.
//
//   node scripts/build-hurdat.mjs <atlantic.txt> <pacific.txt>
//
// The source files are at https://www.nhc.noaa.gov/data/hurdat/ and are only
// reissued once a year, so the result is committed rather than downloaded on
// every build. The parsing itself lives in scripts/hurdat-parse.mjs, which has
// its own tests.
import fs from "node:fs";
import path from "node:path";
import { STATUSES, parseBasin } from "./hurdat-parse.mjs";

const OUTPUT = path.join(process.cwd(), "public", "hurdat.json");

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
