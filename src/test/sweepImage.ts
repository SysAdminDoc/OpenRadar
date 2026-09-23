import type { SweepImage } from "../lib/level2";

/**
 * A drawn sweep for a test to read: the Des Moines radar's lowest
 * reflectivity cut out of the archive, with nothing done to it.
 *
 * Three suites wrote out their own, field by field, so every field the native
 * side started sending had to be added three times before the type would
 * check, and each copy was one more place for a flag to be set that no test
 * meant to set. A suite now spreads what it is about over this.
 */
export function sweepImage(overrides: Partial<SweepImage> = {}): SweepImage {
  return {
    station: "KDMX",
    siteName: "Des Moines, IA",
    productId: "reflectivity",
    paletteApplied: false,
    highContrast: false,
    smoothed: false,
    dealiased: false,
    hasDebris: false,
    hasSpike: false,
    echoTopped: false,
    unplacedShare: 0,
    live: false,
    liveTilts: 0,
    liveFailed: null,
    nextChunkAt: null,
    volumeEndsAt: null,
    stormMotion: null,
    hailHeights: null,
    product: "Reflectivity",
    unit: "dBZ",
    elevationDegrees: 0.48,
    tilts: [0.48, 0.87, 1.31],
    tiltIndex: 0,
    collected: "2026-08-30T09:21:59+00:00",
    beneathCollected: null,
    west: -96.5,
    south: 39.6,
    east: -91.0,
    north: 43.8,
    siteLon: -93.75,
    siteLat: 41.7,
    image: "data:image/png;base64,AAAA",
    volume: "2026/08/30/KDMX/KDMX20260830_092159_V06",
    radar: "WSR-88D",
    rangeKm: 230,
    gateKm: 0.25,
    source: {
      kind: "recent",
      label: "NOAA NEXRAD Level II",
      url: "https://registry.opendata.aws/noaa-nexrad/",
    },
    ...overrides,
  };
}
