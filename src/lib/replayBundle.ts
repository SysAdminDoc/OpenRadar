import { isDesktopRuntime, type CameraState } from "./settings";
import type { OverlayBounds } from "./overlays";
import type { RadarFrame } from "./providers/types";
import type { ArchiveReplay } from "../hooks/useRadarTimeline";
import type { Storm } from "./hurdat";
import type { WorkspaceBackup } from "./workspaceBackup";
import { archiveTagsUrl, archiveWarningsUrls } from "./archiveWarnings";
import { translate, type StringKey } from "../i18n";
import { en } from "../i18n/en";

/**
 * Replay bundles: one file that holds a replay's exact bytes.
 *
 * A workspace backup keeps settings and not the picture. A bundle keeps the
 * archive tiles a replay was drawn from, the warnings that were in force,
 * and the addresses and hashes of all of it, so a review three months on
 * sees the same frames whatever the archive says by then. The native side
 * writes and reads the file and serves its bytes ahead of the network; this
 * is the page's half: what to ask for, and what an opened bundle means.
 *
 * Nothing personal goes in unless the reader says so. The frames, the
 * window, the storm and the camera the replay opens on are the storm's; the
 * workspace, which knows where home is, travels only with an opt-in.
 */

export const BUNDLE_EXTENSION = "orb";
/** One zoom either side of the view, which is where a scrub tends to go. */
export const BUNDLE_ZOOM_REACH = 1;
export const BUNDLE_MIN_ZOOM = 2;
/** The archive publishes no tiles past this. */
export const BUNDLE_MAX_ZOOM = 9;

export interface BundleFrame {
  providerId: string;
  time: number;
  tileUrl: string;
  tileSize: number;
  maxZoom: number;
  attribution: string;
}

export interface BundleBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface BundleStorm {
  id: string;
  name: string;
  year: number;
  focusTime: number;
}

export interface BundleWindow {
  from: number;
  to: number;
}

export interface BundleCamera {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
}

export interface BundleEntry {
  url: string;
  sha256: string;
  bytes: number;
  contentType: string;
  fetchedAt: string;
}

export interface BundleMissing {
  url: string;
  reason: string;
}

/** The bundle's own account of itself, as the native side reads it back. */
export interface BundleManifest {
  type: "OpenRadarReplayBundle";
  bundleVersion: number;
  app: string;
  id: string;
  label: string;
  createdAt: string;
  storm: BundleStorm | null;
  window: BundleWindow;
  frames: BundleFrame[];
  bounds: BundleBounds;
  zooms: number[];
  camera: BundleCamera;
  entries: BundleEntry[];
  missing: BundleMissing[];
  workspace: unknown;
}

export interface CaptureRequest {
  label: string;
  storm: BundleStorm | null;
  window: BundleWindow;
  frames: BundleFrame[];
  bounds: BundleBounds;
  minZoom: number;
  maxZoom: number;
  extraUrls: string[];
  camera: BundleCamera;
  workspace: WorkspaceBackup | null;
}

export interface CaptureReport {
  id: string;
  path: string;
  bytes: number;
  entries: number;
  missing: BundleMissing[];
  sha256: string;
}

/** The bytes are fetched, hashed and written natively, so a browser has none of it. */
export function bundlesAvailable(): boolean {
  return isDesktopRuntime();
}

function clampZoom(zoom: number): number {
  return Math.min(BUNDLE_MAX_ZOOM, Math.max(BUNDLE_MIN_ZOOM, Math.round(zoom)));
}

/**
 * What to keep for the replay on screen: every frame, the tiles of the
 * view at the zoom it is at and one either side, and the warnings feeds for
 * the window. The workspace only when the caller was told to include it.
 */
