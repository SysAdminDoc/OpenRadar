import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exportFileName,
  exportLoop,
  exportLoopGif,
  MAX_GIF_FRAMES,
} from "./export";

/**
 * A canvas that answers the way the real one does, since jsdom has no 2D
 * context of its own. What is drawn does not matter; which frames were asked
 * for, and what the caption said, does.
 */
function fakeCanvas(width: number, height: number) {
  const drawn: string[] = [];
  const context = {
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn((line: string) => drawn.push(line)),
    measureText: () => ({ width: 40 }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      // A different colour per call, so a frame that was never redrawn would
      // be indistinguishable from the one before it.
      data: (() => {
        const pixels = new Uint8ClampedArray(w * h * 4);
        const shade = (drawn.length * 17) % 256;
        for (let at = 0; at < pixels.length; at += 4) {
          pixels[at] = shade;
          pixels[at + 1] = (at + shade) % 256;
          pixels[at + 2] = 60;
          pixels[at + 3] = 255;
        }
        return pixels;
      })(),
    }),
    font: "",
    fillStyle: "",
    textBaseline: "" as CanvasTextBaseline,
  };
  const canvas = {
    width,
    height,
    getContext: () => context,
  } as unknown as HTMLCanvasElement;
  return { canvas, drawn };
}

describe("export file names", () => {
  it("stamps the moment so two exports never collide", () => {
    const name = exportFileName("openradar-loop", "webm");
    expect(name).toMatch(
      /^openradar-loop-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}\.webm$/,
    );
    expect(name).not.toContain(":");
    expect(name).not.toContain("/");
  });

  it("names a GIF a GIF", () => {
    expect(exportFileName("openradar-loop", "gif")).toMatch(/\.gif$/);
  });
});

describe("exporting a loop as a GIF", () => {
  const original = document.createElement;

  /** What the exporter drew into its own offscreen canvas. */
  let captioned: string[] = [];

  function withCanvas<T>(run: () => T): T {
    // The offscreen canvas the exporter makes for itself.
    const made = fakeCanvas(4, 4);
    captioned = made.drawn;
    document.createElement = ((tag: string) =>
      tag === "canvas"
        ? made.canvas
        : original.call(document, tag)) as typeof document.createElement;
    try {
      return run();
    } finally {
      document.createElement = original;
    }
  }

  it("writes a GIF with the caption burned into every frame", async () => {
    const source = fakeCanvas(4, 4);
    const shown: number[] = [];
    const blob = await withCanvas(() =>
      exportLoopGif({
        source: source.canvas,
        frameCount: 3,
        showFrame: async (index) => {
          shown.push(index);
        },
        captionFor: (index) => ({
          lines: [`frame ${index}`],
          attribution: "OpenRadar",
        }),
        frameDurationMs: 400,
      }),
    );

    expect(shown).toEqual([0, 1, 2]);
    // The caption and the credit go into the picture, not beside it: a frame
    // that leaves the app has to say what it is and where it came from.
    expect(captioned).toContain("frame 0");
    expect(captioned).toContain("frame 2");
    expect(captioned).toContain("OpenRadar");
    expect(blob.type).toBe("image/gif");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(String.fromCharCode(...bytes.subarray(0, 6))).toBe("GIF89a");
    expect(bytes[bytes.length - 1]).toBe(0x3b);
  });

  it("keeps the newest frames when the loop is longer than a GIF should be", async () => {
    // Every frame is a full picture at a byte a pixel before it is squeezed,
    // so a two-hour loop is a file nobody can send. The end of the loop is the
    // part somebody is sharing.
    const source = fakeCanvas(4, 4);
    const shown: number[] = [];
    await withCanvas(() =>
      exportLoopGif({
        source: source.canvas,
        frameCount: MAX_GIF_FRAMES + 10,
        showFrame: async (index) => {
          shown.push(index);
        },
        captionFor: () => ({ lines: ["x"], attribution: "OpenRadar" }),
      }),
    );

    expect(shown).toHaveLength(MAX_GIF_FRAMES);
    expect(shown[0]).toBe(10);
    expect(shown.at(-1)).toBe(MAX_GIF_FRAMES + 9);
  });

  it("reports progress against what it will actually write", async () => {
    const source = fakeCanvas(4, 4);
    const seen: Array<[number, number]> = [];
    await withCanvas(() =>
      exportLoopGif({
        source: source.canvas,
        frameCount: MAX_GIF_FRAMES + 5,
        showFrame: async () => {},
        captionFor: () => ({ lines: ["x"], attribution: "OpenRadar" }),
        onProgress: (done, total) => seen.push([done, total]),
      }),
    );
    expect(seen).toHaveLength(MAX_GIF_FRAMES);
    expect(seen[0]).toEqual([1, MAX_GIF_FRAMES]);
    expect(seen.at(-1)).toEqual([MAX_GIF_FRAMES, MAX_GIF_FRAMES]);
  });

  it("refuses a loop with no frames rather than writing an empty file", async () => {
    const source = fakeCanvas(4, 4);
    await expect(
      withCanvas(() =>
        exportLoopGif({
          source: source.canvas,
          frameCount: 0,
          showFrame: async () => {},
          captionFor: () => ({ lines: [], attribution: "" }),
        }),
      ),
    ).rejects.toThrow();
  });
});

