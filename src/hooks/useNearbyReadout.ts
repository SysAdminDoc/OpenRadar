import type { OverlayData } from "../lib/overlays";
import type { AppSettings } from "../lib/settings";
import type { GeoPoint } from "../lib/geo";
import { nearbyCells, nearbySummary, warningsOver } from "../lib/nearby";
import { translate } from "../i18n";
import { useMeasurements } from "../lib/units";
import { useMemo, useState } from "react";
import { useStormCells } from "./useStormCells";
import { useWorkspaceOverlays } from "./useWorkspaceOverlays";
import { watchedPlaces } from "../lib/watch";

/**
 * The readout a reader who is not looking at the map reads.
 *
 * A point, a list of points it could be about, and one sentence about what
 * is over that point now. The place can be the middle of the view or any of
 * the watched ones, because "what is happening here" is a different question
 * from "what is happening where I am looking".
 */
export interface NearbyReadoutOptions {
  settings: AppSettings;
  overlays: ReturnType<typeof useWorkspaceOverlays>;
  stormCells: ReturnType<typeof useStormCells>;
  /** That day's own warnings while a replay is running, or null. */
  replayedAlerts: OverlayData | null;
}

export function useNearbyReadout({
  settings,
  overlays,
  stormCells,
  replayedAlerts,
}: NearbyReadoutOptions) {
  const centerPoint = useMemo<GeoPoint>(
    () => ({ lon: settings.camera.center[0], lat: settings.camera.center[1] }),
    [settings.camera.center],
  );

  // The map, in words, for a reader who is not looking at it. The centre by
  // default, because that is what the rest of the workspace is about, and any
  // watched place instead, because a reader listening from a desk cares about
  // where they live rather than where the camera drifted.
  const [nearbyPlaceId, setNearbyPlaceId] = useState("centre");
  const measurements = useMeasurements();
  const nearbyPlaces = useMemo(
    () => [
      { id: "centre", name: translate("nearby.placeCentre") },
      ...watchedPlaces(settings).map((place) => ({
        id: place.id,
        name: place.name,
      })),
    ],
    [settings],
  );
  const nearbyPoint = useMemo<GeoPoint>(() => {
    const watched = watchedPlaces(settings).find(
      (place) => place.id === nearbyPlaceId,
    );
    return watched
      ? { lon: watched.center[0], lat: watched.center[1] }
      : centerPoint;
  }, [centerPoint, nearbyPlaceId, settings]);
  const nearby = useMemo(() => {
    // The same collection the map is handed, so a replay's warnings are in the
    // readout too. Reading `overlays.data.alerts` alone left a reader who
    // cannot see the map hearing "no warnings over this place" while the map
    // drew that day's polygons: the live fetch is switched off for the whole
    // replay, which is exactly when the archive is on.
    const warnings = warningsOver(
      replayedAlerts ?? overlays.data.alerts ?? null,
      nearbyPoint,
    );
    const cells = stormCells.report
      ? nearbyCells(stormCells.report.cells, nearbyPoint, {
          rotating: stormCells.rotating,
        })
      : [];
    const name =
      nearbyPlaces.find((place) => place.id === nearbyPlaceId)?.name ??
      translate("nearby.placeCentre");
    return {
      warnings,
      cells,
      summary: nearbySummary(warnings, cells, name),
    };
    // Every sentence here is a distance, a bearing or a speed, and units.ts
    // says plainly that anything formatting a measurement and staying on
    // screen has to subscribe. Without this the readout kept saying miles
    // after the reader switched to kilometres. The rule cannot see that,
    // because the unit is module state the formatters read rather than an
    // argument they are handed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    measurements,
    nearbyPlaceId,
    nearbyPlaces,
    nearbyPoint,
    overlays.data.alerts,
    replayedAlerts,
    stormCells.report,
    stormCells.rotating,
  ]);
  return {
    centerPoint,
    nearbyPlaces,
    nearbyPlaceId,
    setNearbyPlaceId,
    nearby,
  };
}
