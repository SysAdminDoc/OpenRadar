/**
 * How far back a rotation track reaches, and which shear layer is drawn.
 *
 * MRMS publishes the track over five windows and the merged shear at two
 * heights. Both are one switch with a choice beside it rather than five and
 * two switches: they are the same measurement over different windows or
 * heights, only one of each can be drawn at a time, and the grid cache is told
 * as much, so it is not asked to hold slots for grids that can never be
 * resident together.
 *
 * On its own, and importing nothing, because both the settings and the MRMS
 * provider need these and the provider already imports the settings. Same
 * shape as `gaugeQpe.ts`, for the same reason.
 */

export const ROTATION_PERIODS = ["30m", "1h", "2h", "4h", "24h"] as const;

export type RotationPeriod = (typeof ROTATION_PERIODS)[number];

export function isRotationPeriod(value: unknown): value is RotationPeriod {
  return ROTATION_PERIODS.includes(value as RotationPeriod);
}

/**
 * Which slab of the storm the merged shear is measured through.
 *
 * The low one is what a tornado warning is argued from; the mid one is where a
 * mesocyclone is deep enough to matter. WDTD reads mid-level shear at or above
 * 0.01 per second as a deep mesocyclone.
 */
export const AZ_SHEAR_LEVELS = ["low", "mid"] as const;

export type AzShearLevel = (typeof AZ_SHEAR_LEVELS)[number];

export function isAzShearLevel(value: unknown): value is AzShearLevel {
  return AZ_SHEAR_LEVELS.includes(value as AzShearLevel);
}
