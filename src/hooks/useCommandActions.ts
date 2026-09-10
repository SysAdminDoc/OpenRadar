import type { RefObject } from "react";
import type { AppSettings, RadarSettings } from "../lib/settings";
import type { CommandAction } from "../lib/commands";
import type { MapViewportHandle } from "../components/MapViewport";
import type { SurfaceId, ToolMode } from "../components/CommandBar";
import { useCallback } from "react";

/**
 * How close going home gets, when the map was further out than that.
 *
 * A reader already looking at their own street stays there rather than being
 * pulled back out to a county: the camera only comes in, never out. Seven is
 * the zoom the storm archive flies to, which is a place and its weather in
 * one view.
 */
const HOME_ZOOM = 7;

/**
 * One place that knows how to do each kind of thing the palette offers.
 *
 * The palette stays a list rather than a second copy of the app: it names
 * an action and this is where each name means something. Nothing about the
 * welcome hint is here, because it is remembered the moment it goes on
 * screen, so a reader who has found the commands is already past it.
 */
export interface CommandActionOptions {
  settingsRef: { current: AppSettings };
  onSettings: (next: AppSettings) => void;
  setActiveSurface: (surface: SurfaceId) => void;
  setLayersToFind: (find: boolean) => void;
  setProductOpen: (open: boolean | ((was: boolean) => boolean)) => void;
  setAmbientAsked: (asked: (was: boolean) => boolean) => void;
  setCapture: (on: (was: boolean) => boolean) => void;
  handleTool: (tool: ToolMode) => void;
  mapRef: RefObject<MapViewportHandle | null>;
}

export function useCommandActions({
  settingsRef,
  onSettings: applySettings,
  setActiveSurface,
  setLayersToFind,
  setProductOpen,
  setAmbientAsked,
  setCapture,
  handleTool,
  mapRef,
}: CommandActionOptions) {
  // One place that knows how to do each kind of thing the palette offers, so
  // the palette itself stays a list rather than a second copy of the app.
  const runCommand = useCallback(
    (action: CommandAction) => {
      // Nothing about the welcome hint here. It is remembered the moment it
      // is put on screen, so having found the commands the reader has already
      // been past it, and a second place that writes the same flag would be a
      // line that can never run.
      const current = settingsRef.current;
      switch (action.kind) {
        case "layer":
          applySettings({
            ...current,
            layers: {
              ...current.layers,
              [action.layer]: !current.layers[action.layer],
            },
          });
          break;
        case "style":
          applySettings({ ...current, mapStyle: action.style });
          break;
        case "product":
          applySettings({
            ...current,
            radar: {
              ...current.radar,
              product: action.product as RadarSettings["product"],
              singleSite: true,
            },
          });
          setProductOpen(true);
          break;
        case "surface":
          if (action.surface === "radar-product") {
            setActiveSurface(null);
            setProductOpen(true);
            return;
          }
          setProductOpen(false);
          setLayersToFind(action.find === true);
          // The panel it asks for takes the palette's place, so this must not
          // fall through to the close below.
          setActiveSurface(action.surface as SurfaceId);
          return;
        case "tool":
          // handleTool clears the surface itself.
          handleTool(action.tool as ToolMode);
          return;
        case "home":
          // The camera only. Nothing about the watch, the layers or the
          // projection changes: a reader on the globe comes home on the
          // globe, and a reader who was looking at a storm keeps the storm's
          // layers when they come back to it.
          mapRef.current?.flyTo({
            center: current.watch.center,
            zoom: Math.max(current.camera.zoom, HOME_ZOOM),
            bearing: 0,
            pitch: 0,
          });
          break;
        case "ambientScreen":
          setAmbientAsked((on) => !on);
          handleTool(null);
          break;
        case "capture":
          setCapture((on) => !on);
          // Nothing the mode hides may be left armed behind it. The layout
          // change is its own announcement, so there is no toast: the mode
          // hides those, because a toast's action button changes what the
          // workspace comes back to and it cannot be seen to be pressed.
          handleTool(null);
          break;
      }
      // Everything else leaves the map showing rather than the list.
      setActiveSurface(null);
    },
    [
      applySettings,
      handleTool,
      mapRef,
      setActiveSurface,
      setAmbientAsked,
      setCapture,
      setLayersToFind,
      setProductOpen,
      settingsRef,
    ],
  );
  return runCommand;
}
