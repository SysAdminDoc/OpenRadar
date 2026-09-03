import { MAX_WATCH_PLACES } from "../lib/watch";
import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type { SurfaceId } from "../components/CommandBar";
import type { MapViewportHandle } from "../components/MapViewport";
import type { ToastMessage } from "../components/ToastHost";
import { deepLinkUrl, viewFromDeepLink, webLinkUrl } from "../lib/deepLink";
import { log } from "../lib/log";
import { looksLikePlacefile, parsePlacefile } from "../lib/placefile";
import { looksLikeKml, parseKml } from "../lib/kml";
import { readKmz } from "../lib/kmz";
import { looksLikeTheme, parseTheme } from "../lib/theme";
import { MAX_PALETTES, looksLikePalette, parsePalette } from "../lib/palette";
import {
  DEFAULT_SETTINGS,
  isDesktopRuntime,
  looksLikeSettings,
  normalizeSettings,
  withPalette,
  withoutPalette,
  type AppSettings,
  type CameraState,
  type ProjectionMode,
} from "../lib/settings";
import type { GeoPoint } from "../lib/geo";
import type { OverlayBounds } from "../lib/overlays";
import type { PlaceResult } from "../lib/weather";
import { translate } from "../i18n";
import { saveFile } from "../lib/saveFile";
import {
  createWorkspaceBackup,
  looksLikeWorkspaceBackup,
  restoreWorkspace,
} from "../lib/workspaceBackup";
import {
  addOverlayFile,
  isWorkspaceOverlay,
  MAX_WORKSPACE_OVERLAY_FEATURES,
  MAX_WORKSPACE_OVERLAY_FILES,
  overlayFileId,
  overlayShapeCount,
  type WorkspaceOverlayFile,
} from "../lib/workspaceOverlays";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export interface WorkspaceActions {
  /** Writes the whole workspace out as readable JSON. */
  exportSettings: () => Promise<void>;
  flyToBounds: (bounds: OverlayBounds) => void;
  followStorm: (point: GeoPoint, name?: string) => void;
  setProjection: (projection: ProjectionMode) => void;
  locate: () => void;
  goToPlace: (place: PlaceResult) => void;
  usePreset: (index: number) => void;
  share: () => Promise<void>;
  /**
   * Read a file the reader chose.
   *
   * `backupOnly` is what Restore from a file passes: the same reading, and a
   * refusal for anything that is not a saved workspace, because that control
   * promises one thing where the Upload panel promises to work out what it
   * has been given.
   */
  uploadOverlay: (file: File, backupOnly?: boolean) => Promise<void>;
  watchHere: () => void;
  /** Adds the map centre as another watched place, beside home. */
  addWatchPlace: () => void;
  openLogFolder: () => void;
  resetSettings: () => void;
}

/**
 * The command-bar actions that move the camera, keep views, hand out links, and
 * take files. They all need the map handle and the newest settings, so they sit
 * together rather than in the component that draws the workspace.
 */
