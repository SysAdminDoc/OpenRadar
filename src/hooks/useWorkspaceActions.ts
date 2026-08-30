import { useCallback, useEffect, type RefObject } from "react";
import type { SurfaceId } from "../components/CommandBar";
import type { MapViewportHandle } from "../components/MapViewport";
import type { ToastMessage } from "../components/ToastHost";
import { deepLinkUrl, viewFromDeepLink, webLinkUrl } from "../lib/deepLink";
import { log } from "../lib/log";
import { looksLikePlacefile, parsePlacefile } from "../lib/placefile";
import {
  DEFAULT_SETTINGS,
  isDesktopRuntime,
  normalizeSettings,
  type AppSettings,
  type CameraState,
  type ProjectionMode,
} from "../lib/settings";
import type { GeoPoint } from "../lib/geo";
import type { OverlayBounds } from "../lib/overlays";
import type { PlaceResult } from "../lib/weather";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_OVERLAY_FEATURES = 5000;

export interface WorkspaceActions {
  flyToBounds: (bounds: OverlayBounds) => void;
  followStorm: (point: GeoPoint, name?: string) => void;
  setProjection: (projection: ProjectionMode) => void;
  locate: () => void;
  goToPlace: (place: PlaceResult) => void;
  usePreset: (index: number) => void;
  share: () => Promise<void>;
  uploadOverlay: (file: File) => Promise<void>;
  watchHere: () => void;
  openLogFolder: () => void;
  resetSettings: () => void;
}

/**
 * The command-bar actions that move the camera, keep views, hand out links, and
 * take files. They all need the map handle and the newest settings, so they sit
 * together rather than in the component that draws the workspace.
 */
