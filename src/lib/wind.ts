import { isDesktopRuntime } from "./settings";
import { translate } from "../i18n";

export interface WindField {
  columns: number;
  rows: number;
  north: number;
  west: number;
  dLat: number;
  dLon: number;
  /** The range the bytes in the image are scaled over, in metres a second. */
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
  /** When the model run was initialised, and how far ahead this field is. */
  init: string;
  leadHours: number;
  /** Red is the eastward component, green the northward. */
  image: string;
}

/** The wind is decoded from GRIB2 here, so a browser preview has none of it. */
export function windAvailable(): boolean {
  return isDesktopRuntime();
}

export async function fetchWind(): Promise<WindField> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<WindField>("gfs_wind");
}

/** What the banner says: which run this is and how old it is. */
export function windLabel(field: WindField, nowMs: number): string {
  const init = Date.parse(field.init);
  const hour = Number.isFinite(init)
    ? `${String(new Date(init).getUTCHours()).padStart(2, "0")}Z`
    : translate("wind.unknownHour");
  const age = Number.isFinite(init)
    ? Math.max(0, Math.floor((nowMs - init) / 3_600_000))
    : 0;
  const lead = field.leadHours
    ? translate("wind.lead", { hours: field.leadHours })
    : "";
  return translate("wind.label", { hour, lead, age });
}

/**
 * A run is published every six hours and is worth re-reading a little after
 * each one, not constantly: the field does not change between them.
 */
export const WIND_REFRESH_MS = 30 * 60_000;
