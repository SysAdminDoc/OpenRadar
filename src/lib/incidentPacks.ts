import { formatNumber, translate } from "../i18n";
import { en } from "../i18n/en";
import type { StringKey } from "../i18n/en";
import { nativeErrorParams } from "./nativeError";
import { failureSentence } from "./serviceAnswer";
import { finiteInRange } from "./settings/read";
import type {
  IncidentPackReference,
  IncidentPackSettings,
} from "./settings/types";
import { isDesktopRuntime } from "./runtime";

export interface PackBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export type IncidentPackStatus =
  "queued" | "downloading" | "paused" | "finalizing" | "ready" | "failed";

export interface IncidentPack {
  id: string;
  name: string;
  bounds: PackBounds;
  minZoom: number;
  maxZoom: number;
  status: IncidentPackStatus;
  tileCount: number;
  downloadedTiles: number;
  downloadedBytes: number;
  estimatedBytes: number;
  archiveBytes: number;
  sha256: string | null;
  source: string;
  attribution: string;
  error: string | null;
  /** What that code's sentence needs filling in, when it needs any. */
  errorArgs?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface IncidentPackLibrary {
  packs: IncidentPack[];
  usedBytes: number;
  diskLimitBytes: number;
}

export interface IncidentPackEstimate {
  tileCount: number;
  estimatedBytes: number;
  temporaryBytes: number;
  usedBytes: number;
  diskLimitBytes: number;
  fits: boolean;
}

export interface IncidentPackRequest {
  name: string;
  bounds: PackBounds;
  minZoom: number;
  maxZoom: number;
}

async function native<T>(command: string, args?: Record<string, unknown>) {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

export function incidentPacksAvailable(): boolean {
  return isDesktopRuntime();
}

export function estimateIncidentPack(
  request: Omit<IncidentPackRequest, "name">,
): Promise<IncidentPackEstimate> {
  return native("incident_pack_estimate", { request });
}

export function listIncidentPacks(): Promise<IncidentPackLibrary> {
  return native("incident_pack_list");
}

export function setIncidentPackLimit(
  diskLimitMb: number,
): Promise<IncidentPackLibrary> {
  return native("incident_pack_set_limit", { diskLimitMb });
}

export function createIncidentPack(
  request: IncidentPackRequest,
): Promise<IncidentPack> {
  return native("incident_pack_create", { request });
}

export function pauseIncidentPack(id: string): Promise<void> {
  return native("incident_pack_pause", { id });
}

export function resumeIncidentPack(id: string): Promise<void> {
  return native("incident_pack_resume", { id });
}

export function cancelIncidentPack(id: string): Promise<void> {
  return native("incident_pack_cancel", { id });
}

/**
 * Deletes a pack, and answers whether it was held for an undo.
 *
 * The answer comes from the native side rather than from the listing on
 * screen, which can be a second old: a pack that finished in that second is
 * held on disk while the page still thinks it was downloading.
 */
export function deleteIncidentPack(id: string): Promise<boolean> {
  return native("incident_pack_delete", { id });
}

/**
 * Puts back a pack that was deleted, bytes and all.
 *
 * A finished pack is moved aside rather than removed, so this is a rename on
 * the native side and not another download. It refuses once the undo window
 *  has closed, which is what `reapIncidentPack` does.
 */
export function restoreIncidentPack(id: string): Promise<IncidentPack> {
  return native("incident_pack_restore", { id });
}

/** Closes one pack’s undo window, throwing away what was held for it. */
export function reapIncidentPack(id: string): Promise<void> {
  return native("incident_pack_reap", { id });
}

export function asIncidentPackReference(
  pack: IncidentPack,
): IncidentPackReference | null {
  if (pack.status !== "ready" || !pack.sha256) return null;
  return {
    id: pack.id,
    name: pack.name,
    bounds: pack.bounds,
    minZoom: pack.minZoom,
    maxZoom: pack.maxZoom,
    bytes: pack.archiveBytes,
    sha256: pack.sha256,
    attribution: pack.attribution,
  };
}

/**
 * Tauri spells a custom protocol differently on Windows. This is synchronous
 * because MapLibre asks for its style during construction, before an import
 * promise could settle.
 */
export function incidentTileTemplate(id: string): string | null {
  if (!/^[0-9a-f]{24}$/i.test(id) || typeof window === "undefined") return null;
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__?: {
        convertFileSrc?: (path: string, scheme: string) => string;
      };
    }
  ).__TAURI_INTERNALS__;
  if (typeof internals?.convertFileSrc !== "function") return null;
  try {
    const marker = "openradar";
    const sample = internals.convertFileSrc(marker, "incident");
    const at = sample.lastIndexOf(marker);
    if (at < 0) return null;
    return `${sample.slice(0, at)}${id}/{z}/{x}/{y}.png`;
  } catch {
    return null;
  }
}

