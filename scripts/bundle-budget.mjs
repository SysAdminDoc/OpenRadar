/**
 * What the built app is allowed to weigh.
 *
 * A bundle grows a few kilobytes at a time and nobody notices until the cold
 * open is slow, so the size is a gate rather than a number somebody looks at
 * occasionally. Run after `vite build`; it reads what is actually in `dist`.
 *
 * The budgets below are deliberately close to what the app weighs today. A
 * change that needs more room is a change worth a sentence about why, which is
 * what editing this file makes somebody write.
 *
 *   npm run build && node scripts/bundle-budget.mjs
 *
 * `node scripts/bundle-report.mjs` says what is inside a chunk when one of
 * these fails.
 */
import { gzipSync } from "node:zlib";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ASSETS = resolve(process.cwd(), "dist", "assets");

/**
 * One budget per chunk that matters, in kilobytes of the file itself and of
 * what the network actually carries.
 *
 * Measured 2026-08-31. The main chunk is 77 per cent MapLibre GL and React DOM
 * by module bytes, both of which are on the path to the first interactive map,
 * so there is no split available that does not put the map behind a second
 * download. What is left of it is under 300 kB of application code, and the
 * panels, the export encoders and the storm archive are already in chunks of
 * their own that are only fetched when a reader opens them. So is each
 * translation, every one of which is as long again as the English, and only
 * the one a reader asks for is fetched.
 */
const BUDGETS = [
  {
    name: "main",
    match: /^index-.*\.js$/,
    // MapLibre GL, React DOM, and the map itself.
    raw: 1500,
    gzip: 430,
  },
  {
    name: "map worker",
    match: /^maplibre-gl-worker-.*\.js$/,
    // MapLibre's own worker, loaded beside the map rather than inside it.
    raw: 680,
    gzip: 165,
  },
  {
    name: "panels",
    match: /^PanelSurfaces-.*\.js$/,
    // Every panel the command bar opens, fetched on the first one opened.
    raw: 140,
    gzip: 40,
    // Which is to say: not before the map is interactive. It is behind a
    // `lazy` and a `Suspense` in App.tsx and nothing on the way to a first
    // frame touches it, so counting it in the first load was measuring
    // something else and charging the map for it.
    firstLoad: false,
  },
  {
    name: "styles",
    match: /^index-.*\.css$/,
    raw: 160,
    gzip: 26,
  },
];

/**
 * Everything the browser has to fetch before the map is interactive.
 *
 * The chunks marked `firstLoad: false` above are not in it. The worker is,
 * because the map asks for it on the way to its first frame.
 */
const FIRST_LOAD_GZIP_KB = 600;

function kilobytes(bytes) {
  return Math.round(bytes / 1024);
}

let files;
try {
  files = readdirSync(ASSETS);
} catch {
  console.error(
    `No build to measure at ${ASSETS}. Run \`npm run build\` first.`,
  );
  process.exit(1);
}

const rows = [];
const failures = [];
let firstLoadGzip = 0;

for (const budget of BUDGETS) {
  const found = files.filter((file) => budget.match.test(file));
  if (found.length !== 1) {
    failures.push(
      `${budget.name}: expected exactly one file matching ${budget.match}, found ${found.length}. ` +
        `A renamed or split chunk needs its budget updating rather than skipping.`,
    );
    continue;
  }
  const path = join(ASSETS, found[0]);
  const bytes = readFileSync(path);
  const raw = kilobytes(statSync(path).size);
  const gzip = kilobytes(gzipSync(bytes).length);
  rows.push({ name: budget.name, file: found[0], raw, gzip, budget });
  // The worker is fetched by the map rather than by the page, and it is on the
  // way to the first frame either way. A chunk behind a `lazy` is not.
  if (budget.firstLoad !== false) firstLoadGzip += gzip;
  if (raw > budget.raw) {
    failures.push(
      `${budget.name} is ${raw} kB, over its ${budget.raw} kB budget.`,
    );
  }
  if (gzip > budget.gzip) {
    failures.push(
      `${budget.name} is ${gzip} kB gzipped, over its ${budget.gzip} kB budget.`,
    );
  }
}

const width = Math.max(...rows.map((row) => row.name.length), 5);
console.log("chunk".padEnd(width), "     raw    gzip   budget");
for (const row of rows) {
  console.log(
    row.name.padEnd(width),
    `${String(row.raw).padStart(6)} kB`,
    `${String(row.gzip).padStart(4)} kB`,
    `${String(row.budget.gzip).padStart(5)} kB`,
  );
}
console.log(
  "first load".padEnd(width),
  " ".repeat(9),
  `${String(firstLoadGzip).padStart(4)} kB`,
  `${String(FIRST_LOAD_GZIP_KB).padStart(5)} kB`,
);

if (firstLoadGzip > FIRST_LOAD_GZIP_KB) {
  failures.push(
    `the first load is ${firstLoadGzip} kB gzipped, over its ${FIRST_LOAD_GZIP_KB} kB budget.`,
  );
}

if (failures.length) {
  console.error("\nOver budget:");
  for (const failure of failures) console.error(`  ${failure}`);
  console.error(
    "\nRun `node scripts/bundle-report.mjs` to see what is inside the chunk.",
  );
  process.exit(1);
}

console.log("\nEvery chunk is inside its budget.");
