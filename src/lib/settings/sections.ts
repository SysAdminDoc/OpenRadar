/**
 * The sections with no module of their own to sit beside.
 *
 * A saved view, the seasonal packs, a hand-typed storm motion, the
 * thresholds under the grids and how solid each overlay is drawn. None of
 * them has a leaf that owns its vocabulary, so they are here rather than
 * back in the store, where they would put its line count up and its
 * imports with it.
 */
import { translate } from "../../i18n";
import { bool } from "./read";
import { DEFAULT_SETTINGS } from "./defaults";
import { normalizeCamera, normalizeMapStyle } from "./camera";
import type { AppSettings, PresetState } from "./types";

export function normalizePreset(value: unknown): PresetState | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<PresetState>;
  const projection = raw.projection === "globe" ? "globe" : "mercator";
  return {
    name:
      typeof raw.name === "string" && raw.name.trim()
        ? raw.name.slice(0, 40)
        : translate("app.savedView"),
    camera: normalizeCamera(raw.camera),
    projection,
    mapStyle: normalizeMapStyle(raw.mapStyle),
  };
}

/**
 * A stored theme, read back out of its own text.
 *
 * The same rule a colour table follows, for the same reason: a hand-edited
 * `settings.json` must not be able to put anything on screen that the parser
 * would not have produced from a file. So the object is written back out as
 * the theme file it came from and read again, and whatever survives that is
 * what applies.
 */
/**
 * The seasonal packs out of a settings file.
 *
 * A year that is not a year is dropped rather than repaired: the worst that
 * does is show a pack somebody sent away once, which is a great deal better
 * than reading a hand-edited file as "declined for ever".
 */
export function normalizeOccasions(value: unknown): AppSettings["occasions"] {
  const raw =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const years = (value: unknown): Record<string, number> => {
    const out: Record<string, number> = {};
    if (!value || typeof value !== "object" || Array.isArray(value)) return out;
    for (const [id, year] of Object.entries(value as Record<string, unknown>)) {
      if (typeof year !== "number" || !Number.isInteger(year)) continue;
      if (year < 1970 || year > 9999) continue;
      out[id.slice(0, 40)] = year;
    }
    return out;
  };
  return {
    enabled: bool(raw.enabled, DEFAULT_SETTINGS.occasions.enabled),
    declined: years(raw.declined),
    seen: years(raw.seen),
  };
}

/** A hand-typed motion, held to something a storm could actually do. */
export function normalizeStormMotion(
  value: unknown,
): { speedMs: number; fromDegrees: number } | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const speedMs = Number(record.speedMs);
  const fromDegrees = Number(record.fromDegrees);
  if (!Number.isFinite(speedMs) || !Number.isFinite(fromDegrees)) return null;
  return {
    speedMs: Math.min(80, Math.max(0, speedMs)),
    fromDegrees: ((fromDegrees % 360) + 360) % 360,
  };
}

/**
 * The per-product thresholds, with anything that is not a finite number
 * dropped.
 *
 * A threshold that cannot be compared against would hide the whole picture, so
 * a bad entry means no threshold for that product rather than a threshold of
 * nothing. The file is hand-editable, which is why this is checked at all.
 */
export function normalizeThresholds(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== "number" || !Number.isFinite(entry)) continue;
    // Well outside anything any product reads, in either direction.
    if (entry < -1000 || entry > 10000) continue;
    out[key] = entry;
  }
  return out;
}

/**
 * The per-overlay opacities, with anything unusable dropped.
 *
 * Only entries that differ from full are kept, so an overlay added in a later
 * build is drawn as designed rather than arriving at whatever a saved file
 * happened to hold.
 */
export function normalizeOverlayOpacity(
  value: unknown,
): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== "number" || !Number.isFinite(entry)) continue;
    const clamped = Math.min(1, Math.max(0.1, entry));
    // Full is the default, so storing it would only make a bigger file.
    if (clamped >= 1) continue;
    out[key] = clamped;
  }
  return out;
}
