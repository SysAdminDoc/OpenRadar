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
import { drawPostcard, type PostcardSize } from "../lib/postcard";
import { setWallpaper } from "../lib/wallpaper";
import type { OverlayBounds } from "../lib/overlays";
import type { RadarProvider } from "../lib/providers";
import {
  provenanceCredit,
  provenanceDocument,
  sweepProvenance,
  timelineProvenance,
  type Provenance,
} from "../lib/provenance";
import { stepNow, stepsForVolumes } from "../lib/siteLoop";
import type { SweepImage } from "../lib/level2";
import {
  frameAgeMinutes,
  formatFrameTime,
  formatRadarTime,
  type RadarFrame,
} from "../lib/radar";
import { saveFile } from "../lib/saveFile";
import { APP_VERSION } from "../lib/settings";
import type { RadarTimelineState } from "./useRadarTimeline";
import { translate } from "../i18n";

/**
 * How long a frame waits for its volume to arrive before the walk moves on.
 *
 * A ten megabyte archive object over a slow connection, plus the decode.
 * Longer than a fetch and shorter than a reader's patience with a button.
 */
const SETTLE_TIMEOUT_MS = 20_000;

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
  /**
   * The same frame as a card to send somebody.
   *
   * Beside the plain export rather than instead of it: evidence and a
   * postcard are different jobs, and the plain one is unchanged.
   */
  /**
   * The same still, onto the desktop rather than into a file.
   *
   * Here rather than in the workspace because this is where a caption is
   * written from a frame's own provenance: the picture on the desktop carries
   * the frame time, the source credits and its own age exactly as a saved one
   * does, and the two cannot drift apart.
   */
  writeWallpaper: () => Promise<boolean>;
  exportPostcard: (options: {
    size: PostcardSize;
    written: string;
    place: string;
  }) => void;
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
  /**
   * The held site's loop, when one is on the map: the sweep drawn and the
   * volume times behind it.
   *
   * Null whenever the mosaic is the picture, which is what every export did
   * before this existed.
   */
  /**
   * The single-site sweep on the map, whatever put it there.
   *
   * Separate from `siteLoop` on purpose. A volume the reader opened by hand
   * has no loop, and neither does a terminal radar, but a still of either is
   * still a picture of one radar: captioned from the timeline frame it was
   * stamped with today's mosaic time and credited to the mosaic, which is the
   * defect the loop walk was changed to stop making, on the file somebody is
   * most likely to send to another person.
   */
  sweep: SweepImage | null;
  siteLoop: {
    sweep: SweepImage;
    volumes: number[];
    /**
     * Which volume the picture on screen answers, read when it is asked
     * rather than captured.
     *
     * The walk moves the timeline and the map goes idle within a few hundred
     * milliseconds, because the mosaic under the site redraws; the site's own
     * volume is a ten megabyte object still being fetched and decoded. With
     * nothing to wait on, every frame of a saved loop held the previous
     * volume's pixels under the next volume's caption and record.
     */
    drawnVolume: () => number | null;
  } | null;
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
    sweep,
    siteLoop,
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

  /**
   * The caption for one volume of a held site.
   *
   * Written from the volume's own record for the same reason the mosaic's is
   * written from the frame's: the words burned into the corner and the record
   * saved beside the file have to be the same statement. The station and
   * product come from the sweep because every volume in this walk is the same
   * site and the same product; only the time moves.
   */
  const sweepCaptionFor = useCallback(
    (sweep: SweepImage, at: number, index: number): ExportCaption => {
      const record = sweepProvenance({
        sweep,
        at,
        // The walk draws each volume as it captions it, either fetching it or
        // re-reading one the loop already holds, so this is when the machine
        // had those bytes to within the length of the walk.
        fetchedAt: Date.now(),
      });
      drawnRef.current.set(index, record);
      return {
        lines: [
          formatRadarTime(at / 1000),
          translate("chrome.sweepProduct", {
            station: sweep.station,
            product: sweep.product,
          }),
        ],
        attribution: provenanceCredit(basemapCredit, record),
      };
    },
    [basemapCredit],
  );

  const captionFor = useCallback(
    (index: number): ExportCaption => {
      // Whatever sweep is on the canvas, from wherever it came. The picture
      // is that radar's and not the mosaic's.
      if (sweep) {
        return sweepCaptionFor(sweep, Date.parse(sweep.collected), index);
      }
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
      sweep,
      sweepCaptionFor,
      timeline.cachedAgeSeconds,
      timeline.fetchedAt,
    ],
  );

  /**
   * Waits for the map to be showing the volume the caption is about.
   *
   * Bounded, and it gives up rather than refusing to export: a volume that
   * never arrives leaves the frame before it on screen, which is one wrong
   * frame instead of no file at all. It says so in the log either way.
   */
  const settleOn = useCallback(
    async (drawnVolume: () => number | null, at: number) => {
      const until = Date.now() + SETTLE_TIMEOUT_MS;
      while (drawnVolume() !== at && Date.now() < until) {
        await new Promise((resolve) => window.setTimeout(resolve, 60));
      }
      if (drawnVolume() !== at)
        log.warn("export", translate("export.volumeLate"));
      // The picture arrived; the map still has to draw it.
      await mapRef.current?.onceIdle();
    },
    [mapRef],
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
        pushToast({
          title: translate("export.imageFailed"),
          detail: translate("export.imageFailedBody"),
        });
      } finally {
        setBusy(null);
      }
    })();
  }, [captionFor, finish, frameIndex, mapRef, pushToast]);

  /**
   * The caption a wallpaper gets: the saved one, plus how old it is.
   *
   * A saved picture is looked at the moment it is made, so the observation
   * time answers "how old is this" on its own. One on a desktop is looked at
   * hours later, on a gap of up to three hours, and an absolute time in the
   * corner gives a reader nothing to judge it by. So the age goes on the
   * picture, worked out when it is drawn.
   */
  const wallpaperCaption = useCallback(
    (index: number): ExportCaption => {
      const caption = captionFor(index);
      const frame = frames[index];
      if (!frame) return caption;
      return {
        ...caption,
        lines: [
          ...caption.lines,
          translate("wallpaper.age", { minutes: frameAgeMinutes(frame) }),
        ],
      };
    },
    [captionFor, frames],
  );

  const writeWallpaper = useCallback(async () => {
    const canvas = mapRef.current?.canvas();
    // Nothing to draw is not a failure. A wallpaper of an empty map is worse
    // than the one that is already there. Answering false rather than
    // throwing is what lets the schedule tell "there was nothing yet" from
    // "it went wrong", so a cold start does not spend its first slot on a
    // map that had not come up.
    if (!canvas || !frames.length) return false;
    const blob = await exportStill(canvas, wallpaperCaption(frameIndex));
    await setWallpaper(new Uint8Array(await blob.arrayBuffer()));
    return true;
  }, [frameIndex, frames.length, mapRef, wallpaperCaption]);

  const exportPostcard = useCallback(
    (options: { size: PostcardSize; written: string; place: string }) => {
      void (async () => {
        const canvas = mapRef.current?.canvas();
        if (!canvas) return;
        drawnRef.current.clear();
        setBusy("image");
        try {
          const blob = await drawPostcard({
            frame: canvas,
            size: options.size,
            // The same caption the plain export burns in, written from the
            // frame's own provenance, so the two pictures cannot disagree
            // about what they are of.
            caption: captionFor(frameIndex),
            written: options.written,
            place: options.place,
          });
          await finish(
            exportFileName(`openradar-postcard-${options.size.id}`, "png"),
            blob,
          );
        } catch (failure) {
          log.warn(
            "export",
            failure instanceof Error
              ? failure.message
              : translate("export.failed"),
          );
          pushToast({
            title: translate("export.imageFailed"),
            detail: translate("export.imageFailedBody"),
          });
        } finally {
          setBusy(null);
        }
      })();
    },
    [captionFor, finish, frameIndex, mapRef, pushToast],
  );

  // The two loop exports are the same walk through the frames with a
  // different encoder on the end, so they are written once.
  const exportLoopAs = useCallback(
    (extension: string, encode: typeof exportLoop, busyAs: string) => {
      void (async () => {
        const canvas = mapRef.current?.canvas();
        // A held site's own volumes when there are any, the mosaic's steps
        // otherwise. Two of whichever it is, because a loop of one frame is
        // a still.
        // A site's own volumes when there are enough of them to be a loop,
        // and the mosaic's steps otherwise. A view where every step maps to
        // one volume used to make the button do nothing at all: no file, no
        // toast, no log line.
        const found =
          siteLoop && siteLoop.volumes.length > 1
            ? stepsForVolumes(frames, siteLoop.volumes)
            : null;
        const walk = found && found.length > 1 ? found : null;
        const count = walk ? walk.length : frames.length;
        if (!canvas || count < 2) return;
        drawnRef.current.clear();
        const originalFrame = frameIndex;
        const wasPlaying = timeline.playing;
        setBusy(busyAs);
        timeline.setPlaying(false);
        try {
          const blob = await encode({
            source: canvas,
            frameCount: count,
            showFrame: async (index) => {
              timeline.selectFrame(
                walk ? stepNow(timeline.frames, walk[index]) : index,
              );
              await mapRef.current?.onceIdle();
              if (walk && siteLoop) {
                await settleOn(siteLoop.drawnVolume, walk[index].at);
              }
            },
            captionFor:
              walk && siteLoop
                ? (index) =>
                    sweepCaptionFor(siteLoop.sweep, walk[index].at, index)
                : captionFor,
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
      frames,
      mapRef,
      pushToast,
      settleOn,
      siteLoop,
      sweepCaptionFor,
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
                  // Raw, because the sentence counts by it.
                  readings: report.readings,
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
    exportPostcard,
    writeWallpaper,
    exportLoopVideo,
    exportLoopGifFile,
    dataExports,
  };
}
