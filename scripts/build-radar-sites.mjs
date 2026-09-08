// Rebuilds the table of WSR-88D radars the app offers.
//
//   node scripts/build-radar-sites.mjs
//
// Why the app carries its own table rather than the one in `nexrad-model`:
// that crate's registry is compiled into a release, and radars are
// commissioned, decommissioned and moved between releases. On 2026-09-07 the
// pinned crate still listed KLIX at New Orleans, which had been
// decommissioned and answers 404 from the office with nothing on the archive
// bucket, and it did not list KHDC at Hammond, which replaced it and was
// operating. It also held KCCX twice and put KPBZ seventeen kilometres east
// of where Pittsburgh's radar stands. Upstream had an open issue about all of
// it and no release. A table that says which radars exist is a feed with a
// very long refresh interval, not a fact, so this one is generated from the
// office's own list and held to it by a live contract.
//
// What comes from where, and why it is split:
//
//   membership, coordinates, elevation   api.weather.gov/radar/stations
//   the state a site sits in             api.weather.gov/points/{lat},{lon}
//   the name shown to a reader           the station's own `name`, or the
//                                        label already in the committed table
//
// The two endpoints answer different questions and neither answers both. The
// points lookup returns the nearest populated place, which for KLGX is
// "Copalis Beach" and for KBHX is "Ferndale": true of the ground, wrong as
// the name of a radar people call Langley Hill and Eureka. The station's own
// name is the label, and the points lookup is asked only for the state, which
// the radar station record does not carry at all.
//
// Names already in the committed table are carried forward untouched. The
// first version of this table took them from the crate, so the hundred and
// fifty-six radars that were already there kept the label readers knew, and
// nothing here renames a radar that has not moved.
//
// The three overseas sites the office lists (Kunsan, Camp Humphreys, Kadena)
// are outside the points service, so they carry no state and are written with
// an empty one. `SiteEntry::label` is what deals with that.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AGENT = "OpenRadar (github.com/SysAdminDoc/OpenRadar)";
const OUT = path.join("src-tauri", "src", "level2", "registry_table.rs");

async function nws(url) {
  const answer = await fetch(url, {
    headers: { "User-Agent": AGENT, Accept: "application/geo+json" },
  });
  if (!answer.ok) throw new Error(`${url} answered ${answer.status}`);
  return answer.json();
}

/** The labels already committed, so a radar that has not moved is not renamed. */
export function carriedLabels(source) {
  const found = new Map();
  const rows = source.matchAll(
    /id:\s*"([A-Z0-9]{3,4})",\s*city:\s*"([^"]*)",\s*state:\s*"([^"]*)"/g,
  );
  for (const row of rows) found.set(row[1], { city: row[2], state: row[3] });
  return found;
}

/**
 * A position as an `f32` literal: four decimal places, which is about ten
 * metres, with the padding taken back off.
 *
 * The trailing zeros matter. `-116.2360` and `-116.236` are the same `f32`,
 * and clippy's `excessive_precision` refuses the first for saying a digit the
 * type cannot hold. The decimal point stays, because a bare `40` is an
 * integer literal and will not compile into an `f32` field.
 */
export function degrees(value) {
  const fixed = value.toFixed(4).replace(/0+$/, "");
  return fixed.endsWith(".") ? `${fixed}0` : fixed;
}

/** One row of the generated Rust table. */
export function rowFor(site) {
  const escape = (text) => text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return [
    "    SiteEntry {",
    `        id: "${site.id}",`,
    `        city: "${escape(site.city)}",`,
    `        state: "${escape(site.state)}",`,
    `        latitude: ${degrees(site.latitude)},`,
    `        longitude: ${degrees(site.longitude)},`,
    `        elevation_meters: ${Math.round(site.elevationMeters)},`,
    "    },",
  ].join("\n");
}

async function main() {
  const carried = fs.existsSync(OUT)
    ? carriedLabels(fs.readFileSync(OUT, "utf8"))
    : new Map();

  const listing = await nws(
    "https://api.weather.gov/radar/stations?stationType=WSR-88D",
  );
  const sites = [];
  for (const feature of listing.features) {
    const id = feature.properties.id;
    const [longitude, latitude] = feature.geometry.coordinates;
    const known = carried.get(id);
    let city = known?.city ?? feature.properties.name;
    let state = known?.state ?? "";
    if (!known) {
      try {
        const point = await nws(
          `https://api.weather.gov/points/${latitude},${longitude}`,
        );
        state = point.properties.relativeLocation.properties.state;
      } catch {
        // Outside the points service, which is the three overseas sites.
        state = "";
      }
      await new Promise((wait) => setTimeout(wait, 400));
    }
    sites.push({
      id,
      city,
      state,
      latitude,
      longitude,
      elevationMeters: feature.properties.elevation?.value ?? 0,
    });
  }
  sites.sort((left, right) => left.id.localeCompare(right.id));

  const header = [
    "//! Every WSR-88D the National Weather Service lists, and where it stands.",
    "//!",
    "//! Generated by `node scripts/build-radar-sites.mjs` from",
    "//! `api.weather.gov/radar/stations`. Do not edit by hand: the live",
    "//! contract `the_radar_table_matches_the_office_list` fails the moment",
    "//! this and the office disagree, and the fix is to run the script.",
    "",
    "use super::registry::SiteEntry;",
    "",
    `/// The ${sites.length} radars the office listed when this was last generated.`,
    `pub(crate) static SITES: [SiteEntry; ${sites.length}] = [`,
  ].join("\n");
  fs.writeFileSync(OUT, `${header}\n${sites.map(rowFor).join("\n")}\n];\n`);
  console.log(`${OUT}: ${sites.length} radars`);
}

// Run only when this file is the thing node was pointed at, so importing it
// for its tests does not rebuild the table.
//
// Compared as resolved paths rather than as URL text. On Windows the two
// spellings never match: `import.meta.url` is `file:///C:/repos/...` and a URL
// built from `process.argv[1]` by hand is `file://C:/repos/...`, one slash
// short. That mismatch is silent, and it cost a run of this script that
// reported success while doing nothing at all.
const invokedAs = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedAs && fileURLToPath(import.meta.url) === invokedAs) {
  await main();
}
