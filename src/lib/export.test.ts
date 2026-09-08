import { afterEach, describe, expect, it, vi } from "vitest";
import {
  drawFrame,
  exportFileName,
  exportLoop,
  exportLoopGif,
  exportStill,
  MAX_GIF_FRAMES,
} from "./export";

/**
 * A canvas that answers the way the real one does, since jsdom has no 2D
 * context of its own. What is drawn does not matter; which frames were asked
 * for, and what the caption said, does.
 */
function fakeCanvas(width: number, height: number) {
  const drawn: string[] = [];
  // The colour each line was drawn in, recorded here rather than only on
  // `fillRect`. The caption's last several lines are the credit and are drawn
  // quieter than the facts above them, and nothing could see that: the fake
  // kept the text and the box colours and threw the text colour away, so the
  // rule that decides it could be removed with the whole suite green.
  const inked: Array<{ line: string; color: string }> = [];
  const context = {
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn((line: string) => {
      drawn.push(line);
      inked.push({ line, color: context.fillStyle });
    }),
    // Proportional to the text, because a fake that answers 40 for every
    // string cannot see a line running off the edge, which is the one thing
    // the caption's own arithmetic is for. Seven pixels a character is about
    // what 13px Segoe UI measures, and it scales with the type size: without
    // that, shrinking the font to make a caption fit changes nothing the fake
    // can see and the height cap cannot be tested at all.
    measureText: (text: string) => ({
      width: (text.length * 7 * (parseFloat(context.font) || 13)) / 13,
    }),
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
  return { canvas, drawn, inked };
}

describe("the keys burned into an exported picture", () => {
  /** The canvas above, with the colours each fill was made in recorded. */
  function recording(width: number, height: number) {
    const { canvas, drawn, inked } = fakeCanvas(width, height);
    const context = canvas.getContext("2d") as unknown as {
      fillRect: ReturnType<typeof vi.fn>;
      fillStyle: string;
    };
    const swatches: Array<{
      color: string;
      x: number;
      y: number;
      w: number;
      h: number;
    }> = [];
    context.fillRect = vi.fn((x: number, y: number, w: number, h: number) => {
      swatches.push({ color: context.fillStyle, x, y, w, h });
    });
    return { canvas, drawn, inked, swatches };
  }

  const caption = {
    lines: ["2026-09-05 21:00Z"],
    attribution: "NOAA",
  };

  it("draws nothing extra when the reader did not ask for the keys", () => {
    const { canvas, drawn } = recording(1280, 720);
    drawFrame(canvas, canvas, caption);
    expect(drawn).toEqual(["2026-09-05 21:00Z", "NOAA"]);
  });

  it("keeps a long credit inside the picture at every export size", () => {
    // The credit used to name the basemap and one radar and now names every
    // layer drawn over the radar, which is several offices and a model on a
    // busy day. `drawFrame` measured the widest line and drew a box that
    // wide, so anything longer than the picture ran off the right edge along
    // with its own backing box.
    const long =
      "OpenRadar · OpenStreetMap · NOAA MRMS · NOAA NWS, ECCC and DWD · " +
      "NOAA SPC · NOAA WPC · NOAA NESDIS GOES · NASA FIRMS · USGS";
    for (const [width, height] of [
      [1920, 1080],
      [1280, 720],
      [800, 600],
      [480, 320],
    ]) {
      const { canvas, drawn } = recording(width, height);
      drawFrame(canvas, canvas, {
        lines: ["2026-09-08 21:00Z"],
        attribution: long,
      });
      const context = canvas.getContext("2d") as unknown as {
        measureText: (text: string) => { width: number };
      };
      const widest = Math.max(
        ...drawn.map((line) => context.measureText(line).width),
      );
      // Where the text starts, plus the widest line, plus the padding on the
      // far side of its box. That is the right-hand edge of what is drawn.
      // The text starts two paddings in and its box closes one padding past
      // the longest line, so three of them plus the widest line is the
      // right-hand edge of everything drawn. The padding is 12 in `export.ts`.
      expect(widest + 12 * 3, `${width}x${height}`).toBeLessThanOrEqual(width);
      // And nothing was dropped to make it fit: every word survives, in order.
      expect(drawn.join(" ").replace(/\s+/g, " ")).toContain("NOAA MRMS");
      expect(drawn.join(" ").replace(/\s+/g, " ")).toContain("USGS");
    }
  });

  it("keeps the caption inside the picture from top to bottom too", () => {
    // The width was bounded and the height was not. `boxHeight` is the line
    // count times the line height, so a credit naming every adapter drawn was
    // 14 per cent of a 1280 by 720 still, 38 per cent at 640 by 360, and at
    // 320 by 180 stood 137 per cent of the picture tall with its top edge 78
    // pixels above the frame. The test beside this one measured the width
    // only, and its smallest size was 480 by 320.
    const every =
      "OpenRadar · OpenStreetMap contributors · NOAA MRMS · NOAA NWS · " +
      "Environment and Climate Change Canada · Deutscher Wetterdienst · " +
      "NOAA SPC · NOAA WPC · NOAA NESDIS GOES · NASA FIRMS · USGS · " +
      "NOAA NHC · NOAA Tides and Currents · Iowa State Mesonet";
    for (const [width, height] of [
      [1280, 720],
      [640, 360],
      [480, 320],
      [320, 180],
    ]) {
      const { canvas, swatches } = recording(width, height);
      drawFrame(canvas, canvas, {
        lines: ["2026-09-08 21:00Z", "KDMX 0.5° reflectivity"],
        attribution: every,
      });
      // The caption's own backing box is the dark one.
      const box = swatches.find((one) => one.color.startsWith("rgba(9, 11"));
      expect(box, `${width}x${height}`).toBeTruthy();
      expect(box!.y, `${width}x${height} top`).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.h, `${width}x${height} bottom`).toBeLessThanOrEqual(
        height,
      );
      // And it does not swallow the picture to fit: the point of a still is
      // the radar, not the credit under it.
      expect(box!.h, `${width}x${height} share`).toBeLessThanOrEqual(
        height * 0.45,
      );
    }
  });

  it("still tells the facts from the credit when the caption is cut short", () => {
    // The credit is the tail of the line list and truncation keeps the head,
    // so the count of surviving credit lines is what is left of that tail,
    // not `Math.min(credit, fits)`. With the wrong end the count equalled the
    // line count, `index >= lines.length - credit` was true for every line,
    // and the timestamp and the product were painted in the credit's grey.
    const every = Array.from(
      { length: 40 },
      (_, at) => `Source number ${at} of the ones drawn`,
    ).join(" · ");
    const { canvas, inked } = recording(320, 180);
    drawFrame(canvas, canvas, {
      lines: ["2026-09-08 21:00Z", "KDMX 0.5° reflectivity"],
      attribution: every,
    });

    expect(inked.length).toBeGreaterThan(1);
    expect(inked.at(-1)!.line).toContain("…");
    // The facts are the app's own colour; whatever credit survives is quieter.
    expect(inked[0].line).toBe("2026-09-08 21:00Z");
    expect(inked[0].color).toBe("#e7edf7");
    expect(inked.some((one) => one.color === "#9da9bb")).toBe(true);
  });

  it("shrinks the type before it drops a word of the credit", () => {
    // Which of the three answers the item offered. A credit is the one part
    // of a caption nobody should be reading a shortened version of, so the
    // words go last: at 320 by 180 every source still survives, in order, and
    // the type is smaller than the 13px it starts at.
    const every =
      "OpenRadar · OpenStreetMap contributors · NOAA MRMS · NOAA NWS · " +
      "Environment and Climate Change Canada · Deutscher Wetterdienst · " +
      "NOAA SPC · NOAA WPC · NOAA NESDIS GOES · NASA FIRMS · USGS";
    const { canvas, drawn } = recording(320, 180);
    drawFrame(canvas, canvas, {
      lines: ["2026-09-08 21:00Z"],
      attribution: every,
    });
    const said = drawn.join(" ").replace(/\s+/g, " ");
    for (const source of ["NOAA MRMS", "Deutscher Wetterdienst", "USGS"]) {
      expect(said, source).toContain(source);
    }
    expect(said).not.toContain("…");
    const context = canvas.getContext("2d") as unknown as { font: string };
    expect(parseFloat(context.font)).toBeLessThan(13);
  });

  it("draws the whole credit in the quieter colour, however many lines it takes", () => {
    // The old rule was "the last line is the credit". Once the credit wraps,
    // that colours all but the final line of it as though it were a fact
    // about the picture. Asserted on the colour each line was actually drawn
    // in: the first version of this test looked at the line count and passed
    // with the rule taken out.
    const { canvas, inked } = recording(480, 320);
    drawFrame(canvas, canvas, {
      lines: ["2026-09-08 21:00Z"],
      attribution:
        "OpenRadar · OpenStreetMap · NOAA MRMS · NOAA NWS, ECCC and DWD · NOAA SPC",
    });
    const FACT = "#e7edf7";
    const CREDIT = "#9da9bb";
    expect(inked.length).toBeGreaterThan(2);
    expect(inked[0]).toEqual({ line: "2026-09-08 21:00Z", color: FACT });
    // Every line after the fact is part of the credit, and all of it quiet.
    const rest = inked.slice(1);
    expect(rest.length).toBeGreaterThan(1);
    expect(rest.every((one) => one.color === CREDIT)).toBe(true);
    expect(rest.map((one) => one.line).join(" ")).toContain("NOAA SPC");
  });

  it("names every band and paints it in the colour it is drawn in", () => {
    const { canvas, drawn, swatches } = recording(1280, 720);
    drawFrame(canvas, canvas, {
      ...caption,
      keys: [
        {
          id: "spcOutlooks",
          title: "Day 1 convective outlook",
          bands: [
            { label: "Marginal Risk", color: "#66a366" },
            { label: "Slight Risk", color: "#ffe066" },
          ],
          note: null,
        },
      ],
    });
    expect(drawn).toContain("Day 1 convective outlook");
    expect(drawn).toContain("Marginal Risk");
    expect(drawn).toContain("Slight Risk");
    // The swatch beside a name is that band's own colour. A key drawn in one
    // colour would name the categories and describe none of them.
    const colors = swatches.map((swatch) => swatch.color);
    expect(colors).toContain("#66a366");
    expect(colors).toContain("#ffe066");
  });

  it("puts the keys opposite the caption rather than on top of it", () => {
    // The caption is in the bottom left and the picture is the point: two
    // blocks in the same corner means one of them is over the weather.
    const { canvas, swatches } = recording(1280, 720);
    drawFrame(canvas, canvas, {
      ...caption,
      keys: [
        {
          id: "spcOutlooks",
          title: "Day 1 convective outlook",
          bands: [{ label: "Slight Risk", color: "#ffe066" }],
          note: null,
        },
      ],
    });
    const band = swatches.find((swatch) => swatch.color === "#ffe066");
    expect(band).toBeTruthy();
    expect(band!.x).toBeGreaterThan(1280 / 2);
  });

  it("keeps one block per layer when several are on", () => {
    const { canvas, drawn } = recording(1280, 720);
    drawFrame(canvas, canvas, {
      ...caption,
      keys: [
        {
          id: "spcOutlooks",
          title: "Day 1 convective outlook",
          bands: [{ label: "Slight Risk", color: "#ffe066" }],
          note: null,
        },
        {
          id: "wpcExcessiveRain",
          title: "Excessive rainfall outlook",
          bands: [{ label: "Moderate", color: "#e06666" }],
          note: null,
        },
      ],
    });
    expect(drawn).toContain("Day 1 convective outlook");
    expect(drawn).toContain("Excessive rainfall outlook");
  });
});

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
  const CAPTION = { lines: ["x"], attribution: "OpenRadar" };

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
    expect(made.canvas.width).toBe(642);
    expect(made.canvas.height).toBe(362);
  });

  it("leaves a still and a GIF at the size they actually are", async () => {
    // The rule belongs to the encoder. A picture rounded up to an even side is
    // stretched by a fraction of a per cent for nothing, because the caption
    // is drawn by scaling the map to fill the canvas.
    const source = fakeCanvas(641, 361);
    await withCanvas(() => exportStill(source.canvas, CAPTION)).catch(() => {
      // jsdom has no PNG encoder. The canvas was already sized by the time it
      // was asked for one, which is the whole of what this checks.
    });
    expect(made.canvas.width).toBe(641);
    expect(made.canvas.height).toBe(361);

    await withCanvas(() =>
      exportLoopGif({
        source: source.canvas,
        frameCount: 2,
        showFrame: async () => {},
        captionFor: () => CAPTION,
      }),
    );
    expect(made.canvas.width).toBe(641);
    expect(made.canvas.height).toBe(361);
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