/** A list written the way a person writes one, not joined with "and"s. */
function inWords(items: string[]): string {
  if (items.length < 3) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

export function useWorkspaceActions(options: {
  hydrated: boolean;
  mapRef: RefObject<MapViewportHandle | null>;
  settingsRef: { readonly current: AppSettings };
  applySettings: (next: AppSettings) => void;
  pushToast: (message: Omit<ToastMessage, "id">) => void;
  setActiveSurface: (surface: SurfaceId) => void;
  setOverlayFiles: Dispatch<SetStateAction<WorkspaceOverlayFile[]>>;
  overlayFiles: WorkspaceOverlayFile[];
}): WorkspaceActions {
  const {
    hydrated,
    mapRef,
    settingsRef,
    applySettings,
    pushToast,
    setActiveSurface,
    setOverlayFiles,
    overlayFiles,
  } = options;

  /**
   * The pending flight to a preset camera, so a newer one can cancel it.
   *
   * The delay exists because the style has to land before the camera moves.
   * It also means a second preset opened within it leaves two flights in the
   * air, and the later arrival wins rather than the later request.
   */
  const presetFlight = useRef<number | undefined>(undefined);

  // Leaving the workspace takes the pending flight with it.
  useEffect(() => () => window.clearTimeout(presetFlight.current), []);

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
          title: translate("toast.following", {
            name: name ?? translate("toast.theStorm"),
          }),
          detail: translate("toast.presetsFull"),
        });
        return;
      }

      const presets = [...current.presets];
      presets[slot] = {
        name: name ?? translate("toast.stormPreset"),
        camera,
        projection: current.projection,
        mapStyle: current.mapStyle,
      };
      applySettings(normalizeSettings({ ...current, presets }));
      pushToast({
        title: translate("toast.following", {
          name: name ?? translate("toast.theStorm"),
        }),
        detail: translate("toast.keptAs", { number: slot + 1 }),
      });
    },
    [applySettings, mapRef, pushToast, settingsRef],
  );

  const setProjection = useCallback(
    (projection: ProjectionMode) => {
      applySettings({ ...settingsRef.current, projection });
      pushToast({
        title:
          projection === "globe"
            ? translate("toast.globeOn")
            : translate("toast.flatOn"),
        detail: translate("toast.cameraUnchanged"),
      });
    },
    [applySettings, pushToast, settingsRef],
  );

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      pushToast({
        title: translate("toast.noLocation"),
        detail: translate("toast.searchInstead"),
      });
      return;
    }
    pushToast({ title: translate("toast.finding") });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        flyToPoint(position.coords.longitude, position.coords.latitude, 8);
        pushToast({ title: translate("toast.centeredOnYou") });
      },
      () =>
        pushToast({
          title: translate("toast.noPermission"),
          detail: translate("toast.nothingChanged"),
        }),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }, [flyToPoint, pushToast]);

  const goToPlace = useCallback(
    (place: PlaceResult) => {
      flyToPoint(place.lon, place.lat, 8);
      setActiveSurface(null);
      pushToast({
        title: translate("toast.centeredOn", { name: place.name }),
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
        //
        // Only the newest one, and only while the workspace is still here. Two
        // presets opened inside the delay used to leave two flights pending,
        // and the one that arrived second was the one that won: the reader saw
        // the view they asked for and then watched it slide to the one they had
        // asked for first.
        window.clearTimeout(presetFlight.current);
        presetFlight.current = window.setTimeout(
          () => mapRef.current?.flyTo(preset.camera),
          80,
        );
        pushToast({
          title: translate("toast.presetOpened", { name: preset.name }),
        });
        return;
      }

      const camera: CameraState = mapRef.current?.camera() ?? current.camera;
      const presets = [...current.presets];
      presets[index] = {
        name: translate("toast.presetName", { number: index + 1 }),
        camera,
        projection: current.projection,
        mapStyle: current.mapStyle,
      };
      applySettings(normalizeSettings({ ...current, presets }));
      pushToast({
        title: translate("toast.presetSaved", { number: index + 1 }),
        actionLabel: translate("toast.undo"),
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
        await navigator.share({
          title: translate("toast.shareTitle"),
          url: link,
        });
        pushToast({ title: translate("toast.shared") });
      } else {
        await navigator.clipboard.writeText(link);
        pushToast({ title: translate("toast.linkCopied"), detail: link });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      pushToast({
        title: translate("toast.linkFailed"),
        detail: translate("toast.linkFailedBody"),
      });
    }
  }, [mapRef, pushToast, settingsRef]);

  /**
   * Writes the whole workspace out as the same readable JSON it is stored in,
   * so a second machine or a reinstall can pick it back up.
   */
  const exportSettings = useCallback(async () => {
    try {
      const backup = createWorkspaceBackup(settingsRef.current, overlayFiles);
      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: "application/json",
      });
      const saved = await saveFile("openradar-workspace.json", blob);
      pushToast({
        title: translate("toast.settingsSaved"),
        detail: saved.path ?? translate("toast.settingsSavedBody"),
      });
    } catch (failure) {
      pushToast({
        title: translate("toast.settingsSaveFailed"),
        detail:
          failure instanceof Error
            ? failure.message
            : translate("toast.settingsSaveFailedBody"),
      });
    }
  }, [overlayFiles, pushToast, settingsRef]);

  const uploadOverlay = useCallback(
    async (
      file: File,
      /**
       * Refuse anything that is not a saved workspace.
       *
       * The Upload panel takes whatever a reader drops on it and works out
       * what it is. Restore from a file is a different promise: it says it
       * puts a backup back, and handing it a GeoJSON quietly added a map
       * overlay and closed the panel instead. The reading is shared so the
       * partial-restore note and the undo cannot drift; only the answer to
       * "is this the kind of file I was asked for" differs.
       */
      backupOnly = false,
    ) => {
      try {
        if (file.size > MAX_UPLOAD_BYTES) {
          throw new Error(translate("toast.fileTooBig"));
        }
        // A KMZ is a zip and is read as bytes; everything else is text. The
        // check is on the name because a zip read as text is mojibake and
        // every sniff below would fail on it in a confusing way.
        const isArchive = /.kmz$/i.test(file.name);
        const text = isArchive
          ? await readKmz(await file.arrayBuffer())
          : await file.text();

        if (
          backupOnly &&
          !looksLikeWorkspaceBackup(text) &&
          !looksLikeSettings(text)
        ) {
          pushToast({
            title: translate("toast.notABackup"),
            detail: translate("toast.notABackupBody"),
          });
          return;
        }

        // A colour table is not an overlay: it changes how the radar already
        // on screen is drawn, so it goes to the settings rather than the map.
        if (looksLikePalette(file.name, text)) {
          const palette = parsePalette(text, file.name);
          if (!palette) {
            throw new Error(translate("toast.paletteEmpty"));
          }
          // The renderer is not touched here. `usePalette` owns it and
          // reacts to the settings below, and applying it twice would bump
          // the generation twice and re-request every tile for nothing.
          const shelved = withPalette(settingsRef.current, palette);
          if (!shelved) {
            throw new Error(
              translate("toast.paletteFull", { count: MAX_PALETTES }),
            );
          }
          applySettings(shelved);
          setActiveSurface(null);
          const notes = [
            translate("toast.colours", { count: palette.stops.length }),
          ];
          if (palette.units) {
            notes.push(translate("toast.forUnits", { units: palette.units }));
          }
          if (palette.skipped.length) {
            notes.push(
              translate("toast.leftOut", { names: inWords(palette.skipped) }),
            );
          }
          pushToast({
            title: translate("toast.paletteApplied", { name: file.name }),
            detail: `${notes.join(", ")}.`,
            actionLabel: translate("toast.remove"),
            onAction: () =>
              applySettings(withoutPalette(settingsRef.current, palette.name)),
          });
          return;
        }

        // A theme is not an overlay either, and it is deliberately the one
        // import that cannot touch the map: it reaches the chrome tokens in
        // `theme.ts` and nothing else, so the toast can say so plainly.
        if (looksLikeTheme(file.name, text)) {
          const read = parseTheme(text, file.name);
          if (!read) throw new Error(translate("toast.themeEmpty"));
          const previous = {
            theme: settingsRef.current.theme,
            workspaceTheme: settingsRef.current.workspaceTheme,
          };
          // `Base` is the look the file was drawn against, so importing one
          // takes the workspace there. It is a statement about the file
          // rather than a setting of its own: the dark and light buttons
          // still work afterwards, and the theme stays on either way.
          applySettings({
            ...settingsRef.current,
            theme: read.theme.base,
            workspaceTheme: read.theme,
          });
          setActiveSurface(null);
          const notes = [
            translate("toast.themeBody", {
              count: Object.keys(read.theme.tokens).length,
            }),
          ];
          if (read.skipped.length) {
            notes.push(
              translate("toast.leftOut", { names: inWords(read.skipped) }),
            );
          }
          pushToast({
            title: translate("toast.themeApplied", { name: read.theme.name }),
            detail: notes.join(" "),
            actionLabel: translate("toast.undo"),
            onAction: () =>
              applySettings({ ...settingsRef.current, ...previous }),
          });
          return;
        }

        // A settings file is not an overlay either: it replaces the whole
        // workspace rather than drawing on it. Recognised by what it carries,
        // since a GeoJSON document never has a schema version.
        if (looksLikeWorkspaceBackup(text) || looksLikeSettings(text)) {
          const previous = settingsRef.current;
          const previousOverlay = overlayFiles;
          let restored: ReturnType<typeof restoreWorkspace>;
          try {
            restored = restoreWorkspace(JSON.parse(text));
          } catch {
            setActiveSurface(null);
            pushToast({
              title: translate("toast.workspaceInvalidTitle"),
              detail: translate("toast.workspaceInvalid"),
            });
            return;
          }
          applySettings(restored.settings);
          setOverlayFiles(restored.overlayFiles);
          mapRef.current?.flyTo(restored.settings.camera);
          setActiveSurface(null);
          // A file from a newer build, or one carrying keys this build has no
          // idea about, is not a full restore and must not be reported as one.
          const notes: string[] = [];
          if (restored.fromNewerBuild) {
            notes.push(translate("toast.settingsFromNewer"));
          }
          if (restored.unread.length) {
            notes.push(
              translate("toast.settingsUnread", {
                names: inWords(restored.unread),
              }),
            );
          }
          pushToast({
            title: translate(
              notes.length
                ? "toast.settingsRestoredPartly"
                : "toast.settingsRestored",
            ),
            detail: notes.length
              ? notes.join(" ")
              : translate("toast.settingsRestoredBody"),
            actionLabel: translate("toast.undo"),
            onAction: () => {
              applySettings(previous);
              setOverlayFiles(previousOverlay);
              mapRef.current?.flyTo(previous.camera);
            },
          });
          return;
        }

        // A settings file too broken to parse falls through to the overlay
        // reader, which then refuses it for not being a map. Say what it
        // actually is instead.
        if (/\.json$/i.test(file.name)) {
          try {
            JSON.parse(text);
          } catch {
            pushToast({
              title: translate("toast.settingsBroken"),
              detail: translate("toast.settingsBrokenBody"),
            });
            return;
          }
        }

        let payload: Record<string, unknown>;
        let detail = translate("toast.overlayLocal");

        if (isArchive || looksLikeKml(file.name, text)) {
          // The same parser the smoke analysis reads its own KML with, which
          // is the point of it being shared: a file a reader drops on the
          // window and a file the app fetches for itself go through one
          // reader, so a fix to one is a fix to both.
          const read = parseKml(text);
          if (!read.features.length) {
            throw new Error(translate("toast.kmlEmpty"));
          }
          payload = {
            type: "FeatureCollection",
            features: read.features,
          } as unknown as Record<string, unknown>;
          detail = `${translate("toast.shapes", {
            count: read.features.length,
          })}.`;
        } else if (looksLikePlacefile(text)) {
          const placefile = parsePlacefile(text);
          if (!placefile.data.features.length) {
            throw new Error(translate("toast.placefileEmpty"));
          }
          payload = placefile.data as unknown as Record<string, unknown>;
          const notes = [
            translate("toast.shapes", {
              count: placefile.data.features.length,
            }),
          ];
          if (placefile.refreshMinutes) {
            notes.push(
              translate("toast.refreshEvery", {
                minutes: placefile.refreshMinutes,
              }),
            );
          }
          if (placefile.skipped.length) {
            notes.push(
              translate("toast.leftOut", { names: inWords(placefile.skipped) }),
            );
          }
          if (placefile.truncated) notes.push(translate("toast.truncated"));
          detail = `${notes.join(", ")}.`;
        } else {
          payload = JSON.parse(text) as Record<string, unknown>;
          if (!payload || !isWorkspaceOverlay(payload)) {
            if (
              payload.type === "FeatureCollection" &&
              Array.isArray(payload.features) &&
              payload.features.length === 0
            ) {
              throw new Error(translate("toast.overlayEmpty"));
            }
            throw new Error(translate("toast.notGeoJson"));
          }
        }

        // Both formats end up as one collection, so the ceiling belongs here
        // rather than in each branch. It used to sit in the GeoJSON branch
        // only, and a placefile past it imported and drew and then disappeared
        // the first time a workspace backup was restored, because restore runs
        // the same check the import had skipped.
        if (overlayShapeCount(payload) > MAX_WORKSPACE_OVERLAY_FEATURES) {
          throw new Error(translate("toast.tooManyFeatures"));
        }

        const added = addOverlayFile(overlayFiles, file.name, payload);
        if (!added.ok) {
          throw new Error(
            translate("toast.overlaySetFull", {
              count: MAX_WORKSPACE_OVERLAY_FILES,
            }),
          );
        }
        // From the set as it stands, not the one this import read at the top:
        // reading a file is asynchronous, and a second import started while
        // the first was still reading would otherwise be computed from the
        // same base array and silently drop it. The check above still runs on
        // the older array, so in the one case where both races AND the set
        // fills in between, the toast says added and nothing was.
        setOverlayFiles((held) => {
          const again = addOverlayFile(held, file.name, payload);
          return again.ok ? again.files : held;
        });
        applySettings({
          ...settingsRef.current,
          layers: { ...settingsRef.current.layers, customOverlay: true },
        });
        setActiveSurface(null);
        pushToast({
          // Replacing is the surprising outcome, so it is the one that says so.
          title: translate(
            added.replaced ? "toast.overlayReplaced" : "toast.overlayAdded",
            { name: file.name },
          ),
          detail,
          actionLabel: translate("toast.remove"),
          onAction: () => {
            const id = overlayFileId(file.name);
            // Read from the set as it stands rather than the one this import
            // saw. Undo can be pressed after another file has been added, and
            // putting the older set back would take that one off the map.
            setOverlayFiles((held) => held.filter((each) => each.id !== id));
          },
        });
      } catch (error) {
        pushToast({
          title: translate("toast.overlayFailed"),
          detail:
            error instanceof Error
              ? error.message
              : translate("toast.unreadable"),
        });
      }
    },
    [
      applySettings,
      mapRef,
      overlayFiles,
      pushToast,
      setActiveSurface,
      setOverlayFiles,
      settingsRef,
    ],
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
      title: translate("toast.watching"),
      detail: translate("toast.watchingDetail"),
    });
  }, [applySettings, mapRef, pushToast, settingsRef]);

  const addWatchPlace = useCallback(() => {
    const settings = settingsRef.current;
    if (settings.watchPlaces.length >= MAX_WATCH_PLACES - 1) {
      pushToast({
        title: translate("toast.placesFull"),
        detail: translate("settings.placesFull", { count: MAX_WATCH_PLACES }),
      });
      return;
    }
    const camera = mapRef.current?.camera() ?? settings.camera;
    // Named for the order it was added in rather than left blank. A reader
    // renames it in place, and a place with no name at all cannot be told
    // apart in a notification.
    const name = translate("settings.placeNumber", {
      number: settings.watchPlaces.length + 2,
    });
    applySettings({
      ...settings,
      watchPlaces: [
        ...settings.watchPlaces,
        {
          // Unique without a random source, which keeps a settings file
          // reproducible: the time it was added is what makes it its own.
          id: `place-${Date.now().toString(36)}`,
          name,
          // Everything else follows home, which is the only setting the
          // reader has already thought about.
          ...settings.watch,
          enabled: true,
          center: camera.center,
        },
      ],
    });
    pushToast({
      title: translate("toast.placeAdded", { place: name }),
      detail: translate("toast.watchingDetail"),
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
          title: translate("toast.logsFailed"),
          detail: translate("toast.logsDesktop"),
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
      title: translate("toast.settingsReset"),
      actionLabel: translate("toast.undo"),
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
      pushToast({ title: translate("toast.sharedViewOpened") });
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
    exportSettings,
    flyToBounds,
    followStorm,
    setProjection,
    locate,
    goToPlace,
    usePreset,
    share,
    uploadOverlay,
    watchHere,
    addWatchPlace,
    openLogFolder,
    resetSettings,
  };
}
