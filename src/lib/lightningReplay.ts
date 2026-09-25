import type { Flash, FlashWindow } from "../hooks/useLightning";

/**
 * The satellite's lightning over a stretch of the past, as the replayed
 * watch reads it.
 *
 * The native side reads every file in the stretch once and hands back only
 * the flashes near a watched place, with each file's time, whether it was
 * read, and how many flashes it held in all. That is enough to build, for any
 * moment, the same five-minute window the live watch would have been holding
 * then: the files that had finished by that moment, the fifteen newest of
 * them, the gaps where one could not be read, and the cap that trims the
 * oldest flashes when the whole satellite is busy.
 */
export interface ReplayFile {
  /** When the file began, in seconds. */
  time: number;
  read: boolean;
  /** Every flash the file held, near a place or not. */
  flashes: number;
}

/** A flash near a watched place, with its place in its own file. */
export interface ReplayFlash extends Flash {
  order: number;
}

export interface FlashReplay {
  satellite: string;
  windowMinutes: number;
  fileSeconds: number;
  maxFiles: number;
  maxFlashes: number;
  files: ReplayFile[];
  /** Oldest first, and in file order within a file. */
  flashes: ReplayFlash[];
}

export async function fetchFlashReplay(
  from: number,
  to: number,
  places: ReadonlyArray<{ center: [number, number] }>,
  radiusMiles: number,
): Promise<FlashReplay> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<FlashReplay>("lightning_replay", {
    from: Math.floor(from / 1000),
    to: Math.ceil(to / 1000),
    points: places.map((place) => ({
      longitude: place.center[0],
      latitude: place.center[1],
    })),
    radiusMiles,
  });
}

/**
 * The window the live watch would have held at a moment, or null where it
 * would have had none.
 *
 * Built the way the native feed builds its own: the files that began in the
 * five minutes before the moment, the newest fifteen of them, and the newest
 * flashes when there were more than the cap. A file counts once it has
 * finished rather than once it began, which is the earliest the live feed
 * could have read it. A window with no file read in it is no window, which is
 * what the live feed answers too, and what stops a gap in the archive reading
 * as a quiet sky.
 */
export function replayWindowAt(
  replay: FlashReplay,
  at: number,
): FlashWindow | null {
  const now = Math.floor(at / 1000);
  const cutoff = now - replay.windowMinutes * 60;
  const due = replay.files.filter(
    (file) => file.time >= cutoff && file.time + replay.fileSeconds <= now,
  );
  const files = due.slice(Math.max(0, due.length - replay.maxFiles));
  const read = files.filter((file) => file.read);
  if (!read.length) return null;

  const times = new Set(read.map((file) => file.time));
  let flashes: Flash[] = replay.flashes.filter((flash) =>
    times.has(flash.time),
  );
  // The live window keeps the newest flashes when there are too many, and it
  // counts every flash it read rather than the ones near a place. The oldest
  // go first: whole files, then the start of the next.
  let excess = read.reduce((sum, file) => sum + file.flashes, 0);
  excess -= replay.maxFlashes;
  const trimmed = excess > 0;
  if (trimmed) {
    const dropped = new Map<number, number>();
    for (const file of read) {
      if (excess <= 0) break;
      const gone = Math.min(file.flashes, excess);
      dropped.set(file.time, gone);
      excess -= gone;
    }
    flashes = replay.flashes.filter(
      (flash) =>
        times.has(flash.time) && flash.order >= (dropped.get(flash.time) ?? 0),
    );
  }
  return {
    satellite: replay.satellite,
    windowMinutes: replay.windowMinutes,
    observed: Math.max(...read.map((file) => file.time)),
    flashes,
    trimmed,
    filesRead: read.length,
    filesExpected: files.length,
  };
}
