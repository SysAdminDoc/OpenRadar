import { describe, expect, it } from "vitest";
import {
  drawPostcard,
  MAX_CAPTION,
  POSTCARD_SIZES,
  type PostcardSize,
} from "./postcard";

/**
 * What a picture meant to be sent to somebody must never lose.
 *
 * A postcard travels a long way from the person who made it. The observed
 * time, the credits and the line saying this is not an official product go on
 * every variant, and the reader's own caption cannot push any of them off,
 * because the words that must be there are measured and placed before the
 * caption exists.
 */

interface Drawn {
  text: string;
  x: number;
  y: number;
  font: string;
  maxWidth?: number;
}

function fakeCanvas(charWidth = 9) {
  const drawn: Drawn[] = [];
  const images: Array<Record<string, number>> = [];
  let font = "";
  const context = {
    set font(value: string) {
      font = value;
    },
    get font() {
      return font;
    },
    textBaseline: "",
    fillStyle: "",
    fillRect: () => undefined,
    measureText: (text: string) => ({ width: text.length * charWidth }),
    fillText: (text: string, x: number, y: number, maxWidth?: number) =>
      drawn.push({ text, x, y, font, maxWidth }),
    drawImage: (
      _source: unknown,
      sx: number,
      sy: number,
      sw: number,
      sh: number,
      dx: number,
      dy: number,
      dw: number,
      dh: number,
    ) => images.push({ sx, sy, sw, sh, dx, dy, dw, dh }),
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    toBlob: (give: (blob: Blob) => void) =>
      give(new Blob(["png"], { type: "image/png" })),
  };
  return { canvas, drawn, images };
}

async function draw(options: {
  size: PostcardSize;
  written?: string;
  place?: string;
}) {
  const { canvas, drawn, images } = fakeCanvas();
  const made = document.createElement.bind(document);
  document.createElement = ((tag: string) =>
    tag === "canvas" ? canvas : made(tag)) as typeof document.createElement;
  try {
    await drawPostcard({
      frame: { width: 1600, height: 900 } as HTMLCanvasElement,
      size: options.size,
      caption: {
        lines: ["Tue 2 Sep, 4:15 pm", "MRMS reflectivity"],
        attribution: "NOAA MRMS · OpenFreeMap · OpenRadar",
      },
      written: options.written ?? "",
      place: options.place ?? "",
    });
  } finally {
    document.createElement = made;
  }
  return { drawn, images };
}

describe("a postcard of the map", () => {
  it("carries the time, the credits and the app's name at every size", async () => {
    for (const size of POSTCARD_SIZES) {
      const { drawn } = await draw({ size });
      const said = drawn.map((one) => one.text).join(" ");
      expect(said, size.id).toContain("Tue 2 Sep");
      expect(said, size.id).toContain("OpenRadar");
      // And the line that keeps it from arriving looking like a warning.
      expect(said.toLowerCase(), size.id).toContain("not an official");
      // Everything stays on the card.
      for (const line of drawn) {
        expect(line.y, `${size.id}: "${line.text}"`).toBeLessThan(size.height);
        expect(line.x).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("does not let a caption push the credits off", async () => {
    // The failure this is built to prevent: somebody writes a paragraph and
    // the picture arrives with no source on it.
    const long = "Look at this ".repeat(40);
    for (const size of POSTCARD_SIZES) {
      const { drawn } = await draw({ size, written: long });
      const said = drawn.map((one) => one.text).join(" ");
      expect(said, size.id).toContain("OpenRadar");
      expect(said.toLowerCase(), size.id).toContain("not an official");
      expect(said, size.id).toContain("Tue 2 Sep");
      // The caption itself is cut rather than the credits.
      const written = drawn.filter((one) => one.font.includes("30px"));
      expect(
        written.map((one) => one.text).join(" ").length,
        size.id,
      ).toBeLessThanOrEqual(MAX_CAPTION + 8);
    }
  });

  it("says where only when the reader put it there", async () => {
    const without = await draw({ size: POSTCARD_SIZES[0] });
    expect(without.drawn.map((one) => one.text).join(" ")).not.toContain(
      "Casa",
    );
    const with_ = await draw({ size: POSTCARD_SIZES[0], place: "Casa" });
    expect(with_.drawn.map((one) => one.text).join(" ")).toContain("Casa");
  });

  it("crops the map rather than squashing it", async () => {
    // A stretched radar picture is a picture of different weather.
    for (const size of POSTCARD_SIZES) {
      const { images } = await draw({ size });
      expect(images, size.id).toHaveLength(1);
      const one = images[0];
      const source = one.sw / one.sh;
      const target = one.dw / one.dh;
      expect(Math.abs(source - target), size.id).toBeLessThan(0.02);
    }
  });
});
