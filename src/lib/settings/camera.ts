/**
 * Where the map is looking, and which basemap is under it.
 *
 * Readers rather than a composer: each takes a value out of a file and
 * answers with something the app can use. Nothing here reaches for the
 * whole settings object, which is what keeps it underneath the module
 * that builds one.
 */
import { finiteInRange } from "./read";
import { DEFAULT_SETTINGS } from "./defaults";
import type { CameraState, MapStyleId } from "./types";

/**
 * The styles a file may name, which is the ones the picker offers.
 *
 * Written out rather than imported to keep the settings module free of the
 * map's own imports, and held against `MAP_STYLE_OPTIONS` by a test so the
 * two cannot drift. They already had: this list carried `dark`, which no
 * picker has offered for a long time, and left out `auto`, which is the
 * default and the one most readers are on. A saved view naming Auto was
 * refused and quietly replaced.
 */
const MAP_STYLE_IDS: MapStyleId[] = [
  "auto",
  "grayscale",
  "roads",
  "aerial",
  "topography",
  "pro-dark",
  "pro-light",
  "daylight",
];

export function isMapStyle(value: unknown): value is MapStyleId {
  return MAP_STYLE_IDS.includes(String(value) as MapStyleId);
}

/**
 * The style a stored file meant, including one that has been renamed.
 *
 * `dark` was what the plain dark basemap was called before the professional
 * pair arrived. A file that still says it means `pro-dark`, and dropping it
 * to the default would move a reader who had pinned a style off it.
 */
export function normalizeMapStyle(value: unknown): MapStyleId {
  if (value === "dark") return "pro-dark";
  return isMapStyle(value) ? value : DEFAULT_SETTINGS.mapStyle;
}

export function normalizeCamera(value: unknown): CameraState {
  const raw =
    value && typeof value === "object" ? (value as Partial<CameraState>) : {};
  const center = Array.isArray(raw.center)
    ? raw.center
    : DEFAULT_SETTINGS.camera.center;
  return {
    center: [
      finiteInRange(center[0], DEFAULT_SETTINGS.camera.center[0], -180, 180),
      finiteInRange(center[1], DEFAULT_SETTINGS.camera.center[1], -85, 85),
    ],
    zoom: finiteInRange(raw.zoom, DEFAULT_SETTINGS.camera.zoom, 2.5, 15),
    bearing: finiteInRange(raw.bearing, 0, -180, 180),
    pitch: finiteInRange(raw.pitch, 0, 0, 75),
  };
}

/**
 * One rounded string stands for a camera position. Comparing the same string
 * the map publishes keeps "close enough to skip the jump" and "reported as the
 * same position" from ever disagreeing.
 */
export function cameraKey(camera: CameraState): string {
  return [
    camera.center[0].toFixed(5),
    camera.center[1].toFixed(5),
    camera.zoom.toFixed(3),
    camera.bearing.toFixed(2),
    camera.pitch.toFixed(2),
  ].join(",");
}

export function sameCamera(left: CameraState, right: CameraState): boolean {
  return cameraKey(left) === cameraKey(right);
}
