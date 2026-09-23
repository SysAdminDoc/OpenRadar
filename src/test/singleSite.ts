import type { Level2ProductId, SweepImage } from "../lib/level2";
import { DEFAULT_SETTINGS, type RadarSettings } from "../lib/settings";
import {
  isTdwrStation,
  TDWR_LONG_RANGE_KM,
  TDWR_RANGE_KM,
} from "../lib/radarKinds";
import { sweepImage } from "./sweepImage";

/**
 * What the suites for `useSingleSiteRadar` share: the sites they stand in
 * for, the sweep each would answer with, the options the hook is handed, and
 * the spies' starting answers.
 *
 * The spies themselves and the module mocks stay in each suite, because a
 * mock factory is hoisted per file and has to close over that file's own
 * spies.
 */

// The box each of these is asked for travels with them, because whether a
// historical sweep follows the reader's zoom is a property of the argument and
// nothing could see it while the spies dropped it.
export type Box = [number, number, number, number] | null;

/**
 * Where each site in these tests reaches, as its own answer would say.
 *
 * Every station shared one set of corners until 2026-09-08, which made every
 * box legal on every disc: a sweep measured against the wrong station was
 * indistinguishable from one measured properly, and collapsing the whole
 * per-site record to a single entry left all twenty-six cases green.
 *
 * They overlap and all three contain the map centre these tests use, which is
 * the shape that made the defect possible: two discs that overlap in both
 * axes clip to a sliver of the intersection rather than missing outright. The
 * origins differ, and the box centre snaps to a grid anchored at the disc's
 * own west edge, so the same camera on two of these produces two different
 * boxes. That difference is what the assertions read.
 */
// The reach and the gate travel with the corners, because how far the box may
// be narrowed is now read off the sweep rather than taken as a share of the
// disc, and a terminal radar's 150 metre bins run out of detail at a
// different depth than a quarter kilometre gate does.
export const DISCS: Record<
  string,
  {
    west: number;
    south: number;
    east: number;
    north: number;
    rangeKm: number;
    gateKm: number;
  }
> = {
  KDMX: {
    west: -96.5,
    south: 39.6,
    east: -91,
    north: 43.8,
    rangeKm: 230,
    gateKm: 0.25,
  },
  KTLX: {
    west: -96.1,
    south: 39.4,
    east: -90.6,
    north: 43.6,
    rangeKm: 230,
    gateKm: 0.25,
  },
  KVNX: {
    west: -95.7,
    south: 39.2,
    east: -90.2,
    north: 43.4,
    rangeKm: 230,
    gateKm: 0.25,
  },
  // Atlanta's terminal radar, at its own reach rather than a WSR-88D's: 88.8
  // km against 230, which is what makes it a different instrument rather than
  // a differently named one. Without an entry here the fixture threw on the
  // spread below, so no sweep ever landed for a terminal radar and the live
  // path's own handling of one was never reached by anything.
  TATL: {
    west: -85.2202,
    south: 32.8492,
    east: -83.3037,
    north: 34.4446,
    rangeKm: TDWR_RANGE_KM,
    gateKm: 0.15,
  },
};

/**
 * The same site's corners at the long range product's reach.
 *
 * Scaled off the base disc rather than written out, so the two stay the same
 * circle around the same radar however the base entry moves.
 */
export function longRange(station: string) {
  const disc = DISCS[station];
  const grow = TDWR_LONG_RANGE_KM / TDWR_RANGE_KM;
  const lon = (disc.west + disc.east) / 2;
  const lat = (disc.south + disc.north) / 2;
  const wide = ((disc.east - disc.west) / 2) * grow;
  const tall = ((disc.north - disc.south) / 2) * grow;
  return {
    west: lon - wide,
    east: lon + wide,
    south: lat - tall,
    north: lat + tall,
  };
}

export function sweepFor(
  station: string,
  product: Level2ProductId,
  tilt: number,
): SweepImage {
  return sweepImage({
    station,
    productId: product,
    product: product === "velocity" ? "Velocity" : "Reflectivity",
    unit: product === "velocity" ? "m/s" : "dBZ",
    elevationDegrees: [0.48, 0.87, 1.31][tilt] ?? 0.48,
    tiltIndex: tilt,
    collected: new Date().toISOString(),
    // Its own disc, which every station shared until 2026-09-08. A shared one
    // made every box legal on every site's reach, so a sweep measured against
    // the wrong station's disc was indistinguishable from one measured
    // properly: collapsing the whole per-site record to a single entry left
    // all twenty-six cases green.
    ...DISCS[station],
    siteLon: (DISCS[station].west + DISCS[station].east) / 2,
    siteLat: (DISCS[station].south + DISCS[station].north) / 2,
    volume: `${station}-${product}-${tilt}`,
    // What the site is, not what the caller asked for. A terminal radar has
    // no Level II volume and reads from its Level III products, and a fixture
    // that called one a WSR-88D would let a test pass on a picture the app
    // could never have been given. Every field the native side writes
    // differently for one is written differently here: the source it names,
    // the site's own name, and the live half it does not have. A WSR-88D is
    // what the shared sweep already is.
    ...(isTdwrStation(station)
      ? {
          radar: "TDWR" as const,
          // Its two products are two discs, and the fixture said they were
          // one: every terminal sweep claimed 88.8 kilometres of reach on 150
          // metre bins whichever product was asked for. That is the lie that
          // let a record holding one product's ground be handed to the other
          // without a single case going red.
          ...(product === "long-range-reflectivity"
            ? {
                rangeKm: TDWR_LONG_RANGE_KM,
                gateKm: 0.3,
                ...longRange(station),
              }
            : { rangeKm: TDWR_RANGE_KM, gateKm: 0.15 }),
          siteName: "Atlanta, GA",
          live: false,
          liveTilts: 0,
          source: {
            kind: "recent" as const,
            label: "NOAA NEXRAD Level III (TDWR)",
            url: "https://registry.opendata.aws/noaa-nexrad/",
          },
        }
      : {}),
  });
}

