import {
  mergedOverlayShapes,
  overlayGates,
  type WorkspaceOverlayFile,
} from "../lib/workspaceOverlays";
import { useMemo } from "react";

/**
 * The reader's own imported shapes, cut to whatever each file says it is for.
 *
 * A placefile can say a shape belongs inside a range of zooms and between
 * two times. Whether any imported file says either is worked out once per
 * change to the set, so a file that says neither is not rebuilt every time
 * the map moves or the loop steps, which is the common case and most of
 * them.
 */
export interface OverlayShapeOptions {
  overlayFiles: WorkspaceOverlayFile[];
  zoom: number;
  /** The moment the playhead is on, or null when there is no frame. */
  frameTime: number | null;
  clock: number;
  /** The volumes the wind profile can be drawn for, as the archive names. */
  volumes: number[];
}

export function useOverlayShapes({
  overlayFiles,
  zoom,
  frameTime,
  clock,
  volumes,
}: OverlayShapeOptions) {
  // collection. Derived rather than kept beside the set, so a switch or a
  // slider cannot leave the two disagreeing.
  // A placefile can say a shape belongs inside a range and between two times.
  // Whether any imported file says either is worked out once per change to the
  // set, so a file that says neither is not rebuilt every time the map moves
  // or the loop steps, which is the common case and most of them.
  const gates = useMemo(() => overlayGates(overlayFiles), [overlayFiles]);
  const gateZoom = gates.zoomed ? Math.floor(zoom) : null;
  const gateMinute = gates.timed
    ? Math.floor((frameTime ?? clock / 1000) / 60)
    : null;
  // The volume times the wind profile is drawn for, as the archive names
  // them. Held rather than rebuilt inline, because the panel refetches on any
  // change to this list and a new array every render would ask forever.
  const vwpTimes = useMemo(
    () => volumes.map((at) => new Date(at).toISOString()),
    [volumes],
  );

  const overlayShapes = useMemo(
    () =>
      mergedOverlayShapes(
        overlayFiles,
        gateZoom ?? Number.POSITIVE_INFINITY,
        gateMinute === null ? null : gateMinute * 60_000,
      ),
    [overlayFiles, gateZoom, gateMinute],
  );
  return { overlayShapes, vwpTimes };
}
