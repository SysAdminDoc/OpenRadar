import { useCallback, useMemo, useRef, useState, type RefObject } from "react";
import type { MapViewportHandle } from "../components/MapViewport";
import type { ToastMessage } from "../components/ToastHost";
import {
  exportFileName,
  exportLoop,
  exportLoopGif,
  exportStill,
  provenanceFileName,
  type ExportCaption,
} from "../lib/export";
import {
  dataExportErrorText,
  exportSize,
  type DataExportReport,
} from "../lib/dataExport";
import { log } from "../lib/log";
import type { OverlayBounds } from "../lib/overlays";
import type { RadarProvider } from "../lib/providers";
import {
  provenanceCredit,
  provenanceDocument,
  timelineProvenance,
  type Provenance,
} from "../lib/provenance";
import { formatFrameTime, type RadarFrame } from "../lib/radar";
import { saveFile } from "../lib/saveFile";
import { APP_VERSION } from "../lib/settings";
import type { RadarTimelineState } from "./useRadarTimeline";
import { formatNumber, translate } from "../i18n";

/** One dataset on screen whose readings can be written out. */
export interface DataExportSource {
  id: string;
  label: string;
  /** The file extension, said plainly beside the button. */
  format: string;
  /**
   * The view at the moment the button was pressed, for a dataset that is cut
   * to it, and null when the map has not settled on one. It is read here
   * rather than by the caller because the caller builds this list during a
   * render, and a camera read then is a camera from before the last move.
   */
  run: (view: OverlayBounds | null) => Promise<DataExportReport>;
}

export interface ExportState {
  /** Which export is running, or null when none is. */
  busy: string | null;
  progress: { done: number; total: number } | null;
  exportImage: () => void;
  exportLoopVideo: () => void;
  /** The same loop as a GIF, which pastes into places a WebM does not. */
  exportLoopGifFile: () => void;
  /** The readings behind the picture, wrapped so the panel only clicks. */
  dataExports: Array<{
    id: string;
    label: string;
    format: string;
    run: () => void;
  }>;
}

