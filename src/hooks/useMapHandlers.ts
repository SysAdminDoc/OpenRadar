import type { RefObject } from "react";
import type { AppSettings, CameraState } from "../lib/settings";
import type { ArchiveReplay } from "./useRadarTimeline";
import type { Curiosity } from "../lib/curiosities";
import type { MapViewportHandle } from "../components/MapViewport";
import type { OverlayBounds } from "../lib/overlays";
import type { SurfaceId, ToolMode } from "../components/CommandBar";
import { useCallback, useEffect } from "react";
import { useCuriosities } from "./useCuriosities";
import { useWorkspaceOverlays } from "./useWorkspaceOverlays";

/**
 * What the map itself calls back into.
 *
 * Where the camera came to rest, whether the renderer came up, and which
 * tool is armed. The resting camera is the only moment anything is looked
 * for, so the curiosity search sits here beside it rather than a screen
 * away: it is held apart from the settings camera on purpose, because that
 * one is written on a debounce and is a record of where to open next time
 * rather than a signal that the reader has stopped moving.
 */
export interface MapHandlerOptions {
  settings: AppSettings;
  settingsRef: { current: AppSettings };
  onSettings: (next: AppSettings) => void;
  hydrated: boolean;
  overlays: ReturnType<typeof useWorkspaceOverlays>;
  replay: ArchiveReplay | null;
  /** Where the camera came to rest, which is what is searched. */
  resting: { center: [number, number]; zoom: number } | null;
  setResting: (at: { center: [number, number]; zoom: number }) => void;
  setCuriosity: (found: Curiosity) => void;
  updateCamera: (camera: CameraState) => void;
  setViewport: (bounds: OverlayBounds | null) => void;
  setMapStatus: (status: "loading" | "ready" | "error" | "nogpu") => void;
  setActiveTool: (tool: ToolMode) => void;
  setActiveSurface: (surface: SurfaceId) => void;
  mapRef: RefObject<MapViewportHandle | null>;
  /** Held still while a loop export walks the volumes it started with. */
  writingLoopRef: { current: boolean };
  setProductOpen: (open: boolean) => void;
  secondMapRef: RefObject<MapViewportHandle | null>;
  exportBusy: string | null;
}

export function useMapHandlers({
  settings,
  settingsRef,
  onSettings: applySettings,
  hydrated,
  overlays,
  replay,
  resting,
  setResting,
  setCuriosity,
  updateCamera,
  setViewport,
  setMapStatus,
  setActiveTool,
  setActiveSurface,
  mapRef,
  writingLoopRef,
  setProductOpen,
  secondMapRef,
  exportBusy,
}: MapHandlerOptions) {
  const handleCameraChange = useCallback(
    (camera: CameraState) => {
      updateCamera(camera);
      setViewport(mapRef.current?.bounds() ?? null);
      setResting({ center: camera.center, zoom: camera.zoom });
    },
    [mapRef, setResting, setViewport, updateCamera],
  );

  useCuriosities({
    // Nothing discoverable reveals itself while a warning is in force at a
    // watched place. The standing rule, and the reason this is safe to ship.
    enabled:
      hydrated &&
      settings.curiosities &&
      // Nothing discoverable in the calmer presentation either: somebody who
      // asked for less is not asking to be surprised.
      !settings.calm &&
      !overlays.alertActive &&
      !replay,
    camera: resting,
    already: settings.curiositiesFound,
    onFound: useCallback(
      (found: Curiosity) => {
        setCuriosity(found);
        applySettings({
          ...settingsRef.current,
          curiositiesFound: [...settingsRef.current.curiositiesFound, found.id],
        });
      },
      [applySettings, setCuriosity, settingsRef],
    ),
  });

  // A walk of thirty volumes outlives the listing's own refresh, and a
  // refresh drops the oldest volume to make room for the newest. Held still,
  // the walk finishes against the list it started with.
  useEffect(() => {
    writingLoopRef.current = exportBusy === "loop" || exportBusy === "gif";
  }, [exportBusy, writingLoopRef]);

  const handleMapStatus = useCallback(
    (status: "loading" | "ready" | "error" | "nogpu") => {
      setMapStatus(status);
      if (status === "ready") setViewport(mapRef.current?.bounds() ?? null);
    },
    [mapRef, setMapStatus, setViewport],
  );

  const handleTool = useCallback(
    (tool: ToolMode) => {
      setActiveSurface(null);
      setProductOpen(false);
      setActiveTool(tool);
      if (!tool) {
        mapRef.current?.clearTools();
        secondMapRef.current?.clearTools();
      }
    },
    [mapRef, secondMapRef, setActiveSurface, setActiveTool, setProductOpen],
  );
  return { handleCameraChange, handleMapStatus, handleTool };
}
