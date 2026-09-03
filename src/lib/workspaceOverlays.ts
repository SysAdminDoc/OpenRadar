/**
 * The local files a reader has put on the map.
 *
 * There used to be one. One imported placefile or GeoJSON file, held in one
 * variable, behind one switch called Custom Overlay, and importing a second
 * file silently threw the first one away. That is fine for trying something
 * out and useless for the way these files are actually used: a spotter network
 * in one, county lines in another, last year's damage survey in a third, each
 * wanted or not wanted independently of the others.
 *
 * So the map draws a set rather than a file. The set is bounded, every member
 * has its own name, its own switch, its own opacity and its own place in the
 * order, and importing a file that is already in the set replaces that file
 * instead of adding a second copy of it.
 */

/**
 * How many shapes one file may carry.
 *
 * The map redraws the whole imported set on every change to it, so this is a
 * ceiling on how slow one careless file is allowed to make that.
 */
export const MAX_WORKSPACE_OVERLAY_FEATURES = 5000;

/**
 * How many files the set holds.
 *
 * Eight because the set is drawn as one collection and rebuilt whenever any
 * member changes, and because a list longer than this stops being something a
 * person manages and starts being something they need a manager for.
 */
export const MAX_WORKSPACE_OVERLAY_FILES = 8;

export interface WorkspaceOverlayFile {
  /** Stable identity, so importing the same file again replaces it. */
  id: string;
  /** What the file was called when it was imported. */
  name: string;
  enabled: boolean;
  /** A fraction of the opacity the shapes were designed to be drawn at. */
  opacity: number;
  /** The GeoJSON itself, exactly as it was read. */
  shapes: Record<string, unknown>;
}

/** Accept only bounded, non-empty GeoJSON that the map can draw. */
export function isWorkspaceOverlay(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.type === "Feature") return true;
  if (record.type !== "FeatureCollection") return false;
  return (
    Array.isArray(record.features) &&
    record.features.length > 0 &&
    record.features.length <= MAX_WORKSPACE_OVERLAY_FEATURES
  );
}

/**
 * A file's identity, which is its name with the noise taken out.
 *
 * Names are what a reader has to tell these files apart by, so two files that
 * a reader would call the same file are the same file here. Case and
 * surrounding space are the two ways the same name arrives looking different.
 */
export function overlayFileId(name: string): string {
  return name.trim().toLowerCase();
}

export type OverlayFileAdded =
  | { ok: true; files: WorkspaceOverlayFile[]; replaced: boolean }
  | { ok: false; reason: "full" };

/**
 * Puts a file in the set, replacing the one of the same name if it is there.
 *
 * Replacing rather than appending, and in place rather than at the end: a
 * reader who edits a placefile and imports it again is updating what they
 * already arranged, not adding something new to arrange. Its switch and its
 * opacity are kept for the same reason. A set already full refuses rather than
 * dropping somebody's oldest file to make room for this one.
 */
export function addOverlayFile(
  files: WorkspaceOverlayFile[],
  name: string,
  shapes: Record<string, unknown>,
): OverlayFileAdded {
  const id = overlayFileId(name);
  const at = files.findIndex((file) => file.id === id);
  if (at < 0 && files.length >= MAX_WORKSPACE_OVERLAY_FILES) {
    return { ok: false, reason: "full" };
  }
  if (at < 0) {
    return {
      ok: true,
      replaced: false,
      files: [...files, { id, name, enabled: true, opacity: 1, shapes }],
    };
  }
  const next = [...files];
  next[at] = { ...next[at], name, shapes };
  return { ok: true, replaced: true, files: next };
}

/**
 * Moves a file to a place in the drawing order, bottom first.
 *
 * A position outside the list is clamped rather than refused, because the only
 * caller is a pair of buttons that already know where the ends are and there
 * is nothing useful to say when one of them is wrong.
 */