/**
 * The pieces of WebCodecs the export uses, so both paths can be walked in a
 * runtime that has neither.
 */
function stubEncoder(options: { supported: boolean }) {
  const encoded: Array<{ keyFrame: boolean }> = [];
  class FakeVideoFrame {
    constructor(
      readonly source: unknown,
      readonly init: { timestamp: number },
    ) {}
    close() {}
  }
  class FakeVideoEncoder {
    static isConfigSupported = (config: { codec: string }) =>
      Promise.resolve({ supported: options.supported, config });
    state = "unconfigured";
    constructor(readonly handlers: { output: (chunk: unknown) => void }) {}
    configure() {
      this.state = "configured";
    }
    encode(frame: FakeVideoFrame, init?: { keyFrame?: boolean }) {
      const keyFrame = init?.keyFrame === true;
      encoded.push({ keyFrame });
      this.handlers.output({
        byteLength: 900,
        timestamp: frame.init.timestamp,
        type: keyFrame ? "key" : "delta",
        copyTo: (into: Uint8Array) => into.fill(7),
      });
    }
    flush() {
      return Promise.resolve();
    }
    close() {
      this.state = "closed";
    }
  }
  const globals = globalThis as Record<string, unknown>;
  globals.VideoEncoder = FakeVideoEncoder;
  globals.VideoFrame = FakeVideoFrame;
  return {
    encoded,
    restore: () => {
      delete globals.VideoEncoder;
      delete globals.VideoFrame;
    },
  };
}

/** A recorder and a stream, for the path taken when there is no encoder. */
function stubRecorder() {
  const globals = globalThis as Record<string, unknown>;
  class FakeRecorder {
    static isTypeSupported = () => true;
    mimeType = "video/webm";
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    start() {}
    stop() {
      this.ondataavailable?.({ data: new Blob([new Uint8Array(9000)]) });
      this.onstop?.();
    }
  }
  globals.MediaRecorder = FakeRecorder;
  return () => {
    delete globals.MediaRecorder;
  };
}

