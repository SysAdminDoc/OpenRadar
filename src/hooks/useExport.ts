import { useCallback, useState, type RefObject } from "react";
import type { MapViewportHandle } from "../components/MapViewport";
import type { ToastMessage } from "../components/ToastHost";
import {
  exportFileName,
  exportLoop,
  exportStill,
  type ExportCaption,
} from "../lib/export";
import { log } from "../lib/log";
import type { RadarProvider } from "../lib/providers";
import { formatFrameTime, type RadarFrame } from "../lib/radar";
import { saveFile } from "../lib/saveFile";
import type { RadarTimelineState } from "./useRadarTimeline";
import { translate } from "../i18n";

export interface ExportState {
  /** Which export is running, or null when none is. */
  busy: string | null;
  progress: { done: number; total: number } | null;
  exportImage: () => void;
  exportLoopVideo: () => void;
}

export function useExport(options: {
  mapRef: RefObject<MapViewportHandle | null>;
  frames: RadarFrame[];
  frameIndex: number;
  source: RadarProvider | null;
  timeline: RadarTimelineState;
  pushToast: (message: Omit<ToastMessage, "id">) => void;
}): ExportState {
  const { mapRef, frames, frameIndex, source, timeline, pushToast } = options;
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  const captionFor = useCallback(
    (index: number): ExportCaption => {
      const frame = frames[index];
      return {
        lines: [
          frame?.forecast
            ? `${formatFrameTime(frame)} forecast`
            : formatFrameTime(frame),
          frame?.forecast
            ? translate("export.hrrr", {
                minutes: frame.forecast.leadMinutes,
              })
            : (source?.label ?? translate("export.radar")),
        ].filter(Boolean),
        attribution: "OpenRadar · OpenStreetMap · NOAA",
      };
    },
    [frames, source],
  );

  const finish = useCallback(
    async (name: string, blob: Blob) => {
      const saved = await saveFile(name, blob);
      pushToast({
        title: translate("export.saved", { name }),
        detail: saved.path ?? translate("export.downloads"),
        actionLabel: saved.path ? translate("export.show") : undefined,
        onAction: saved.path
          ? () =>
              void import("@tauri-apps/plugin-opener").then((opener) =>
                opener.revealItemInDir(saved.path as string).catch(() => {}),
              )
          : undefined,
      });
    },
    [pushToast],
  );

  const exportImage = useCallback(() => {
    void (async () => {
      const canvas = mapRef.current?.canvas();
      if (!canvas) return;
      setBusy("image");
      try {
        const blob = await exportStill(canvas, captionFor(frameIndex));
        await finish(exportFileName("openradar", "png"), blob);
      } catch (failure) {
        log.warn(
          "export",
          failure instanceof Error
            ? failure.message
            : translate("export.failed"),
        );
        pushToast({ title: translate("export.imageFailed") });
      } finally {
        setBusy(null);
      }
    })();
  }, [captionFor, finish, frameIndex, mapRef, pushToast]);

  const exportLoopVideo = useCallback(() => {
    void (async () => {
      const canvas = mapRef.current?.canvas();
      if (!canvas || frames.length < 2) return;
      setBusy("loop");
      timeline.setPlaying(false);
      try {
        const blob = await exportLoop({
          source: canvas,
          frameCount: frames.length,
          showFrame: async (index) => {
            timeline.selectFrame(index);
            await mapRef.current?.onceIdle();
          },
          captionFor,
          onProgress: (done, total) => setProgress({ done, total }),
        });
        await finish(exportFileName("openradar-loop", "webm"), blob);
      } catch (failure) {
        log.warn(
          "export",
          failure instanceof Error
            ? failure.message
            : translate("export.failed"),
        );
        pushToast({
          title: translate("export.loopFailed"),
          detail:
            failure instanceof Error
              ? failure.message
              : translate("export.nothingWritten"),
        });
      } finally {
        setBusy(null);
        setProgress(null);
      }
    })();
  }, [captionFor, finish, frames.length, mapRef, pushToast, timeline]);

  return { busy, progress, exportImage, exportLoopVideo };
}