export function moveOverlayFile(
  files: WorkspaceOverlayFile[],
  id: string,
  to: number,
): WorkspaceOverlayFile[] {
  const at = files.findIndex((file) => file.id === id);
  if (at < 0) return files;
  const next = [...files];
  const [taken] = next.splice(at, 1);
  next.splice(Math.min(Math.max(to, 0), next.length), 0, taken);
  return next;
}

/**
 * What the imported set needs to be told about the view to draw itself.
 *
 * A placefile can say a shape is only worth showing inside a range and only
 * between two times, and both are properties on the shape rather than on the
 * file. Working out whether any file carries either is cheap and is done once
 * per change to the set, so the collection is only rebuilt when the zoom or
 * the frame time actually decides something.
 */
export interface OverlayGates {
  zoomed: boolean;
  timed: boolean;
}

export function overlayGates(files: WorkspaceOverlayFile[]): OverlayGates {
  const gates: OverlayGates = { zoomed: false, timed: false };
  for (const file of files) {
    for (const feature of featuresOf(file.shapes)) {
      const properties = (feature as { properties?: Record<string, unknown> })
        .properties;
      if (!properties) continue;
      if (typeof properties.minZoom === "number") gates.zoomed = true;
      if (typeof properties.from === "number") gates.timed = true;
      if (gates.zoomed && gates.timed) return gates;
    }
  }
  return gates;
}

function featuresOf(shapes: Record<string, unknown>): unknown[] {
  if (shapes.type === "Feature") return [shapes];
  return Array.isArray(shapes.features) ? (shapes.features as unknown[]) : [];
}

/**
 * Whether a shape wants to be drawn at this zoom and at this moment.
 *
 * A shape with neither property answers yes to both, which is every shape in
 * a GeoJSON file and most of the shapes in a placefile.
 */
function visible(feature: unknown, zoom: number, at: number | null): boolean {
  const properties = (feature as { properties?: Record<string, unknown> })
    .properties;
  if (!properties) return true;
  if (typeof properties.minZoom === "number" && zoom < properties.minZoom) {
    return false;
  }
  if (at !== null && typeof properties.from === "number") {
    // The format's own rule: the start is inclusive and the end is not.
    if (at < properties.from) return false;
    if (typeof properties.to === "number" && at >= properties.to) return false;
  }
  return true;
}

function withOpacity(feature: unknown, opacity: number): unknown {
  if (opacity >= 1) return feature;
  const record = feature as Record<string, unknown>;
  const properties =
    record.properties && typeof record.properties === "object"
      ? (record.properties as Record<string, unknown>)
      : {};
  return { ...record, properties: { ...properties, fileOpacity: opacity } };
}

/**
 * The whole set as one collection for the map, or null when nothing is on.
 *
 * One collection rather than one source per file, because the map already
 * draws imported shapes through a single source under the warnings, and
 * splitting that into eight would put eight new layers into the arrangement
 * that has to keep warnings on top. Order in the list is order in the
 * collection, which is the order the shapes are drawn in. A file's opacity
 * rides along on its own features rather than on the layer, since the layer is
 * shared, and it is left off entirely at full so the common case adds nothing
 * to what the map has to read.
 */
export function mergedOverlayShapes(
  files: WorkspaceOverlayFile[],
  /** The zoom the map is at, for shapes that named a range to appear inside. */
  zoom = Number.POSITIVE_INFINITY,
  /** The moment being drawn, for shapes that named a time range. */
  at: number | null = null,
): Record<string, unknown> | null {
  const features: unknown[] = [];
  for (const file of files) {
    if (!file.enabled) continue;
    for (const feature of featuresOf(file.shapes)) {
      if (!visible(feature, zoom, at)) continue;
      features.push(withOpacity(feature, file.opacity));
    }
  }
  return features.length ? { type: "FeatureCollection", features } : null;
}

/** How many shapes one file carries. */
export function overlayShapeCount(shapes: Record<string, unknown>): number {
  if (shapes.type === "Feature") return 1;
  return Array.isArray(shapes.features) ? shapes.features.length : 0;
}
