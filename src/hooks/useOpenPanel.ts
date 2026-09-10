import type { SurfaceId } from "../components/CommandBar";
import { SURFACE_FRAMES } from "../lib/commands";
import { frameAgeMinutes, type RadarFrame } from "../lib/radar";

/**
 * How old the picture is, and what is holding the panel's place.
 *
 * Staleness is a property of the observed feed rather than of the frame the
 * reader scrubbed to, and not of a forecast frame that is hours ahead by
 * design.
 *
 * The frame is what the surfaces are drawn in while their own module is
 * still arriving. The panels cannot answer for themselves: they are in the
 * chunk being waited on, along with the module holding the other ten. The
 * surface wins over the product panel when both are open, because the
 * surface is the one the reader just asked for, and it is also the one whose
 * width varies: standing in for any of them at the base width moved the map
 * chrome once for the stand-in and again for the panel.
 */
export interface OpenPanelOptions {
  newestObserved: RadarFrame | undefined;
  clock: number;
  activeSurface: SurfaceId;
  productOpen: boolean;
}

export function useOpenPanel({
  newestObserved,
  clock,
  activeSurface,
  productOpen,
}: OpenPanelOptions) {
  // Staleness is a property of the observed feed, not of the frame the user
  // scrubbed to and not of a forecast frame that is hours ahead by design.
  const radarAge = newestObserved
    ? frameAgeMinutes(newestObserved, clock)
    : null;
  const panelSide =
    productOpen ||
    activeSurface === "commands" ||
    activeSurface === "search" ||
    activeSurface === "map-type" ||
    activeSurface === "layers"
      ? "left"
      : activeSurface
        ? "right"
        : "none";
  // What to call the frame the surfaces are drawn in while their own module
  // is still arriving, and how much room to hold for it. The panels cannot
  // answer for themselves: they are in the chunk being waited on, along with
  // the eleventh `lazy` in this app, which is the module holding the other
  // ten.
  //
  // The surface wins over the product panel when both are open, because the
  // surface is the one the reader just asked for. It is also the one whose
  // width varies: the settings-shaped panels are 410 and the wide ones 430
  // against a base of 360, and standing in for any of them at the base width
  // moved the map chrome once for the stand-in and again for the panel.
  const openFrame =
    (activeSurface ? SURFACE_FRAMES[activeSurface] : null) ??
    SURFACE_FRAMES["radar-product"];
  return { radarAge, panelSide, openFrame };
}