export const radar: RadarSettings = {
  ...DEFAULT_SETTINGS.radar,
  singleSite: true,
  station: null,
};

export function options(overrides: {
  center?: [number, number];
  radar?: Partial<RadarSettings>;
  showingTime?: number | null;
  compareTime?: number | null;
  zoom?: number;
  windowPx?: number;
}) {
  return {
    ready: true,
    radar: { ...radar, ...overrides.radar },
    center: overrides.center ?? ([-93.7, 41.7] as [number, number]),
    zoom: overrides.zoom ?? 9,
    // The width the chromium project runs at, so the box a case gets is the
    // one that project would draw. Coverage depends on the window as well as
    // the zoom, so a case that left this to chance would answer differently
    // under a different harness.
    windowPx: overrides.windowPx ?? 1440,
    pageVisible: true,
    paletteGeneration: 0,
    showingTime: overrides.showingTime ?? null,
    compareTime: overrides.compareTime ?? null,
  };
}

/**
 * What arming asks of a spy, and nothing more.
 *
 * Written out rather than taken from the test runner's own type, because this
 * file sits in `src` and the release check reads every import there as one
 * the app ships with: the runner's name on a type line was enough to fail it.
 */
interface Spy<Call extends (...args: never[]) => unknown> {
  mockReset(): unknown;
  mockResolvedValue(value: Awaited<ReturnType<Call>>): unknown;
  mockImplementation(implementation: Call): unknown;
}

/** The spies a suite declares, handed over so they can be armed alike. */
export interface SingleSiteSpies {
  nearestSite: Spy<(lon: number, lat: number) => Promise<string | null>>;
  fetchSweep: Spy<
    (
      station: string,
      product: Level2ProductId,
      tilt: number,
      live: boolean,
    ) => Promise<SweepImage>
  >;
  fetchArchiveSweep: Spy<
    (
      station: string,
      at: string,
      product: Level2ProductId,
      tilt: number,
      within: Box,
    ) => Promise<SweepImage>
  >;
  fetchLocalSweep: Spy<
    (
      path: string,
      product: Level2ProductId,
      tilt: number,
      within: Box,
    ) => Promise<SweepImage>
  >;
  pickArchiveFile: Spy<() => Promise<string | null>>;
  recentVolumeTimes: Spy<(station: string, count: number) => Promise<number[]>>;
  exportVolumeFile: Spy<
    (request: { station: string; volume: string }) => Promise<unknown>
  >;
}

/** Every spy back to the answers each case starts from. */
export function armSingleSiteSpies(spies: SingleSiteSpies): void {
  spies.nearestSite.mockReset();
  spies.fetchSweep.mockReset();
  spies.fetchArchiveSweep.mockReset();
  spies.fetchLocalSweep.mockReset();
  spies.pickArchiveFile.mockReset();
  spies.recentVolumeTimes.mockReset();
  spies.recentVolumeTimes.mockResolvedValue([]);
  spies.exportVolumeFile.mockReset();
  spies.exportVolumeFile.mockResolvedValue({});
  spies.nearestSite.mockResolvedValue("KDMX");
  spies.fetchSweep.mockImplementation(async (station, product, tilt, live) => ({
    ...sweepFor(station, product, tilt),
    // A terminal radar publishes no chunk stream, so it never comes back live
    // whatever was asked for: the native side writes `live: false` on every
    // one of its sweeps. Spreading the request over it said otherwise, which
    // is the same shape of fixture lie as the source label that said Level II.
    ...(isTdwrStation(station) ? {} : { live }),
  }));
  spies.fetchArchiveSweep.mockImplementation(
    async (station, _at, product, tilt) => ({
      ...sweepFor(station, product, tilt),
      collected: "2021-12-10T03:15:00.000Z",
      source: {
        kind: "archive",
        label: "NOAA NEXRAD Level II archive",
        url: "https://registry.opendata.aws/noaa-nexrad/",
      },
    }),
  );
  spies.fetchLocalSweep.mockImplementation(async (_path, product, tilt) => ({
    ...sweepFor("KTLX", product, tilt),
    collected: "2013-05-20T20:56:00.000Z",
    source: { kind: "local", label: "KTLX20130520_205600_V06", url: null },
  }));
  spies.pickArchiveFile.mockResolvedValue("C:\\radar\\KTLX20130520_205600_V06");
}
