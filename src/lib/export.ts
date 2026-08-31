import { translate } from "../i18n";
import { encodeGifOffThread } from "./gifWorker";
import { writeWebm, type WebmFrame } from "./webm";

export interface ExportCaption {
  /** Frame time, source name, and anything else that names the picture. */
  lines: string[];
  attribution: string;
}

/** Nothing wider than this is worth the file size for a shared loop. */
const MAX_WIDTH = 1280;
const CAPTION_PADDING = 12;
const LOOP_BITS_PER_SECOND = 2_500_000;
/** The acceptance for a shared loop is a file small enough to send. */
export const MAX_LOOP_BYTES = 20 * 1024 * 1024;
/** A WebM with no frames in it is a few hundred bytes of headers. */
export const MIN_LOOP_BYTES = 2_000;

/**
 * Draws the map as it stands with the caption burned into the corner, so a
 * picture that leaves the app still says what it is and where it came from.
 */
export function drawFrame(
  target: HTMLCanvasElement,
  source: HTMLCanvasElement,
  caption: ExportCaption,
): void {
  const context = target.getContext("2d");
  if (!context) throw new Error(translate("export.noCanvas"));

  context.drawImage(source, 0, 0, target.width, target.height);

  const lines = [...caption.lines, caption.attribution].filter(Boolean);
  const lineHeight = 18;
  const boxHeight = lines.length * lineHeight + CAPTION_PADDING;
  context.font = "13px 'Segoe UI', system-ui, sans-serif";
  const width =
    Math.max(...lines.map((line) => context.measureText(line).width)) +
    CAPTION_PADDING * 2;

  context.fillStyle = "rgba(9, 11, 16, 0.78)";
  context.fillRect(
    CAPTION_PADDING,
    target.height - boxHeight - CAPTION_PADDING,
    width,
    boxHeight,
  );

  context.fillStyle = "#e7edf7";
  context.textBaseline = "top";
  lines.forEach((line, index) => {
    context.fillStyle = index === lines.length - 1 ? "#9da9bb" : "#e7edf7";
    context.fillText(
      line,
      CAPTION_PADDING * 2,
      target.height - boxHeight + index * lineHeight,
    );
  });
}

function exportCanvas(
  source: HTMLCanvasElement,
  maxWidth = MAX_WIDTH,
): HTMLCanvasElement {
  const scale = source.width > maxWidth ? maxWidth / source.width : 1;
  const canvas = document.createElement("canvas");
  // Even on both sides. Video encoders work in macroblocks and several of them
  // refuse an odd dimension outright, which is a strange way for an export to
  // fail on one window size and not another.
  canvas.width = Math.round((source.width * scale) / 2) * 2;
  canvas.height = Math.round((source.height * scale) / 2) * 2;
  return canvas;
}

export async function exportStill(
  source: HTMLCanvasElement,
  caption: ExportCaption,
): Promise<Blob> {
  const canvas = exportCanvas(source);
  drawFrame(canvas, source, caption);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error(translate("export.notEncoded"));
  return blob;
}

export interface LoopExportOptions {
  source: HTMLCanvasElement;
  frameCount: number;
  /** Moves the app to a frame and resolves once the map has drawn it. */
  showFrame: (index: number) => Promise<void>;
  captionFor: (index: number) => ExportCaption;
  /** Milliseconds each frame is held in the recording. */
  frameDurationMs?: number;
  onProgress?: (done: number, total: number) => void;
  /**
   * Called when the fast encoder could not be used and the loop is being
   * recorded in real time instead, so the reader is told why it is slow.
   */
  onFallback?: () => void;
}

function pickMimeType(): string {
  for (const candidate of [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ]) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  throw new Error(translate("export.noVideo"));
}

/**
 * The codecs to try, best first, with the name Matroska knows each by.
 *
 * VP9 for the size, VP8 because every build that has an encoder at all has
 * that one. AV1 is not here: it is slower to encode than the recording it
 * replaces on machines without hardware for it, which is the opposite of the
 * point.
 */
const CODECS: Array<{ codec: string; codecId: string }> = [
  { codec: "vp09.00.10.08", codecId: "V_VP9" },
  { codec: "vp8", codecId: "V_VP8" },
];

