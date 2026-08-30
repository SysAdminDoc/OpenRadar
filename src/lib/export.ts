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

function scaleFor(source: HTMLCanvasElement): number {
  return source.width > MAX_WIDTH ? MAX_WIDTH / source.width : 1;
}

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
  if (!context) throw new Error("This display cannot render an export.");

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

function exportCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const scale = scaleFor(source);
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
  if (!blob) throw new Error("The image could not be encoded.");
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
  throw new Error("This build cannot record a video.");
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
  if (frameCount < 1) throw new Error("There are no frames to record.");

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
      throw new Error("This build cannot record a video.");
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
    throw new Error("The recording came out larger than 20 MB.");
  }
  if (blob.size < MIN_LOOP_BYTES) {
    throw new Error("The recording came out empty.");
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
