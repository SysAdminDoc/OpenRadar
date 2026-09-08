/**
 * The imagery bands a reader can choose between.
 *
 * A leaf with no imports, for the same reason `spcHazards.ts` is one:
 * `settings.ts` needs to know whether a stored band is one the app still
 * offers, and reaching into `lib/providers/` for that put the settings module,
 * which everything depends on, on top of a provider. The rule this keeps is
 * written down in the working notes: nothing `settings.ts` imports may import
 * `settings.ts` back, and the way to be sure of that is to import from
 * something that imports nothing.
 *
 * Not every satellite carries every one of these.
 */
export const SATELLITE_BANDS = [
  "geocolor",
  "clean-ir",
  "red-visible",
  "air-mass",
  "dust",
  "fire-temp",
] as const;

export type SatelliteBandId = (typeof SATELLITE_BANDS)[number];

export function isSatelliteBand(value: unknown): value is SatelliteBandId {
  return SATELLITE_BANDS.includes(value as SatelliteBandId);
}
