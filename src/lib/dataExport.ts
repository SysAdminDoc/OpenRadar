import { isDesktopRuntime } from "./settings";
import { translate, type StringKey } from "../i18n";
import { en } from "../i18n/en";

/**
 * The readings behind the picture, in formats other tools read.
 *
 * A PNG or a WebM says what the storm looked like. Neither can be compared
 * with a rain gauge, put in a case study, or opened in QGIS, because a colour
 * is a lossy account of a number. The native side writes the numbers instead:
 * a sweep as CSV with one row per gate and its geometry in the header, a grid
 * as a single-band float GeoTIFF. Both land beside a JSON sidecar naming the
 * source, the observed time, the units, the missing-value rule and anything
 * done to the readings on the way.
 *
 * Nothing here touches colour. A loaded colour table, the high contrast ramps
 * and a display threshold all change what a reader sees rather than what the
 * radar measured, so none of them reaches an export.
 */

export interface DataExportReport {
  path: string;
  sidecar: string;
  bytes: number;
  /** Rows for a sweep, cells for a grid. */
  readings: number;
  /** Gates left out because they measured nothing. */
  omitted: number;
  sha256: string;
}

export interface SweepDataRequest {
  station: string;
  product: string;
  tilt: number;
  dealias?: boolean;
  motion?: [number, number] | null;
  /** An archive moment, when the picture is a replay rather than the latest. */
  at?: string | null;
  /** A volume off the reader's own disk. Held by the hook, never by a panel. */
  path?: string | null;
}

export interface GridDataRequest {
  product: string;
  /** Seconds since the epoch, as the timeline holds them. */
  time: number;
  domain?: string | null;
  west: number;
  south: number;
  east: number;
  north: number;
}

/** The files are written natively, so a browser preview cannot offer this. */
export function dataExportAvailable(): boolean {
  return isDesktopRuntime();
}

export async function exportSweepData(
  request: SweepDataRequest,
): Promise<DataExportReport> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<DataExportReport>("export_sweep_data", { request });
}

export async function exportGridData(
  request: GridDataRequest,
): Promise<DataExportReport> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<DataExportReport>("export_grid_data", { request });
}

/** The wording for a native refusal, in the reader's language where there is one. */
export function dataExportErrorText(failure: unknown): string {
  if (failure && typeof failure === "object" && "code" in failure) {
    const named = failure as { code?: unknown; args?: unknown; text?: unknown };
    const args = Array.isArray(named.args) ? named.args : [];
    const params: Record<string, string> = {};
    args.forEach((value, at) => {
      params[String(at)] = String(value);
    });
    const key = `dataExport.error.${String(named.code)}`;
    if (key in en) return translate(key as StringKey, params);
    // A radar failure keeps the wording the picture would have had.
    const shared = `radar.error.${String(named.code)}`;
    if (shared in en) return translate(shared as StringKey, params);
    if (typeof named.text === "string" && named.text) return named.text;
  }
  if (failure instanceof Error && failure.message) return failure.message;
  if (typeof failure === "string" && failure) return failure;
  return translate("dataExport.error.unknown");
}

/** How big the file is, in the units a person reads sizes in. */
export function exportSize(bytes: number): string {
  if (bytes < 1024) return translate("dataExport.bytes", { count: bytes });
  if (bytes < 1024 * 1024) {
    return translate("dataExport.kilobytes", {
      count: (bytes / 1024).toFixed(0),
    });
  }
  return translate("dataExport.megabytes", {
    count: (bytes / 1_048_576).toFixed(1),
  });
}