export function captureRequestFor(options: {
  replay: ArchiveReplay;
  storm: Storm | null;
  bounds: OverlayBounds;
  camera: CameraState;
  workspace: WorkspaceBackup | null;
}): CaptureRequest | null {
  const { replay, storm, bounds, camera, workspace } = options;
  const frames = replay.frames.filter((frame) => !frame.forecast);
  if (!frames.length) return null;
  const from = frames[0].time;
  const to = frames[frames.length - 1].time;
  const zoom = clampZoom(camera.zoom);
  return {
    label: storm ? `${storm.name} ${storm.year}` : replay.label,
    storm: storm
      ? {
          id: storm.id,
          name: storm.name,
          year: storm.year,
          focusTime: replay.focusTime,
        }
      : null,
    window: { from, to },
    frames: frames.map((frame) => ({
      providerId: frame.providerId,
      time: frame.time,
      tileUrl: frame.tileUrl,
      tileSize: frame.tileSize,
      maxZoom: frame.maxZoom,
      attribution: frame.attribution,
    })),
    bounds: {
      west: bounds.west,
      south: bounds.south,
      east: bounds.east,
      north: bounds.north,
    },
    minZoom: clampZoom(zoom - BUNDLE_ZOOM_REACH),
    maxZoom: clampZoom(zoom + BUNDLE_ZOOM_REACH),
    // Milliseconds, as the archive helpers take them; frames carry seconds.
    extraUrls: [
      ...archiveWarningsUrls(from * 1000, to * 1000),
      archiveTagsUrl(from * 1000, to * 1000),
    ],
    camera: {
      center: [camera.center[0], camera.center[1]],
      zoom: camera.zoom,
      bearing: camera.bearing,
      pitch: camera.pitch,
    },
    workspace,
  };
}

const PROVIDERS = new Set<RadarFrame["providerId"]>([
  "ridge",
  "nowcoast",
  "rainviewer",
  "hrrr",
  "archive",
  "mrms",
  "geomet",
  "dwd",
]);

function isProvider(value: string): value is RadarFrame["providerId"] {
  return PROVIDERS.has(value as RadarFrame["providerId"]);
}

/**
 * The replay an opened bundle stands for. Its id names the bundle rather
 * than the storm, so opening the same storm's bundle twice is one replay and
 * a live replay of the same storm is another.
 */
export function bundleReplay(manifest: BundleManifest): ArchiveReplay | null {
  const frames: RadarFrame[] = [];
  for (const frame of manifest.frames) {
    if (!isProvider(frame.providerId) || !Number.isFinite(frame.time)) continue;
    frames.push({
      providerId: frame.providerId,
      time: frame.time,
      tileUrl: frame.tileUrl,
      tileSize: frame.tileSize,
      maxZoom: frame.maxZoom,
      attribution: frame.attribution,
    });
  }
  if (!frames.length) return null;
  frames.sort((a, b) => a.time - b.time);
  return {
    id: `bundle:${manifest.id}`,
    label: translate("bundle.replayLabel"),
    attributionUrl: "https://mesonet.agron.iastate.edu/",
    frames,
    focusTime: manifest.storm?.focusTime ?? frames[0].time,
  };
}

/** What a bundle left out, in one line, or null when it holds everything. */
export function bundleMissingNote(manifest: BundleManifest): string | null {
  if (!manifest.missing.length) return null;
  const warnings = manifest.missing.filter(
    (entry) =>
      entry.url.includes("sbw_interval") || entry.url.includes("/sbw.py"),
  ).length;
  const tiles = manifest.missing.length - warnings;
  if (warnings && tiles) {
    return translate("bundle.missingBoth", { tiles, warnings });
  }
  if (warnings) return translate("bundle.missingWarnings", { count: warnings });
  return translate("bundle.missingTiles", { count: tiles });
}

/** The wording for a native refusal, in the reader's language where there is one. */
export function bundleErrorText(failure: unknown): string {
  if (failure && typeof failure === "object" && "code" in failure) {
    const named = failure as { code?: unknown; args?: unknown; text?: unknown };
    const args = Array.isArray(named.args) ? named.args : [];
    const params: Record<string, string> = {};
    args.forEach((value, at) => {
      params[String(at)] = String(value);
    });
    const key = `bundle.error.${String(named.code)}`;
    if (key in en) return translate(key as StringKey, params);
    if (typeof named.text === "string" && named.text) return named.text;
  }
  if (failure instanceof Error && failure.message) return failure.message;
  if (typeof failure === "string" && failure) return failure;
  return translate("bundle.error.unknown");
}

export async function captureReplayBundle(
  request: CaptureRequest,
): Promise<CaptureReport> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<CaptureReport>("replay_bundle_capture", { request });
}

export async function openReplayBundle(path: string): Promise<BundleManifest> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<BundleManifest>("replay_bundle_open", { path });
}

export async function closeReplayBundle(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("replay_bundle_close");
}

/** The operating system's picker, for a bundle and nothing else. */
export async function pickBundleFile(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    title: translate("bundle.openTitle"),
    directory: false,
    multiple: false,
    filters: [
      {
        name: translate("bundle.fileKind"),
        extensions: [BUNDLE_EXTENSION],
      },
    ],
  });
  return typeof selected === "string" ? selected : null;
}
