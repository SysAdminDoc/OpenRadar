/**
 * The live provider contracts, and the rules for running them.
 *
 * The checks themselves already existed and none of them ran together. The
 * browser half sat behind an environment switch, the native half behind
 * `#[ignore]`, and the release command ran neither, so a provider could change
 * a path or a schema and nothing would say so until somebody opened the app.
 *
 * This is the list of what has to answer, and the small amount of logic worth
 * testing without a network: which contracts exist, what counts as a pass, and
 * whether the run is allowed to happen here at all.
 */

/**
 * Every live contract, one per source family.
 *
 * `required` marks the sources a release depends on. The rest are worth
 * knowing about and are not worth failing a build over: a national mosaic
 * going quiet matters, and a tide station being down for the afternoon does
 * not.
 */
export const LIVE_CONTRACTS = [
  {
    id: "mrms",
    label: "MRMS national grids",
    host: "noaa-mrms-pds.s3.amazonaws.com",
    kind: "native",
    filter: "mrms::tests",
    required: true,
  },
  {
    id: "level2",
    label: "NEXRAD Level II archive",
    host: "unidata-nexrad-level2.s3.amazonaws.com",
    kind: "native",
    filter: "level2::tests",
    required: true,
  },
  {
    id: "chunks",
    label: "NEXRAD Level II live chunks",
    host: "unidata-nexrad-level2-chunks.s3.amazonaws.com",
    kind: "native",
    filter: "chunks::tests",
    required: false,
  },
  {
    id: "level3",
    label: "NEXRAD Level III storm cells",
    host: "unidata-nexrad-level3.s3.amazonaws.com",
    kind: "native",
    filter: "level3::tests",
    required: false,
  },
  {
    id: "lightning",
    label: "GOES lightning",
    host: "noaa-goes19.s3.amazonaws.com",
    kind: "native",
    filter: "lightning::tests",
    required: false,
  },
  {
    id: "gfs",
    label: "GFS wind fields",
    host: "noaa-gfs-bdp-pds.s3.amazonaws.com",
    kind: "native",
    filter: "gfs::tests",
    required: false,
  },
  {
    id: "hrrr-smoke",
    label: "HRRR forecast smoke",
    host: "noaa-hrrr-bdp-pds.s3.amazonaws.com",
    kind: "native",
    filter: "hrrr::tests",
    required: false,
  },
  {
    id: "probsevere",
    label: "NSSL ProbSevere",
    host: "noaa-mrms-pds.s3.amazonaws.com",
    kind: "native",
    filter: "probsevere::tests",
    required: false,
  },
  {
    id: "alerts",
    label: "NWS watches and warnings",
    host: "mapservices.weather.noaa.gov",
    kind: "browser",
    files: ["src/lib/overlays/overlays.test.ts"],
    liveBlock: "against the live warnings service",
    // The one layer a reader might act on, and the only one whose schema
    // changing quietly would matter more than a picture going missing.
    required: true,
  },
  {
    id: "tiles",
    label: "The cached tile scheme, end to end",
    host: "opengeo.ncep.noaa.gov",
    kind: "native",
    filter: "tiles::tests",
    required: false,
  },
  {
    id: "eccc-alerts",
    label: "ECCC public weather alerts",
    host: "api.weather.gc.ca",
    kind: "browser",
    files: ["src/lib/overlays/ecccAlerts.test.ts"],
    liveBlock: "against the live service",
    // Not required to pass: Canada is often quiet, and an empty answer on a
    // clear day is the right answer. What the contract holds is the SHAPE of
    // what comes back, which is the thing that moves without telling anybody.
    required: false,
  },
  {
    id: "rivers",
    label: "NWPS river gauges",
    host: "api.water.noaa.gov",
    kind: "browser",
    files: ["src/lib/overlays/rivers.test.ts"],
    liveBlock: "against the live service",
    // The query needs a coordinate reference the service does not assume, and
    // getting that wrong returns an empty list rather than an error. A quiet
    // day and a broken query look identical without this.
    required: false,
  },
  {
    id: "satellite",
    label: "GOES-East imagery",
    host: "gibs.earthdata.nasa.gov",
    kind: "browser",
    files: ["src/lib/providers/satellite.test.ts"],
    liveBlock: "against the live service",
    // A missing tile is a blank square somebody sees, but a renamed layer or
    // a matrix set that moved is a 400 on every tile, which looks exactly
    // like a quiet sky. The two products are published at different depths,
    // so each has to be asked for itself.
    required: false,
  },
  {
    id: "guidance",
    label: "Open-Meteo model guidance",
    host: "api.open-meteo.com",
    kind: "browser",
    files: ["src/lib/guidance.test.ts"],
    liveBlock: "against Open-Meteo itself",
    required: true,
  },
  {
    id: "spc",
    label: "SPC outlooks and discussions",
    host: "www.spc.noaa.gov",
    kind: "browser",
    files: ["src/lib/overlays/spc.test.ts"],
    liveBlock: "against the live service",
    required: false,
  },
  {
    id: "archive-warnings",
    label: "Archived storm-based warnings",
    host: "mesonet.agron.iastate.edu",
    kind: "browser",
    files: ["src/lib/archiveWarnings.test.ts"],
    liveBlock: "against the live archive",
    required: false,
  },
  {
    id: "reports",
    label: "Local storm reports",
    host: "mesonet.agron.iastate.edu",
    kind: "browser",
    files: ["src/lib/overlays/reports.test.ts"],
    liveBlock: "against the live feed",
    required: false,
  },
  {
    id: "tides",
    label: "NOAA CO-OPS tides",
    host: "api.tidesandcurrents.noaa.gov",
    kind: "browser",
    files: ["src/lib/tides.test.ts"],
    liveBlock: "against NOAA itself",
    required: false,
  },
  {
    id: "metar",
    label: "AWC surface observations",
    host: "aviationweather.gov",
    kind: "browser",
    files: ["src/lib/overlays/metar.test.ts"],
    liveBlock: "against the live service",
    // Airports report whatever the weather is, all day, every day, so this
    // one can insist on an answer rather than on a shape.
    required: false,
  },
  {
    id: "smoke",
    label: "NOAA HMS smoke analysis",
    host: "satepsanone.nesdis.noaa.gov",
    kind: "browser",
    files: ["src/lib/overlays/smoke.test.ts"],
    liveBlock: "against the live analysis",
    // Seasonal, and a clear day is a real answer, so the contract holds the
    // path and the document shape rather than insisting there is smoke.
    required: false,
  },
  {
    id: "surge",
    label: "NHC storm surge risk",
    host: "mapservices.weather.noaa.gov",
    kind: "browser",
    files: ["src/lib/surge.test.ts"],
    liveBlock: "against the National Hurricane Center itself",
    required: false,
  },
];