export function useExport(options: {
  mapRef: RefObject<MapViewportHandle | null>;
  frames: RadarFrame[];
  frameIndex: number;
  source: RadarProvider | null;
  timeline: RadarTimelineState;
  /**
   * Credit for the map under the weather, for the style actually on screen.
   *
   * Passed in rather than worked out here, because the style, the theme and
   * any incident pack are all settled where the map is drawn, and a second
   * copy of that resolution would be a second thing to keep in step.
   */
  basemapCredit: string;
  /** Datasets drawn right now, in the order the panel should offer them. */
  dataSources: DataExportSource[];
  pushToast: (message: Omit<ToastMessage, "id">) => void;
}): ExportState {
  const {
    mapRef,
    frames,
    frameIndex,
    source,
    timeline,
    basemapCredit,
    dataSources,
    pushToast,
  } = options;
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  // What the encoder actually put in the file, by frame index.
  //
  // Only the encoder knows this. A still writes one frame, a WebM writes all
  // of them, and a GIF writes the last two dozen; asking each of them would be
  // three answers to keep in step with three encoders. Every one of them asks
  // for a caption exactly once per frame it draws, so the captions are the
  // record of what was drawn.
  const drawnRef = useRef(new Map<number, Provenance>());

  const captionFor = useCallback(
    (index: number): ExportCaption => {
      const frame = frames[index];
      // The caption is written from the frame's provenance rather than from
      // the frame, so the words burned into a picture and the record the app
      // would report about that same picture cannot drift apart. A forecast
      // exported as though it were an observation is exactly the mistake the
      // record exists to make impossible, and an exported file outlives every
      // other place the distinction is shown.
      //
      // Through the same builder the diagnostics block uses, so the exported
      // record carries the cache age and the freshness the loop publishes on
      // rather than a pair of nulls saying the bytes came off the network.
      const record = timelineProvenance({
        frames,
        frameIndex: index,
        provider: source,
        fetchedAt: timeline.fetchedAt,
        cachedAgeSeconds: timeline.cachedAgeSeconds,
      });
      if (record) drawnRef.current.set(index, record);
      return {
        lines: [
          record?.kind === "forecast"
            ? `${formatFrameTime(frame)} forecast`
            : formatFrameTime(frame),
          record?.modelRun
            ? translate("export.hrrr", {
                minutes: record.modelRun.leadMinutes,
              })
            : // The record always carries a label, and where no provider
              // matched the frame that label is the bare provider id. An
              // archive replay would burn "archive" into the corner of the
              // picture, and naming the live provider instead would credit a
              // service that did not make this frame, so an unmatched frame
              // gets the generic word and the credit line below says who.
              record && record.label !== record.sourceId
              ? record.label
              : translate("export.radar"),
        ].filter(Boolean),
        attribution: provenanceCredit(basemapCredit, record),
      };
    },
    [
      basemapCredit,
      frames,
      source,
      timeline.cachedAgeSeconds,
      timeline.fetchedAt,
    ],
  );

  const finish = useCallback(
    async (name: string, blob: Blob) => {
      const saved = await saveFile(name, blob);
      // The record goes out after the picture and never in front of it. A
      // sidecar that fails to write is a fact worth logging; a picture lost
      // because its sidecar failed would be the export destroying the thing it
      // was asked for.
      const drawn = [...drawnRef.current.entries()].map(([index, record]) => ({
        index,
        record,
      }));
      if (drawn.length) {
        try {
          const sidecar = provenanceDocument({
            picture: name,
            application: `OpenRadar ${APP_VERSION}`,
            basemap: basemapCredit,
            writtenAt: Date.now(),
            frames: drawn,
          });
          await saveFile(
            provenanceFileName(name),
            new Blob([JSON.stringify(sidecar, null, 2)], {
              type: "application/json",
            }),
          );
        } catch (failure) {
          log.warn(
            "export",
            failure instanceof Error
              ? failure.message
              : translate("export.failed"),
          );
        }
      }
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
    [basemapCredit, pushToast],
  );

  const exportImage = useCallback(() => {
    void (async () => {
      const canvas = mapRef.current?.canvas();
      if (!canvas) return;
      drawnRef.current.clear();
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

  // The two loop exports are the same walk through the frames with a
  // different encoder on the end, so they are written once.
  const exportLoopAs = useCallback(
    (extension: string, encode: typeof exportLoop, busyAs: string) => {
      void (async () => {
        const canvas = mapRef.current?.canvas();
        if (!canvas || frames.length < 2) return;
        drawnRef.current.clear();
        const originalFrame = frameIndex;
        const wasPlaying = timeline.playing;
        setBusy(busyAs);
        timeline.setPlaying(false);
        try {
          const blob = await encode({
            source: canvas,
            frameCount: frames.length,
            showFrame: async (index) => {
              timeline.selectFrame(index);
              await mapRef.current?.onceIdle();
            },
            captionFor,
            onProgress: (done, total) => setProgress({ done, total }),
            // Only the video path can fall back, and it says so because the
            // slow path costs the loop's own duration in wall clock.
            onFallback: () =>
              pushToast({
                title: translate("export.slowPath"),
                detail: translate("export.slowPathBody"),
              }),
          });
          await finish(exportFileName("openradar-loop", extension), blob);
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
          timeline.selectFrame(originalFrame);
          try {
            await mapRef.current?.onceIdle();
          } finally {
            timeline.setPlaying(wasPlaying);
          }
          setBusy(null);
          setProgress(null);
        }
      })();
    },
    [
      captionFor,
      finish,
      frameIndex,
      frames.length,
      mapRef,
      pushToast,
      timeline,
    ],
  );

  const exportLoopVideo = useCallback(
    () => exportLoopAs("webm", exportLoop, "loop"),
    [exportLoopAs],
  );
  const exportLoopGifFile = useCallback(
    () => exportLoopAs("gif", exportLoopGif, "gif"),
    [exportLoopAs],
  );

  // A data export is a native call rather than a canvas walk, so it shares
  // the busy state and the toasts and nothing else. The file and its sidecar
  // are both named, because a reader who moves one without the other has half
  // an export and no way to know what the numbers are.
  const dataExports = useMemo(
    () =>
      dataSources.map((offer) => ({
        id: offer.id,
        label: offer.label,
        format: offer.format,
        run: () => {
          void (async () => {
            setBusy(`data:${offer.id}`);
            try {
              const report = await offer.run(mapRef.current?.bounds() ?? null);
              pushToast({
                title: translate("export.dataWritten", { label: offer.label }),
                detail: translate("export.dataWrittenBody", {
                  readings: formatNumber(report.readings),
                  size: exportSize(report.bytes),
                  path: report.path,
                }),
              });
            } catch (failure: unknown) {
              log.warn("export", dataExportErrorText(failure));
              pushToast({
                title: translate("export.dataFailed"),
                detail: dataExportErrorText(failure),
              });
            } finally {
              setBusy(null);
            }
          })();
        },
      })),
    [dataSources, mapRef, pushToast],
  );

  return {
    busy,
    progress,
    exportImage,
    exportLoopVideo,
    exportLoopGifFile,
    dataExports,
  };
}