/** The first codec this machine will actually encode, or null for none. */
async function pickEncoder(
  width: number,
  height: number,
  framerate: number,
): Promise<{ codec: string; codecId: string } | null> {
  if (typeof VideoEncoder === "undefined") return null;
  for (const candidate of CODECS) {
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec: candidate.codec,
        width,
        height,
        bitrate: LOOP_BITS_PER_SECOND,
        framerate,
      });
      if (support.supported) return candidate;
    } catch {
      // A codec string this build does not recognise throws rather than
      // answering, which is the same answer.
    }
  }
  return null;
}

/**
 * The loop encoded as fast as the map can draw it.
 *
 * The recorder below reads a stream in real time, so a twenty-second loop took
 * twenty seconds and owned the workspace throughout. This hands each frame
 * straight to the encoder the moment it is drawn and puts the compressed
 * frames in a container afterwards, which costs whatever the map and the
 * encoder need and nothing for waiting.
 */
async function exportLoopEncoded(
  options: LoopExportOptions,
  chosen: { codec: string; codecId: string },
  canvas: HTMLCanvasElement,
): Promise<Blob> {
  const {
    source,
    frameCount,
    showFrame,
    captionFor,
    frameDurationMs = 400,
    onProgress,
  } = options;

  const written: WebmFrame[] = [];
  // The encoder reports a failure through its own callback rather than by
  // throwing where it was called, so it is held here and raised at the next
  // point the walk can stop.
  const state: { failure: Error | null } = { failure: null };

  const encoder = new VideoEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      written.push({
        timeMs: Math.round(chunk.timestamp / 1000),
        keyFrame: chunk.type === "key",
        data,
      });
    },
    error: (failure) => {
      state.failure = failure;
    },
  });

  try {
    encoder.configure({
      codec: chosen.codec,
      width: canvas.width,
      height: canvas.height,
      bitrate: LOOP_BITS_PER_SECOND,
      framerate: 1000 / frameDurationMs,
    });

    for (let index = 0; index < frameCount; index += 1) {
      if (state.failure) throw state.failure;
      await showFrame(index);
      drawFrame(canvas, source, captionFor(index));
      const frame = new VideoFrame(canvas, {
        timestamp: index * frameDurationMs * 1000,
        duration: frameDurationMs * 1000,
      });
      try {
        // The first frame has to stand on its own or the file opens on a
        // difference from a picture nobody has.
        encoder.encode(frame, { keyFrame: index === 0 });
      } finally {
        frame.close();
      }
      onProgress?.(index + 1, frameCount);
    }
    await encoder.flush();
  } finally {
    if (encoder.state !== "closed") encoder.close();
  }
  if (state.failure) throw state.failure;

  const blob = new Blob(
    [
      writeWebm(written, {
        width: canvas.width,
        height: canvas.height,
        codecId: chosen.codecId,
        lastFrameMs: frameDurationMs,
      }),
    ],
    { type: "video/webm" },
  );
  if (blob.size > MAX_LOOP_BYTES) {
    throw new Error(translate("export.tooLarge"));
  }
  return blob;
}

/**
 * The loop as a WebM, encoded if this build can and recorded if it cannot.
 *
 * The recorder is kept rather than replaced. It is the path that works when
 * WebCodecs is missing, when the build has no VP8 or VP9 encoder, and when the
 * encoder takes the configuration and then fails partway through, which is a
 * thing hardware encoders do. Falling back costs the loop's own duration in
 * wall clock, so the reader is told it happened rather than left wondering why
 * this export is the slow one.
 *
 * Nothing leaves the machine on either path.
 */