/**
 * Hosts with no contract of their own, and the reason each one has none.
 *
 * Written down rather than left as a gap, because a host quietly missing from
 * the list above is indistinguishable from a host nobody thought about. A test
 * holds this against the asset ledger: a new host has to arrive with either a
 * contract or a reason.
 */
export const UNCONTRACTED_HOSTS = {
  "previous-runs-api.open-meteo.com":
    "The same service and the same shape as api.open-meteo.com, which does have a contract, reached only while the guidance comparison is switched on. A separate contract would be the same assertion against the same fields.",
  "tiles.openfreemap.org":
    "A basemap. A style or tile that stops answering is visible the instant the map draws, which is a better check than any assertion here.",
  "basemap.nationalmap.gov": "The same, for the aerial style.",
  "tile.opentopomap.org": "The same, for the topographic style.",
  "nowcoast.noaa.gov":
    "The fallback behind the RIDGE mosaic. Reached only when the first choice is already failing, so a contract that exercised it would be asking a spare to work while the main one still does.",
  "geo.weather.gc.ca":
    "Canadian radar, which answers only over Canada. Worth a contract once one exists that can say where it is asking about.",
  "maps.dwd.de": "German radar, for the same reason.",
  "api.rainviewer.com":
    "The worldwide fallback, whose terms are the tightest of the set. Polling it on a schedule to prove it works is the opposite of what those terms ask for.",
  "tilecache.rainviewer.com": "The tiles behind that fallback.",
  "earthquake.usgs.gov":
    "Not weather. A quiet day genuinely returns nothing, so there is no answer a contract could insist on.",
  "services3.arcgis.com":
    "Wildfire perimeters, which are seasonal and regional: an empty answer in February is correct.",
  "api.weather.gov":
    "Reached only to open one alert the reader clicked, so it has no standing query to check.",
  "geocoding-api.open-meteo.com":
    "Place search, which needs a query somebody typed. A fixed one would prove the service answers for that word and nothing else.",
  "valhalla1.openstreetmap.de":
    "Routing. It asks for at most one request a second per user and is run for the public by a volunteer association, so a scheduled check is a cost it should not have to carry for this.",
};

/** How long one contract may take before it is called a failure. */
export const CONTRACT_TIMEOUT_MS = 240_000;

/**
 * How long to wait between contracts.
 *
 * Several of these share a host, and the public services this app reads are
 * run for everybody rather than for this machine. Spacing the requests is the
 * difference between a check and a small flood.
 */
export const CONTRACT_GAP_MS = 1_500;

