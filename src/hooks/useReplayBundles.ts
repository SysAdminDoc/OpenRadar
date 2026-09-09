import type { ToastMessage } from "../components/ToastHost";
import type { WorkspaceOverlayFile } from "../lib/workspaceOverlays";
import type { AppSettings } from "../lib/settings";
import type { ArchiveReplay } from "./useRadarTimeline";
import type { MapViewportHandle } from "../components/MapViewport";
import {
  bundleErrorText,
  bundleMissingNote,
  bundleReplay,
  captureReplayBundle,
  captureRequestFor,
  closeReplayBundle,
  openReplayBundle,
  pickBundleFile,
} from "../lib/replayBundle";
import {
  createWorkspaceBackup,
  restoreWorkspace,
} from "../lib/workspaceBackup";
import { formatNumber, translate } from "../i18n";
import { loadStorm, type Storm } from "../lib/hurdat";
import { useCallback, useEffect, useRef, type RefObject } from "react";

/**
 * A replay, and the file one can be saved into and opened from.
 *
 * A bundle answers for its own addresses ahead of the network, so leaving
 * the replay it holds has to close it however the reader left: stopping,
 * picking another storm, opening another bundle. That is tied to the replay
 * itself rather than to the one button that used to do it, because every
 * other route out left a quarter of a gigabyte in memory answering for tiles
 * nobody was replaying.
 */
export interface ReplayBundleOptions {
  replay: ArchiveReplay | null;
  /** The storm whose track is drawn, which a bundle carries and restores. */
  historyStorm: Storm | null;
  setHistoryStorm: (storm: Storm | null) => void;
  /** The reader's own imported shapes, which a bundle carries too. */
  overlayFiles: WorkspaceOverlayFile[];
  setOverlayFiles: (files: WorkspaceOverlayFile[]) => void;
  setReplay: (next: ArchiveReplay | null) => void;
  mapRef: RefObject<MapViewportHandle | null>;
  settingsRef: { current: AppSettings };
  onSettings: (next: AppSettings) => void;
  pushToast: (toast: Omit<ToastMessage, "id">) => void;
}

