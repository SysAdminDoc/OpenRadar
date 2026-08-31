import { describe, expect, it, vi } from "vitest";
import { exportFileName, exportLoopGif, MAX_GIF_FRAMES } from "./export";

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
