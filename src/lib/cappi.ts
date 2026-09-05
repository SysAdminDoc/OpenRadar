/**
 * The merged grid, read at a height rather than as a column.
 *
 * Everything else the app draws from MRMS is the whole column answered in one
 * number: the composite is its maximum reflectivity, the echo top is where it
 * ends, the hail size is what fell out of it. The network also publishes the
 * cube those are made from, at thirty-three heights, and reading one height of
 * it is a different question. Where is the hail core, rather than how big the
 * hail is. Is there a differential reflectivity column above the updraught,
 * rather than is it raining.
 *
 * Three fields, one height at a time. Which height is a single choice across
 * all three so that switching field keeps the altitude, because a reader
 * comparing reflectivity against correlation at six kilometres is asking about
 * six kilometres.
 */

/**
 * The heights the network publishes, as the bucket spells them.
 *
 * The spelling is the folder name and nothing derives it, so these are copied
 * from the CONUS prefix listing rather than generated: a quarter of a
 * kilometre apart through the lowest three, half a kilometre to nine, then
 * whole ones to nineteen. The same list is in `src-tauri/src/mrms.rs`, which
 * is where it is checked against the bucket.
 */
export const CUBE_LEVELS = [
  "00.50",
  "00.75",
  "01.00",
  "01.25",
  "01.50",
  "01.75",
  "02.00",
  "02.25",
  "02.50",
  "02.75",
  "03.00",
  "03.50",
  "04.00",
  "04.50",
  "05.00",
  "05.50",
  "06.00",
  "06.50",
  "07.00",
  "07.50",
  "08.00",
  "08.50",
  "09.00",
  "10.00",
  "11.00",
  "12.00",
  "13.00",
  "14.00",
  "15.00",
  "16.00",
  "17.00",
  "18.00",
  "19.00",
] as const;

export type CubeLevel = (typeof CUBE_LEVELS)[number];

/**
 * Three kilometres, which is where a reader looking at a storm starts.
 *
 * Low enough to be inside the precipitation and high enough to be out of the
 * ground clutter and the melting layer, and it is a height every radar in the
 * network can see over most of its range.
 */
export const DEFAULT_CUBE_LEVEL: CubeLevel = "03.00";

export function isCubeLevel(value: unknown): value is CubeLevel {
  return CUBE_LEVELS.includes(value as CubeLevel);
}

/** The height in kilometres, which is how the network names it. */
export function cubeLevelKm(level: CubeLevel): number {
  return Number(level);
}

/**
 * The same height in feet, which is what `formatHeight` takes.
 *
 * Every height in the app goes through that one function so a reader who
 * asked for metres gets metres everywhere, and it takes feet.
 */
export function cubeLevelFeet(level: CubeLevel): number {
  return cubeLevelKm(level) * 3280.839_895;
}

/** Which of the three merged fields the switch is showing. */
export const CAPPI_FIELDS = [
  "reflectivity",
  "correlation",
  "differential",
] as const;

export type CappiField = (typeof CAPPI_FIELDS)[number];

export function isCappiField(value: unknown): value is CappiField {
  return CAPPI_FIELDS.includes(value as CappiField);
}