/**
 * Why this run must not happen, or null when it may.
 *
 * Builds here happen on the machine in front of you, and these contracts reach
 * public services that owe this project nothing. Running them from shared
 * infrastructure would put somebody else's address behind the requests and
 * would turn a courtesy budget into a shared one.
 */
export function refuseToRun(env) {
  if (env.GITHUB_ACTIONS) {
    return "Live contracts never run on GitHub infrastructure.";
  }
  if (env.CI) {
    return "Live contracts never run on shared build infrastructure.";
  }
  return null;
}

/**
 * What a finished contract run means.
 *
 * A runner that exits cleanly having run nothing has skipped, not passed. That
 * distinction is the whole point of reporting three states: a gate that
 * silently runs zero checks and calls itself green is the failure this item
 * exists to prevent.
 */
export function classifyRun({ code, timedOut, ranCount, missingRunner }) {
  // A toolchain this machine does not have is not a provider that is down.
  // Reporting it as a failure would put a red mark against the weather
  // services for something that has nothing to do with them.
  if (missingRunner) return "skip";
  if (timedOut) return "fail";
  if (code !== 0) return "fail";
  if (ranCount === 0) return "skip";
  return "pass";
}

/**
 * Where cargo actually is.
 *
 * rustup installs it under the home directory and does not always leave it on
 * the PATH a spawned process inherits, so calling it by name fails with
 * ENOENT on a machine where the toolchain is perfectly well installed. That
 * would be reported as every native provider failing at once, which is a lie
 * about the weather services rather than a fact about this computer.
 *
 * `exists` is passed in so this can be tested without a filesystem.
 */
export function resolveCargo(env, exists, platform = process.platform) {
  const home = env.CARGO_HOME || env.USERPROFILE || env.HOME;
  const suffix = platform === "win32" ? ".exe" : "";
  if (home) {
    const base = env.CARGO_HOME ? home : `${home}/.cargo`;
    const candidate = `${base}/bin/cargo${suffix}`;
    if (exists(candidate)) return candidate;
  }
  // Nothing found where rustup puts it, so fall back to the plain name and let
  // the PATH answer. A machine that has cargo on the PATH is the normal case
  // everywhere except this one.
  return "cargo";
}

/** How many tests a vitest run reported as actually run. */
export function vitestRanCount(output) {
  // The summary line reads "Tests  3 passed (3)", or "Tests  2 passed | 1
  // skipped (3)", or "Tests  1 failed | 6 passed (7)" when something broke.
  //
  // It has to be found as a whole line, and as the last such line. A failing
  // run prints a "Failed Tests 1" banner above the summary, and searching the
  // output for the first "Tests" finds that banner instead: the number after
  // it is a count of failing files, with no "passed" anywhere near it, so the
  // whole run gets read as having run nothing and reported as skipped.
  const lines = output
    .split("\n")
    .filter((line) => /^\s*Tests\s+\d/.test(line));
  const summary = lines.at(-1);
  if (!summary) return 0;
  const passed = /(\d+)\s+passed/.exec(summary);
  const failed = /(\d+)\s+failed/.exec(summary);
  // Anything that ran, whether or not it agreed with the service. A run whose
  // tests all failed still reached the provider, and calling that a skip would
  // hide the failure behind the friendlier of the two words.
  return Number(passed?.[1] ?? 0) + Number(failed?.[1] ?? 0);
}

/** How many tests a cargo run reported as actually run. */
export function cargoRanCount(output) {
  // "test result: ok. 6 passed; 0 failed; 12 ignored; ..." appears once per
  // target, so every occurrence is summed rather than only the first.
  let total = 0;
  const pattern = /test result: \w+\. (\d+) passed/g;
  let match = pattern.exec(output);
  while (match) {
    total += Number(match[1]);
    match = pattern.exec(output);
  }
  return total;
}

/**
 * The process exit code for a finished set of results.
 *
 * Only a required contract can fail the run. A skip is never a failure: a
 * machine with no network should say so plainly rather than pretending the
 * providers are broken.
 */
export function exitCodeFor(results) {
  // A required contract has to have actually passed. Failing it is the obvious
  // case; skipping it is the quiet one, and it was letting the run go green
  // with the two sources a release depends on never asked at all, whether
  // because cargo was missing or because a filter had stopped matching. A
  // provider that was not checked is not a provider that is working.
  const unproven = results.filter(
    (result) => result.required && result.status !== "pass",
  );
  return unproven.length > 0 ? 1 : 0;
}

/** The whole run as one JSON-shaped object, for anything reading this. */
export function summarize(results, startedAt, finishedAt) {
  return {
    tool: "openradar-live-contracts",
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
    counts: {
      pass: results.filter((result) => result.status === "pass").length,
      fail: results.filter((result) => result.status === "fail").length,
      skip: results.filter((result) => result.status === "skip").length,
    },
    contracts: results,
  };
}