export function formatPackBytes(bytes: number): string {
  const megabytes = (value: number, digits: number) =>
    translate("packs.megabytes", { count: formatNumber(value, digits) });
  if (!Number.isFinite(bytes) || bytes <= 0) return megabytes(0, 0);
  const size = bytes / (1024 * 1024);
  if (size < 1024) {
    return megabytes(Math.max(0.1, size), size < 10 ? 1 : 0);
  }
  return translate("packs.gigabytes", {
    count: formatNumber(size / 1024, 1),
  });
}
/**
 * A pack failure in the reader's own language.
 *
 * The native side used to serialize these as its own English sentence, so a
 * French reader was told "that region needs 41200 tiles, above the 25000 tile
 * limit", counts unformatted and all. It sends a code now, and the exact
 * wording still travels in `text` for the log. Manifests written by an older
 * build hold a sentence in this field rather than a code, so anything with no
 * key of its own is shown as it was rather than swallowed.
 */
export function packErrorText(failure: unknown, args: string[] = []): string {
  const code =
    typeof failure === "string"
      ? failure
      : failure && typeof failure === "object" && "code" in failure
        ? String((failure as { code?: unknown }).code)
        : null;
  // A rejected command carries its own; a manifest read back off disk hands
  // them separately, because the field that holds the code is a string.
  const carried =
    failure && typeof failure === "object" && "args" in failure
      ? ((failure as { args?: unknown }).args ?? [])
      : args;
  if (code) {
    const key = `packs.error.${code}`;
    if (key in en) {
      return translate(
        key as StringKey,
        nativeErrorParams(code, Array.isArray(carried) ? carried : []),
      );
    }
    // A sentence an older build wrote into a manifest, which is not a code
    // and has no key. Better read in English than not read at all.
    if (typeof failure === "string") return failure;
  }
  if (failure && typeof failure === "object" && "text" in failure) {
    const text = (failure as { text?: unknown }).text;
    if (typeof text === "string" && text) return text;
  }
  // Not `failure.message`. A pack fetched over the network fails with a
  // TypeError reading "Failed to fetch", in English whatever language the
  // app is in, and this text is what the panel shows.
  return failureSentence(failure, translate("packs.error.failed"));
}

/*
 * Reading the packs a settings file names.
 *
 * Beside what a pack is rather than in the store: the reference carries a
 * hash and a size and a bounding box, and what makes one readable is this
 * module's business rather than the store's.
 */

export function normalizeIncidentPackReference(
  value: unknown,
): IncidentPackReference | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<IncidentPackReference>;
  const bounds = raw.bounds;
  if (
    typeof raw.id !== "string" ||
    !/^[0-9a-f]{24}$/i.test(raw.id) ||
    typeof raw.name !== "string" ||
    !raw.name.trim() ||
    !bounds ||
    typeof bounds !== "object" ||
    typeof raw.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/i.test(raw.sha256) ||
    typeof raw.attribution !== "string" ||
    !raw.attribution.trim()
  ) {
    return null;
  }
  const normalizedBounds = {
    west: finiteInRange(bounds.west, Number.NaN, -180, 180),
    south: finiteInRange(bounds.south, Number.NaN, -85, 85),
    east: finiteInRange(bounds.east, Number.NaN, -180, 180),
    north: finiteInRange(bounds.north, Number.NaN, -85, 85),
  };
  if (
    Object.values(normalizedBounds).some((entry) => !Number.isFinite(entry)) ||
    normalizedBounds.west >= normalizedBounds.east ||
    normalizedBounds.south >= normalizedBounds.north
  ) {
    return null;
  }
  const minZoom = Math.round(finiteInRange(raw.minZoom, Number.NaN, 2, 15));
  const maxZoom = Math.round(finiteInRange(raw.maxZoom, Number.NaN, 2, 15));
  if (
    !Number.isFinite(minZoom) ||
    !Number.isFinite(maxZoom) ||
    minZoom > maxZoom
  ) {
    return null;
  }
  return {
    id: raw.id.toLowerCase(),
    name: raw.name.trim().slice(0, 60),
    bounds: normalizedBounds,
    minZoom,
    maxZoom,
    bytes: Math.round(finiteInRange(raw.bytes, 0, 0, Number.MAX_SAFE_INTEGER)),
    sha256: raw.sha256.toLowerCase(),
    attribution: raw.attribution.trim().slice(0, 200),
  };
}

export function normalizeIncidentPacks(
  value: unknown,
  fallback: IncidentPackSettings,
): IncidentPackSettings {
  const raw =
    value && typeof value === "object"
      ? (value as Partial<IncidentPackSettings>)
      : {};
  const references = Array.isArray(raw.references)
    ? raw.references
        .map(normalizeIncidentPackReference)
        .filter((entry): entry is IncidentPackReference => entry !== null)
        .filter(
          (entry, at, all) =>
            all.findIndex((item) => item.id === entry.id) === at,
        )
        .slice(0, 64)
    : [];
  const selectedId =
    typeof raw.selectedId === "string" && /^[0-9a-f]{24}$/i.test(raw.selectedId)
      ? raw.selectedId.toLowerCase()
      : null;
  return {
    diskLimitMb: Math.round(
      finiteInRange(raw.diskLimitMb, fallback.diskLimitMb, 256, 32_768),
    ),
    selectedId,
    references,
  };
}
