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
import {
  budgetTable,
  firstLoadFailure,
  measureChunks,
  measureStatic,
} from "./bundle-budget-lib.mjs";

const ASSETS = resolve(process.cwd(), "dist", "assets");
const DIST = resolve(process.cwd(), "dist");

/**
 * What the page asks for that is not a built chunk.
 *
 * `public/` is copied to the root of `dist` rather than into `assets`, so
 * anything there was outside every budget below and outside the first-load
 * total: the two icons `index.html` declares added twenty-four kilobytes to a
 * cold load that no gate measured. Only what the pages actually reference,
 * because the same folder holds the data files a layer fetches when the
 * reader turns it on, and those are not part of opening the app.
 */
const STATIC_FIRST_LOAD = ["favicon.png", "openradar-128.png"];
const STATIC_GZIP_KB = 30;
// PNG is already deflated, so gzipping it again buys nothing and can cost a
// kilobyte. Raw is the number that actually moves when somebody re-exports an
// icon at a larger size, and it was going unbudgeted while the gzip figure was
// printed in its column.
const STATIC_RAW_KB = 30;

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
    match: /^main-.*\.js$/,
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
    // Every panel the command bar opens except the ones in their own modules,
    // fetched on the first one opened. Reclaimed after each split rather than
    // left at the old number: a budget with fifty kilobytes of room in it is
    // not a budget, and the point of moving the weight out was to keep it out.
    //
    // 105 and 29 held the chunk at exactly a hundred per cent of both, so
    // every change to any panel had to find its own bytes back somewhere else
    // before it could land. The forecast models, the storm archive, the tides,
    // the hurricane season and a route along a drive went to their own chunks
    // on 2026-09-08, which took it to 73 and 20. These leave about a tenth
    // free, which is room for an honest change and not room to drift back.
    raw: 82,
    gzip: 23,
    // Which is to say: not before the map is interactive. It is behind a
    // `lazy` and a `Suspense` in App.tsx and nothing on the way to a first
    // frame touches it, so counting it in the first load was measuring
    // something else and charging the map for it.
    firstLoad: false,
  },
  {
    name: "settings",
    match: /^SettingsPanel-.*\.js$/,
    // Settings on its own, fetched when it is opened. It is the largest panel
    // in the app by a distance: the watch, the themes, the record with its
    // figures, the year card, the sounds, the curiosities and the incident
    // packs are all in it.
    //
    // The three map-options panels shared one module until 2026-09-04, and
    // that module went over the 70 kB this line used to carry. The comment
    // then said that reaching the budget would mean the settings panel had
    // stopped being one panel; what it had actually stopped being is one
    // panel's worth of module, because opening Layers fetched Settings too.
    // A module each is the split, and each one is now budgeted on its own
    // measurement.
    raw: 56,
    gzip: 14,
    firstLoad: false,
  },
  {
    name: "layers",
    match: /^LayersPanel-.*\.js$/,
    // The layer switches and their segmented controls, fetched when the
    // layers panel is opened. Adding a switch group lands here.
    raw: 26,
    gzip: 6,
    firstLoad: false,
  },
  {
    name: "map type",
    match: /^MapTypePanel-.*\.js$/,
    // Two projection buttons and the basemap cards. It is this small because
    // the style list lives in `src/lib/mapStyles.ts`; if it grows past a few
    // kilobytes it has taken on work that belongs somewhere else.
    raw: 4,
    gzip: 2,
    firstLoad: false,
  },
  {
    name: "glance",
    match: /^glance-.*\.js$/,
    // The small window's own entry. It shows a picture the workspace already
    // drew and four lines of text, and the whole point of it being a second
    // page is that it does not carry MapLibre: if this ever approaches the
    // workspace's size, it has started drawing its own map.
    raw: 8,
    gzip: 4,
    firstLoad: false,
  },
  {
    name: "glance styles",
    match: /^glance-.*\.css$/,
    raw: 4,
    gzip: 2,
    firstLoad: false,
  },
  {
    // 2026-09-05: raw 160 to 164, and the gzip figure deliberately left where
    // it was. Four fixes added about a kilobyte of rules between them: the
    // full-screen readout's ink over a light basemap, the map's own ground as
    // a token per theme, the tool rail's paging chevrons, and the compare
    // card's move out from under the zoom stack and an open panel. What a
    // reader downloads did not change at all, which is the number the gzip
    // budget holds and the reason this is a note rather than a feature being
    // let through: at 25 against 26 there is no room in that one either.
    name: "styles",
    match: /^main-.*\.css$/,
    raw: 164,
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

let files;
try {
  files = readdirSync(ASSETS);
} catch {
  console.error(
    `No build to measure at ${ASSETS}. Run \`npm run build\` first.`,
  );
  process.exit(1);
}

const measured = measureChunks({
  files,
  budgets: BUDGETS,
  sizeOf: (file) => statSync(join(ASSETS, file)).size,
  gzipOf: (file) => gzipSync(readFileSync(join(ASSETS, file))).length,
});

const still = measureStatic({
  names: STATIC_FIRST_LOAD,
  read: (name) => readFileSync(join(DIST, name)),
  gzipOf: (_name, bytes) => gzipSync(bytes).length,
  rawKb: STATIC_RAW_KB,
  gzipKb: STATIC_GZIP_KB,
});

const rows = [...measured.rows, still.row];
const firstLoadGzip = measured.firstLoadGzip + still.row.gzip;
const failures = [...measured.failures, ...still.failures];

for (const line of budgetTable(rows, firstLoadGzip, FIRST_LOAD_GZIP_KB)) {
  console.log(line);
}

const late = firstLoadFailure(firstLoadGzip, FIRST_LOAD_GZIP_KB);
if (late) failures.push(late);

if (failures.length) {
  console.error("\nOver budget:");
  for (const failure of failures) console.error(`  ${failure}`);
  console.error(
    "\nRun `node scripts/bundle-report.mjs` to see what is inside the chunk.",
  );
  process.exit(1);
}

console.log("\nEvery chunk is inside its budget.");