export function useReplayBundles({
  replay,
  historyStorm,
  setHistoryStorm,
  overlayFiles,
  setOverlayFiles,
  setReplay,
  mapRef,
  settingsRef,
  onSettings: applySettings,
  pushToast,
}: ReplayBundleOptions) {
  // An open bundle answers for its own addresses ahead of the network, so
  // leaving its replay has to close it however the reader left: stopping,
  // picking a storm, opening another bundle. Tied to the replay itself rather
  // than to the one button that used to do it, because every other route out
  // left up to 256 MB in memory answering for tiles nobody was replaying.
  const openBundleRef = useRef<string | null>(null);
  useEffect(() => {
    const now = replay?.id.startsWith("bundle:") ? replay.id : null;
    if (openBundleRef.current && openBundleRef.current !== now) {
      void closeReplayBundle();
    }
    openBundleRef.current = now;
  }, [replay]);

  const stopReplay = useCallback(() => {
    setReplay(null);
    if (!replay) return;
    // A replay drawn from a bundle cannot be put back from a toast: its bytes
    // are in a file that would have to be opened again.
    if (replay.id.startsWith("bundle:")) {
      pushToast({
        title: translate("toast.replayStopped"),
        detail: translate("toast.replayStoppedBody"),
      });
      return;
    }
    pushToast({
      title: translate("toast.replayStopped"),
      detail: translate("toast.replayStoppedBody"),
      actionLabel: translate("toast.undo"),
      onAction: () => setReplay(replay),
    });
    // Depends on the replay itself rather than a ref read during render, which
    // React refuses. It changes when a storm is chosen, which is rare.
  }, [pushToast, replay, setReplay]);

  // One file that keeps this replay's frames and warnings byte for byte,
  // written natively into the export folder. The reader's workspace goes in
  // only when they ticked the box.
  const saveReplayBundle = useCallback(
    async (includeWorkspace: boolean) => {
      if (!replay) return;
      const bounds = mapRef.current?.bounds();
      const camera = mapRef.current?.camera() ?? settingsRef.current.camera;
      if (!bounds) {
        pushToast({
          title: translate("toast.bundleFailed"),
          detail: translate("bundle.error.noView"),
        });
        return;
      }
      const request = captureRequestFor({
        replay,
        storm: historyStorm,
        bounds,
        camera,
        workspace: includeWorkspace
          ? createWorkspaceBackup(settingsRef.current, overlayFiles)
          : null,
      });
      if (!request) return;
      pushToast({ title: translate("toast.bundleSaving") });
      try {
        const report = await captureReplayBundle(request);
        const notes = [
          translate("toast.bundleSavedBody", {
            entries: report.entries,
            size: formatNumber(report.bytes / 1_048_576, 1),
            path: report.path,
          }),
        ];
        if (report.missing.length) {
          notes.push(
            translate("toast.bundleMissing", { count: report.missing.length }),
          );
        }
        pushToast({
          title: translate("toast.bundleSaved"),
          detail: notes.join(" "),
        });
      } catch (failure: unknown) {
        pushToast({
          title: translate("toast.bundleFailed"),
          detail: bundleErrorText(failure),
        });
      }
    },
    [historyStorm, mapRef, overlayFiles, pushToast, replay, settingsRef],
  );

  // A bundle's workspace is somebody's home and watched places. It is applied
  // on this and never on opening the bundle.
  const applyBundledWorkspace = useCallback(
    (value: unknown) => {
      // Somebody else's home, watched places and saved views, out of a file
      // that was sent to this reader. It gets exactly what a workspace file
      // gets: a note when it is only a partial restore, and an undo.
      const previous = settingsRef.current;
      const previousOverlay = overlayFiles;
      try {
        const restored = restoreWorkspace(value);
        applySettings(restored.settings);
        setOverlayFiles(restored.overlayFiles);
        mapRef.current?.flyTo(restored.settings.camera);
        const notes: string[] = [];
        if (restored.fromNewerBuild) {
          notes.push(translate("toast.settingsFromNewer"));
        }
        if (restored.unread.length) {
          notes.push(
            translate("toast.settingsUnread", {
              names: restored.unread.join(", "),
            }),
          );
        }
        pushToast({
          title: translate(
            notes.length
              ? "toast.bundleWorkspacePartly"
              : "toast.bundleWorkspaceApplied",
          ),
          detail: notes.length ? notes.join(" ") : undefined,
          actionLabel: translate("toast.undo"),
          onAction: () => {
            applySettings(previous);
            setOverlayFiles(previousOverlay);
            mapRef.current?.flyTo(previous.camera);
          },
        });
      } catch {
        pushToast({
          title: translate("toast.workspaceInvalidTitle"),
          detail: translate("toast.workspaceInvalid"),
        });
      }
    },
    [
      applySettings,
      mapRef,
      overlayFiles,
      pushToast,
      setOverlayFiles,
      settingsRef,
    ],
  );

  // A bundle is opened through the operating system's picker, so its bytes
  // never cross into the page: the native side reads and checks the file and
  // answers with what it holds. Nothing here changes until it has.
  const openBundle = useCallback(async () => {
    try {
      const path = await pickBundleFile();
      if (!path) return;
      const manifest = await openReplayBundle(path);
      const next = bundleReplay(manifest);
      if (!next) {
        // Opening replaced whatever bundle was already answering, so the one
        // before this is gone whether or not this one is usable. Say so and
        // put the map back on live radar rather than leaving a replay whose
        // frames now quietly come off the network.
        await closeReplayBundle();
        const wasBundled = openBundleRef.current !== null;
        if (wasBundled) setReplay(null);
        pushToast({
          title: translate("toast.bundleFailed"),
          detail: wasBundled
            ? `${translate("bundle.error.noFrames")} ${translate("bundle.error.letGo")}`
            : translate("bundle.error.noFrames"),
        });
        return;
      }
      // The storm's track from the bundled record. A storm the record has
      // never heard of is still replayed, without a track.
      let storm: Storm | null = null;
      if (manifest.storm) {
        try {
          storm = await loadStorm(manifest.storm.id);
        } catch {
          storm = null;
        }
      }
      setHistoryStorm(storm);
      setReplay(next);
      mapRef.current?.flyTo({
        center: manifest.camera.center,
        zoom: manifest.camera.zoom,
        bearing: manifest.camera.bearing,
        pitch: manifest.camera.pitch,
      });
      const missing = bundleMissingNote(manifest);
      pushToast({
        title: translate("toast.bundleOpened", { label: manifest.label }),
        detail: [
          translate("toast.bundleOpenedBody", {
            frames: next.frames.length,
            made: manifest.createdAt.slice(0, 10),
          }),
          missing,
        ]
          .filter((line): line is string => Boolean(line))
          .join(" "),
        ...(manifest.workspace
          ? {
              actionLabel: translate("toast.bundleApplyWorkspace"),
              onAction: () => applyBundledWorkspace(manifest.workspace),
            }
          : {}),
      });
    } catch (failure: unknown) {
      pushToast({
        title: translate("toast.bundleFailed"),
        detail: bundleErrorText(failure),
      });
    }
  }, [applyBundledWorkspace, mapRef, pushToast, setHistoryStorm, setReplay]);
  return { stopReplay, saveReplayBundle, openBundle };
}