export function useWorkspaceActions(options: {
  hydrated: boolean;
  mapRef: RefObject<MapViewportHandle | null>;
  settingsRef: { readonly current: AppSettings };
  applySettings: (next: AppSettings) => void;
  pushToast: (message: Omit<ToastMessage, "id">) => void;
  setActiveSurface: (surface: SurfaceId) => void;
  setCustomOverlay: (overlay: Record<string, unknown> | null) => void;
}): WorkspaceActions {
  const {
    hydrated,
    mapRef,
    settingsRef,
    applySettings,
    pushToast,
    setActiveSurface,
    setCustomOverlay,
  } = options;

  const flyToPoint = useCallback(
    (lon: number, lat: number, zoom: number) => {
      mapRef.current?.flyTo({
        center: [lon, lat],
        zoom,
        bearing: 0,
        pitch: settingsRef.current.projection === "globe" ? 20 : 0,
      });
    },
    [mapRef, settingsRef],
  );

  const flyToBounds = useCallback(
    (bounds: OverlayBounds) => {
      mapRef.current?.flyTo({
        center: [
          (bounds.west + bounds.east) / 2,
          (bounds.south + bounds.north) / 2,
        ],
        zoom: 7.5,
        bearing: 0,
        pitch: 0,
      });
    },
    [mapRef],
  );

  const followStorm = useCallback(
    (point: GeoPoint, name?: string) => {
      const camera: CameraState = {
        center: [point.lon, point.lat],
        zoom: 5.5,
        bearing: 0,
        pitch: 0,
      };
      mapRef.current?.flyTo(camera);

      // Following a storm is something you come back to, so it is kept in the
      // first free slot rather than left for the user to save by hand.
      const current = settingsRef.current;
      const slot = current.presets.findIndex((preset) => preset === null);
      if (slot < 0) {
        pushToast({
          title: `Following ${name ?? "the storm"}`,
          detail: "Every preset slot is taken, so this view was not kept.",
        });
        return;
      }

      const presets = [...current.presets];
      presets[slot] = {
        name: name ?? "Storm",
        camera,
        projection: current.projection,
        mapStyle: current.mapStyle,
      };
      applySettings(normalizeSettings({ ...current, presets }));
      pushToast({
        title: `Following ${name ?? "the storm"}`,
        detail: `Kept as preset ${slot + 1}.`,
      });
    },
    [applySettings, mapRef, pushToast, settingsRef],
  );

  const setProjection = useCallback(
    (projection: ProjectionMode) => {
      applySettings({ ...settingsRef.current, projection });
      pushToast({
        title:
          projection === "globe" ? "Globe projection on" : "Flat projection on",
        detail: "Your center, zoom, bearing, and pitch are unchanged.",
      });
    },
    [applySettings, pushToast, settingsRef],
  );

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      pushToast({
        title: "Location is not available",
        detail: "Search can still move the map.",
      });
      return;
    }
    pushToast({ title: "Finding your location" });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        flyToPoint(position.coords.longitude, position.coords.latitude, 8);
        pushToast({ title: "Map centered on your location" });
      },
      () =>
        pushToast({
          title: "Location permission was not available",
          detail: "Nothing changed.",
        }),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }, [flyToPoint, pushToast]);

  const goToPlace = useCallback(
    (place: PlaceResult) => {
      flyToPoint(place.lon, place.lat, 8);
      setActiveSurface(null);
      pushToast({
        title: `Centered on ${place.name}`,
        detail: place.region || place.country,
      });
    },
    [flyToPoint, pushToast, setActiveSurface],
  );

  const usePreset = useCallback(
    (index: number) => {
      const current = settingsRef.current;
      const preset = current.presets[index];
      if (preset) {
        applySettings(
          normalizeSettings({
            ...current,
            camera: preset.camera,
            projection: preset.projection,
            mapStyle: preset.mapStyle,
          }),
        );
        // The style change lands first; the camera follows once it has.
        window.setTimeout(() => mapRef.current?.flyTo(preset.camera), 80);
        pushToast({ title: `${preset.name} opened` });
        return;
      }

      const camera: CameraState = mapRef.current?.camera() ?? current.camera;
      const presets = [...current.presets];
      presets[index] = {
        name: `Preset ${index + 1}`,
        camera,
        projection: current.projection,
        mapStyle: current.mapStyle,
      };
      applySettings(normalizeSettings({ ...current, presets }));
      pushToast({
        title: `Preset ${index + 1} saved`,
        actionLabel: "Undo",
        onAction: () => {
          const undone = [...settingsRef.current.presets];
          undone[index] = null;
          applySettings({ ...settingsRef.current, presets: undone });
        },
      });
    },
    [applySettings, mapRef, pushToast, settingsRef],
  );

  const share = useCallback(async () => {
    const view = {
      camera: mapRef.current?.camera() ?? settingsRef.current.camera,
      projection: settingsRef.current.projection,
    };
    // Inside the app the address bar reads http://tauri.localhost, which opens
    // nothing, so the desktop build hands out its own scheme instead.
    const link = isDesktopRuntime()
      ? deepLinkUrl(view)
      : webLinkUrl(view, window.location.href);

    try {
      if (navigator.share) {
        await navigator.share({ title: "OpenRadar view", url: link });
        pushToast({ title: "Map view shared" });
      } else {
        await navigator.clipboard.writeText(link);
        pushToast({ title: "Map link copied", detail: link });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      pushToast({ title: "The map link could not be copied" });
    }
  }, [mapRef, pushToast, settingsRef]);

  const uploadOverlay = useCallback(
    async (file: File) => {
      try {
        if (file.size > MAX_UPLOAD_BYTES) {
          throw new Error("The file is larger than 5 MB.");
        }
        const text = await file.text();
        let payload: Record<string, unknown>;
        let detail = "The overlay stays on this device.";

        if (looksLikePlacefile(text)) {
          const placefile = parsePlacefile(text);
          if (!placefile.data.features.length) {
            throw new Error("That placefile has nothing this map can draw.");
          }
          payload = placefile.data as unknown as Record<string, unknown>;
          const notes = [`${placefile.data.features.length} shapes`];
          if (placefile.refreshMinutes) {
            notes.push(
              `it asks to be refreshed every ${placefile.refreshMinutes} min`,
            );
          }
          if (placefile.skipped.length) {
            notes.push(`${placefile.skipped.join(" and ")} left out`);
          }
          if (placefile.truncated) notes.push("the file ended mid-shape");
          detail = `${notes.join(", ")}.`;
        } else {
          payload = JSON.parse(text) as Record<string, unknown>;
          if (
            !payload ||
            (payload.type !== "FeatureCollection" && payload.type !== "Feature")
          ) {
            throw new Error("Choose a GeoJSON file or a GRLevelX placefile.");
          }
          const features = payload.features;
          if (
            payload.type === "FeatureCollection" &&
            (!Array.isArray(features) || features.length > MAX_OVERLAY_FEATURES)
          ) {
            throw new Error(
              "A custom overlay can contain up to 5,000 features.",
            );
          }
        }

        setCustomOverlay(payload);
        applySettings({
          ...settingsRef.current,
          layers: { ...settingsRef.current.layers, customOverlay: true },
        });
        setActiveSurface(null);
        pushToast({
          title: `${file.name} added`,
          detail,
          actionLabel: "Remove",
          onAction: () => setCustomOverlay(null),
        });
      } catch (error) {
        pushToast({
          title: "Overlay could not be added",
          detail:
            error instanceof Error
              ? error.message
              : "The file could not be read.",
        });
      }
    },
    [applySettings, pushToast, setActiveSurface, setCustomOverlay, settingsRef],
  );

  const watchHere = useCallback(() => {
    const camera = mapRef.current?.camera() ?? settingsRef.current.camera;
    applySettings({
      ...settingsRef.current,
      watch: {
        ...settingsRef.current.watch,
        enabled: true,
        center: camera.center,
      },
    });
    pushToast({
      title: "Watching this point",
      detail: "Warnings near it will interrupt you.",
    });
  }, [applySettings, mapRef, pushToast, settingsRef]);

  const openLogFolder = useCallback(() => {
    void (async () => {
      try {
        const [{ appLogDir }, { revealItemInDir }] = await Promise.all([
          import("@tauri-apps/api/path"),
          import("@tauri-apps/plugin-opener"),
        ]);
        await revealItemInDir(await appLogDir());
      } catch {
        pushToast({
          title: "The log folder could not be opened",
          detail: "Logs are only written by the desktop app.",
        });
      }
    })();
  }, [pushToast]);

  const resetSettings = useCallback(() => {
    const previous = settingsRef.current;
    const reset = normalizeSettings(DEFAULT_SETTINGS);
    applySettings(reset);
    mapRef.current?.flyTo(reset.camera);
    pushToast({
      title: "Settings reset",
      actionLabel: "Undo",
      onAction: () => {
        applySettings(previous);
        mapRef.current?.flyTo(previous.camera);
      },
    });
  }, [applySettings, mapRef, pushToast, settingsRef]);

  const applySharedView = useCallback(
    (link: string) => {
      const view = viewFromDeepLink(link, settingsRef.current.camera);
      if (!view) return;
      applySettings({
        ...settingsRef.current,
        camera: view.camera,
        projection: view.projection,
      });
      mapRef.current?.flyTo(view.camera);
      pushToast({ title: "Opened a shared view" });
    },
    [applySettings, mapRef, pushToast, settingsRef],
  );

  useEffect(() => {
    if (!hydrated || !isDesktopRuntime()) return;
    let stop: (() => void) | null = null;
    let active = true;

    void (async () => {
      const { getCurrent, onOpenUrl } =
        await import("@tauri-apps/plugin-deep-link");
      if (!active) return;
      // A link that started the app arrives here; later ones come through the
      // listener, because the single-instance plugin routes them to this window.
      const startup = await getCurrent();
      if (active && startup?.length) applySharedView(startup[0]);
      const unlisten = await onOpenUrl((urls) => {
        if (urls.length) applySharedView(urls[0]);
      });
      if (active) stop = unlisten;
      else unlisten();
    })().catch(() => {
      log.warn("app", "Shared links are not available in this build.");
    });

    return () => {
      active = false;
      stop?.();
    };
  }, [applySharedView, hydrated]);

  return {
    flyToBounds,
    followStorm,
    setProjection,
    locate,
    goToPlace,
    usePreset,
    share,
    uploadOverlay,
    watchHere,
    openLogFolder,
    resetSettings,
  };
}
