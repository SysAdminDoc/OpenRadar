import { translate } from "../i18n";
import { encodeGifOffThread } from "./gifWorker";

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
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
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
 * Steps the app through every frame, drawing each into an offscreen canvas that
 * a recorder is reading. Nothing leaves the machine.
 */
export async function exportLoop(options: LoopExportOptions): Promise<Blob> {
  const {
    source,
    frameCount,
    showFrame,
    captionFor,
    frameDurationMs = 400,
    onProgress,
  } = options;
  if (frameCount < 1) throw new Error(translate("export.noFrames"));

  const canvas = exportCanvas(source);
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
