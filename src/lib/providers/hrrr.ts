import type { RadarFrame } from "./types";

export const HRRR_HOST = "mesonet.agron.iastate.edu";
const RUN_URL = `https://${HRRR_HOST}/data/gis/images/4326/hrrr/refd_1080.json`;
const TILE_BASE = `https://${HRRR_HOST}/cache/tile.py/1.0.0`;

/** Forecast reflectivity is published every fifteen minutes out to eighteen hours. */
export const HRRR_STEP_MINUTES = 15;
/** Six hours of lead. The Iowa State cache is a courtesy, so this stays small. */
export const HRRR_MAX_FRAMES = 24;
const HRRR_ATTRIBUTION =
  '<a href="https://mesonet.agron.iastate.edu/">Iowa State Mesonet HRRR</a>';

export interface HrrrRun {
  /** Model start, as published. */
  initUtc: string;
  /** The same instant in the form the tile path wants. */
  initToken: string;
}

function initToken(initUtc: string): string | null {
  const parsed = Date.parse(initUtc);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().replace(/\D/g, "").slice(0, 12);
}

export function parseHrrrRun(payload: unknown): HrrrRun | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = payload as { model_init_utc?: unknown };
  if (typeof raw.model_init_utc !== "string") return null;
  const token = initToken(raw.model_init_utc);
  return token ? { initUtc: raw.model_init_utc, initToken: token } : null;
}

export async function fetchHrrrRun(signal?: AbortSignal): Promise<HrrrRun> {
  const response = await fetch(RUN_URL, {
    signal,
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`The forecast index returned ${response.status}.`);
  }
  const run = parseHrrrRun(await response.json());
  if (!run) throw new Error("The forecast index named no model run.");
  return run;
}

export function hrrrTileUrl(run: HrrrRun, leadMinutes: number): string {
  const lead = String(leadMinutes).padStart(4, "0");
  return `${TILE_BASE}/hrrr::REFD-F${lead}-${run.initToken}/{z}/{x}/{y}.png`;
}

/**
 * Frames for the part of the run that is still ahead of the newest observation,
 * so the scrubber continues past now instead of repeating what already fell.
 */
export function hrrrFrames(run: HrrrRun, afterTime: number): RadarFrame[] {
  const init = Math.floor(Date.parse(run.initUtc) / 1000);
  if (!Number.isFinite(init)) return [];

  const frames: RadarFrame[] = [];
  for (
    let lead = HRRR_STEP_MINUTES;
    lead <= 18 * 60 && frames.length < HRRR_MAX_FRAMES;
    lead += HRRR_STEP_MINUTES
  ) {
    const time = init + lead * 60;
    if (time <= afterTime) continue;
    frames.push({
      providerId: "hrrr",
      time,
      tileUrl: hrrrTileUrl(run, lead),
      tileSize: 256,
      maxZoom: 9,
      attribution: HRRR_ATTRIBUTION,
      forecast: { initUtc: run.initUtc, leadMinutes: lead },
    });
  }
  return frames;
}