describe("exporting a loop as a WebM", () => {
  const original = document.createElement;

  /** The offscreen canvas the export made for itself on the last run. */
  let made = fakeCanvas(320, 180);

  function withCanvas<T>(run: (drawn: string[]) => T): T {
    made = fakeCanvas(320, 180);
    // Only the recorder path asks for this, and it has to be here either way
    // so that asking for it is not what decides which path is taken.
    (made.canvas as unknown as Record<string, unknown>).captureStream = () => ({
      getVideoTracks: () => [{ requestFrame: () => {}, stop: () => {} }],
      getTracks: () => [{ stop: () => {} }],
    });
    document.createElement = ((tag: string) =>
      tag === "canvas"
        ? made.canvas
        : original.call(document, tag)) as typeof document.createElement;
    try {
      return run(made.drawn);
    } finally {
      document.createElement = original;
    }
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("encodes without waiting out the loop it is exporting", async () => {
    const encoder = stubEncoder({ supported: true });
    // Under fake timers the recorder path can never finish, because it sleeps
    // a frame's duration between frames and nothing here advances the clock.
    // Resolving at all is the assertion.
    vi.useFakeTimers();
    const source = fakeCanvas(320, 180);
    const shown: number[] = [];
    const fallback = vi.fn();
    try {
      const blob = await withCanvas(() =>
        exportLoop({
          source: source.canvas,
          frameCount: 4,
          showFrame: async (index) => {
            shown.push(index);
          },
          captionFor: (index) => ({
            lines: [`frame ${index}`],
            attribution: "OpenRadar",
          }),
          frameDurationMs: 400,
          onFallback: fallback,
        }),
      );

      expect(shown).toEqual([0, 1, 2, 3]);
      expect(fallback).not.toHaveBeenCalled();
      expect(blob.type).toBe("video/webm");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      expect([...bytes.slice(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
      // The first frame stands on its own; the rest are differences from it.
      expect(encoder.encoded.map((each) => each.keyFrame)).toEqual([
        true,
        false,
        false,
        false,
      ]);
    } finally {
      encoder.restore();
    }
  });

  it("rounds the picture to even sides, which encoders insist on", async () => {
    const encoder = stubEncoder({ supported: true });
    vi.useFakeTimers();
    // An odd window is an ordinary window. Several encoders refuse an odd
    // dimension outright, which is a strange way for an export to fail on one
    // window size and work on the next.
    const source = fakeCanvas(641, 361);
    try {
      await withCanvas(() =>
        exportLoop({
          source: source.canvas,
          frameCount: 1,
          showFrame: async () => {},
          captionFor: () => ({ lines: ["x"], attribution: "OpenRadar" }),
        }),
      );
    } finally {
      encoder.restore();
    }
    expect(made.canvas.width % 2).toBe(0);
    expect(made.canvas.height % 2).toBe(0);
    expect(made.canvas.width).toBe(642);
    expect(made.canvas.height).toBe(362);
  });

  it("records in real time and says so when there is no encoder", async () => {
    const restoreRecorder = stubRecorder();
    const source = fakeCanvas(320, 180);
    const fallback = vi.fn();
    try {
      const blob = await withCanvas(() =>
        exportLoop({
          source: source.canvas,
          frameCount: 3,
          showFrame: async () => {},
          captionFor: () => ({ lines: ["x"], attribution: "OpenRadar" }),
          frameDurationMs: 1,
          onFallback: fallback,
        }),
      );
      // The reader is told, because this path costs the loop's own duration.
      expect(fallback).toHaveBeenCalledTimes(1);
      expect(blob.size).toBeGreaterThan(2000);
    } finally {
      restoreRecorder();
    }
  });

  it("falls back when the encoder takes the job and then fails", async () => {
    const encoder = stubEncoder({ supported: true });
    const restoreRecorder = stubRecorder();
    const globals = globalThis as Record<string, unknown>;
    const Encoder = globals.VideoEncoder as { prototype: { encode: unknown } };
    Encoder.prototype.encode = () => {
      throw new Error("the hardware encoder gave up");
    };
    const source = fakeCanvas(320, 180);
    const fallback = vi.fn();
    try {
      const blob = await withCanvas(() =>
        exportLoop({
          source: source.canvas,
          frameCount: 3,
          showFrame: async () => {},
          captionFor: () => ({ lines: ["x"], attribution: "OpenRadar" }),
          frameDurationMs: 1,
          onFallback: fallback,
        }),
      );
      expect(fallback).toHaveBeenCalledTimes(1);
      expect(blob.size).toBeGreaterThan(2000);
    } finally {
      encoder.restore();
      restoreRecorder();
    }
  });
});
