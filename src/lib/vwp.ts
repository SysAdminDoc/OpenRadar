import { isDesktopRuntime } from "./settings";

/**
 * The wind profile a held site's own volume gives, as the panel reads it.
 *
 * The arithmetic is all on the native side, where the volume already is. This
 * is the shape it comes back in, plus the two pieces of geometry a wind
 * profile is drawn with: what a barb is made of, and where a level sits on a
 * hodograph.
 */

/** Why a level has no wind on it. The native side's own words. */
export type VwpRefusal =
  "outOfReach" | "noFit" | "residual" | "symmetry" | "lopsided" | "gates";

export interface VwpLevel {
  heightKm: number;
  /** Metres a second, when the ring could be vouched for. */
  speedMs: number | null;
  /** Where the wind is coming from, which is how a wind is named. */
  fromDegrees: number | null;
  elevationDegrees: number | null;
  rangeKm: number | null;
  residualMs: number | null;
  symmetryMs: number | null;
  refused: VwpRefusal | null;
}

export interface VwpColumn {
  /** The archive object this came out of, so a column can be traced back. */
  volume: string;
  collected: string | null;
  levels: VwpLevel[];
}

/** Volumes are decoded natively, so a browser preview has none of this. */
export function vwpAvailable(): boolean {
  return isDesktopRuntime();
}

export async function fetchVwp(
  station: string,
  /** Volume times, newest last. Empty asks for the one the radar last published. */
  times: string[],
): Promise<VwpColumn[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<VwpColumn[]>("level2_vwp", { station, times });
}

const MS_TO_KNOTS = 1.94384;

export function knots(speedMs: number): number {
  return speedMs * MS_TO_KNOTS;
}

/**
 * What a wind barb is made of, at the speed it is drawn for.
 *
 * The convention every weather chart uses and nobody writes down on the
 * chart: a pennant is fifty knots, a full barb ten, a half barb five, and the
 * speed is rounded to the nearest five before any of them are counted. A calm
 * wind has no barb at all, which is why the count can be nothing.
 */
export function barbParts(speedKnots: number): {
  pennants: number;
  full: number;
  half: boolean;
} {
  const rounded = Math.max(0, Math.round(speedKnots / 5) * 5);
  const pennants = Math.floor(rounded / 50);
  const afterPennants = rounded - pennants * 50;
  const full = Math.floor(afterPennants / 10);
  return { pennants, full, half: afterPennants - full * 10 >= 5 };
}

/**
 * Where a level sits on a hodograph, in metres a second east and north.
 *
 * A hodograph plots the wind vector itself rather than where it came from, so
 * a southwesterly at ten metres a second is up and to the right. Getting the
 * sign wrong here draws every shear vector backwards, which reads as a
 * perfectly plausible storm going the other way.
 */
export function hodographPoint(level: VwpLevel): {
  east: number;
  north: number;
} | null {
  if (level.speedMs === null || level.fromDegrees === null) return null;
  const toward = ((level.fromDegrees + 180) * Math.PI) / 180;
  return {
    east: level.speedMs * Math.sin(toward),
    north: level.speedMs * Math.cos(toward),
  };
}

/** The widest wind in a set of columns, for scaling a hodograph. */
export function fastestMs(columns: readonly VwpColumn[]): number {
  let fastest = 0;
  for (const column of columns) {
    for (const level of column.levels) {
      if (level.speedMs !== null) fastest = Math.max(fastest, level.speedMs);
    }
  }
  return fastest;
}