export async function exportLoop(options: LoopExportOptions): Promise<Blob> {
  const {
    source,
    frameCount,
    showFrame,
    captionFor,
    frameDurationMs = 400,
    onProgress,
    onFallback,
  } = options;
  if (frameCount < 1) throw new Error(translate("export.noFrames"));

  const canvas = exportCanvas(source);

  const chosen = await pickEncoder(
    canvas.width,
    canvas.height,
    1000 / frameDurationMs,
  );
  if (chosen) {
    try {
      return await exportLoopEncoded(options, chosen, canvas);
    } catch (failure) {
      // A file larger than the cap is the same answer from either path, so
      // there is nothing to gain by spending the loop's duration to hear it
      // twice.
      if (
        failure instanceof Error &&
        failure.message === translate("export.tooLarge")
      ) {
        throw failure;
      }
      onFallback?.();
    }
  } else {
    onFallback?.();
  }

  const stream = canvas.captureStream(0);
  let blob: Blob;

  try {
    const [track] = stream.getVideoTracks() as Array<
      MediaStreamTrack & { requestFrame?: () => void }
    >;
    // Without this the stream never emits a frame and the file comes out as
    // headers with nothing in them.
    if (typeof track?.requestFrame !== "function") {
      throw new Error(translate("export.noVideo"));
    }

    const recorder = new MediaRecorder(stream, {
      mimeType: pickMimeType(),
      videoBitsPerSecond: LOOP_BITS_PER_SECOND,
    });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    const finished = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });

    recorder.start();
    try {
      for (let index = 0; index < frameCount; index += 1) {
        await showFrame(index);
        drawFrame(canvas, source, captionFor(index));
        track.requestFrame();
        onProgress?.(index + 1, frameCount);
        await new Promise((resolve) =>
          window.setTimeout(resolve, frameDurationMs),
        );
      }
    } finally {
      recorder.stop();
      await finished;
    }
    blob = new Blob(chunks, { type: recorder.mimeType });
  } finally {
    for (const each of stream.getTracks()) each.stop();
  }

  if (blob.size > MAX_LOOP_BYTES) {
    throw new Error(translate("export.tooLarge"));
  }
  if (blob.size < MIN_LOOP_BYTES) {
    throw new Error(translate("export.empty"));
  }
  return blob;
}

/**
 * How many frames a GIF is allowed. Every one of them is a full picture at a
 * byte a pixel before it is squeezed, so a long loop is a file nobody can
 * send. The newest are the ones worth keeping.
 */
export const MAX_GIF_FRAMES = 24;
/** Chat GIFs stay readable here without keeping 24 desktop-size RGBA frames. */
export const MAX_GIF_WIDTH = 960;

/**
 * The same loop as a GIF, because a WebM will not paste into most chats.
 *
 * Every frame is drawn the same way as the video, caption and credit burned
 * in, and then the whole set is reduced to one palette. One palette rather
 * than one a frame because a radar loop is the same ramp over the same map,
 * and a table a frame would be a kilobyte each for nothing.
 */
export async function exportLoopGif(options: LoopExportOptions): Promise<Blob> {
  const {
    source,
    frameCount,
    showFrame,
    captionFor,
    frameDurationMs = 400,
    onProgress,
  } = options;
  if (frameCount < 1) throw new Error(translate("export.noFrames"));

  const canvas = exportCanvas(source, MAX_GIF_WIDTH);
  const context = canvas.getContext("2d");
  if (!context) throw new Error(translate("export.noCanvas"));

  // The last frames of the loop, which are the ones somebody is sharing.
  const first = Math.max(0, frameCount - MAX_GIF_FRAMES);
  const wanted = frameCount - first;
  const pictures: Uint8ClampedArray[] = [];
  for (let index = first; index < frameCount; index += 1) {
    await showFrame(index);
    drawFrame(canvas, source, captionFor(index));
    pictures.push(context.getImageData(0, 0, canvas.width, canvas.height).data);
    onProgress?.(index - first + 1, wanted);
  }

  const blob = await encodeGifOffThread(
    pictures,
    canvas.width,
    canvas.height,
    frameDurationMs,
  );

  // No floor here, unlike the video. A WebM that recorded nothing still comes
  // out as a few hundred bytes of headers and has to be caught by its size; a
  // GIF with no frames in it is refused when it is written, and a small file is
  // just a small picture.
  if (blob.size > MAX_LOOP_BYTES) {
    throw new Error(translate("export.tooLarge"));
  }
  return blob;
}

export function exportFileName(prefix: string, extension: string): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace(/Z$/, "");
  return `${prefix}-${stamp}.${extension}`;
}

/**
 * The name of the record that travels beside a picture.
 *
 * Beside rather than inside. A PNG has a text chunk and a GIF has a comment
 * block, but a WebM would need the muxer rewritten to carry one, and three
 * mechanisms for one fact is three things to keep true. A JSON file with the
 * picture's own name in front of it stays with the picture through a copy, a
 * zip and an upload, and opens in anything.
 */
export function provenanceFileName(pictureName: string): string {
  const dot = pictureName.lastIndexOf(".");
  const stem = dot > 0 ? pictureName.slice(0, dot) : pictureName;
  return `${stem}-provenance.json`;
}
