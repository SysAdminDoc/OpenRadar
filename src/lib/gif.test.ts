import { describe, expect, it } from "vitest";
import {
  encodeGif,
  indexFrame,
  MAX_COLOURS,
  paletteBits,
  quantise,
} from "./gif";

/** A frame of solid colours, as canvas hands them over. */
function pixels(colours: Array<[number, number, number]>): Uint8ClampedArray {
  const out = new Uint8ClampedArray(colours.length * 4);
  colours.forEach(([red, green, blue], at) => {
    out[at * 4] = red;
    out[at * 4 + 1] = green;
    out[at * 4 + 2] = blue;
    out[at * 4 + 3] = 255;
  });
  return out;
}

/** Reads the LZW back out, which is the only way to know the bytes are a GIF. */
function decodeFirstFrame(bytes: Uint8Array): {
  width: number;
  height: number;
  indices: number[];
  restarts: number;
} {
  expect(String.fromCharCode(...bytes.subarray(0, 6))).toBe("GIF89a");
  const width = bytes[6] | (bytes[7] << 8);
  const height = bytes[8] | (bytes[9] << 8);
  const packed = bytes[10];
  expect(packed & 0x80).toBe(0x80);
  const tableBits = (packed & 0x07) + 1;
  let at = 13 + (1 << tableBits) * 3;

  // Step over the extension blocks until the image descriptor.
  while (bytes[at] === 0x21) {
    at += 2;
    while (bytes[at] !== 0) at += bytes[at] + 1;
    at += 1;
  }
  expect(bytes[at]).toBe(0x2c);
  at += 1 + 8;
  const imagePacked = bytes[at];
  expect(imagePacked & 0x80).toBe(0); // no local table
  expect(imagePacked & 0x40).toBe(0); // not interlaced
  at += 1;

  const minimumCodeSize = bytes[at];
  at += 1;
  const data: number[] = [];
  while (bytes[at] !== 0) {
    const length = bytes[at];
    at += 1;
    for (let each = 0; each < length; each += 1) data.push(bytes[at + each]);
    at += length;
  }

  // The decoder, which is the encoder read backwards.
  const clear = 1 << minimumCodeSize;
  const end = clear + 1;
  let width_ = minimumCodeSize + 1;
  let table: number[][] = [];
  const reset = () => {
    table = [];
    for (let code = 0; code < clear; code += 1) table.push([code]);
    table.push([], []);
    width_ = minimumCodeSize + 1;
  };
  reset();

  const indices: number[] = [];
  let restarts = 0;
  let held = 0;
  let bits = 0;
  let cursor = 0;
  let previous: number[] | null = null;
  for (;;) {
    while (bits < width_ && cursor < data.length) {
      held |= data[cursor] << bits;
      bits += 8;
      cursor += 1;
    }
    if (bits < width_) break;
    const code = held & ((1 << width_) - 1);
    held >>= width_;
    bits -= width_;

    if (code === end) break;
    if (code === clear) {
      restarts += 1;
      reset();
      previous = null;
      continue;
    }
    let entry: number[];
    if (code < table.length && table[code].length) {
      entry = table[code];
    } else if (previous) {
      entry = [...previous, previous[0]];
    } else {
      throw new Error("a code with nothing before it");
    }
    indices.push(...entry);
    if (previous) {
      table.push([...previous, entry[0]]);
      if (table.length === 1 << width_ && width_ < 12) width_ += 1;
    }
    previous = entry;
  }
  // The one at the start of every stream is framing, not a restart.
  return { width, height, indices, restarts: Math.max(0, restarts - 1) };
}

describe("reducing a picture to a palette", () => {
  it("keeps every colour when there is room for all of them", () => {
    // A radar picture is a ramp over a map: a few hundred colours that matter,
    // far apart. Nothing should be merged while there is room.
    const frame = pixels([
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 255],
    ]);
    const palette = quantise([frame]);
    expect(palette.count).toBe(4);
    const indices = indexFrame(frame, palette);
    // Four colours, four entries, and no two pixels sharing one. Which entry
    // each lands on is the cut's business, not the caller's.
    expect(new Set(indices).size).toBe(4);
    // And every index reads back as the colour it went in as.
    for (let at = 0; at < 4; at += 1) {
      const entry = indices[at];
      expect(palette.rgb[entry * 3]).toBe(frame[at * 4]);
      expect(palette.rgb[entry * 3 + 1]).toBe(frame[at * 4 + 1]);
      expect(palette.rgb[entry * 3 + 2]).toBe(frame[at * 4 + 2]);
    }
  });

  it("never asks for more colours than the format holds", () => {
    // Two hundred and fifty-six is the ceiling, and a radar loop over a
    // basemap has thousands.
    const many: Array<[number, number, number]> = [];
    for (let red = 0; red < 64; red += 1) {
      for (let green = 0; green < 16; green += 1) {
        many.push([red * 4, green * 16, 128]);
      }
    }
    const palette = quantise([pixels(many)]);
    expect(palette.count).toBeLessThanOrEqual(MAX_COLOURS);
    expect(palette.count).toBe(MAX_COLOURS);
    // Nothing lands on an index the palette does not have.
    for (const index of indexFrame(pixels(many), palette)) {
      expect(index).toBeLessThan(palette.count);
    }
  });

  it("keeps the error down on colours spread in one channel only", () => {
    // A cut on the wrong channel slices a range four units wide and leaves
    // every box spanning the whole of the one that matters. With enough boxes
    // to make the choice count, the picture that comes back is far further
    // from the one that went in.
    const colours: Array<[number, number, number]> = [];
    for (let at = 0; at < 64; at += 1) {
      colours.push([100 + (at % 4), 120 + (at % 3), at * 4]);
    }
    const frame = pixels(colours);
    const palette = quantise([frame], 8);
    const indices = indexFrame(frame, palette);

    let error = 0;
    colours.forEach(([red, green, blue], at) => {
      const entry = indices[at];
      error +=
        (red - palette.rgb[entry * 3]) ** 2 +
        (green - palette.rgb[entry * 3 + 1]) ** 2 +
        (blue - palette.rgb[entry * 3 + 2]) ** 2;
    });
    // Eight boxes over a range of 252 leaves each about 32 wide, so the worst
    // a reading can be out is around 16 and the mean square error well under a
    // hundred. Cutting on red instead comes out two orders of magnitude worse.
    expect(error / colours.length).toBeLessThan(150);
  });

  it("splits along whichever channel the colours are spread widest in", () => {
    // Two clumps far apart in one channel and touching in the other two. A cut
    // on any other channel would put a colour from one clump in the other's
    // box, so this has to be tried on each of the three: a cut hard-coded to
    // red passes the red case and fails these.
    const clumps: Array<[string, Array<[number, number, number]>]> = [
      [
        "red",
        [
          [0, 100, 100],
          [4, 101, 101],
          [250, 100, 100],
          [254, 101, 101],
        ],
      ],
      [
        "green",
        [
          [100, 0, 100],
          [101, 4, 101],
          [100, 250, 100],
          [101, 254, 101],
        ],
      ],
      [
        "blue",
        [
          [100, 100, 0],
          [101, 101, 4],
          [100, 100, 250],
          [101, 101, 254],
        ],
      ],
    ];
    for (const [channel, colours] of clumps) {
      const frame = pixels(colours);
      const palette = quantise([frame], 2);
      expect(palette.count, channel).toBe(2);
      const [a, b, c, d] = indexFrame(frame, palette);
      expect(a, channel).toBe(b);
      expect(c, channel).toBe(d);
      expect(a, channel).not.toBe(c);
    }
  });

  it("never writes past the table the format has room for", () => {
    // A caller asking for more colours than a GIF can hold has to be brought
    // back to 256, not allowed to run off the end of the table. There have to
    // be more distinct colours than the number asked for, or the cut runs out
    // of things to split and the ceiling is never reached.
    const many: Array<[number, number, number]> = [];
    for (let red = 0; red < 16; red += 1) {
      for (let green = 0; green < 16; green += 1) {
        for (let blue = 0; blue < 8; blue += 1) {
          many.push([red * 16, green * 16, blue * 32]);
        }
      }
    }
    expect(new Set(many.map((c) => c.join(","))).size).toBeGreaterThan(1000);
    const palette = quantise([pixels(many)], 1000);
    expect(palette.count).toBeLessThanOrEqual(MAX_COLOURS);
    expect(palette.rgb.length).toBe(MAX_COLOURS * 3);
    expect(paletteBits(palette.count)).toBeLessThanOrEqual(8);
  });

  it("builds one palette across every frame of a loop", () => {
    // A colour that appears only in the last frame still has to be in the
    // table, or the last frame of a loop comes out wrong.
    const first = pixels([
      [255, 0, 0],
      [255, 0, 0],
    ]);
    const last = pixels([
      [0, 0, 255],
      [0, 0, 255],
    ]);
    const palette = quantise([first, last]);
    expect(palette.count).toBe(2);
    expect(indexFrame(first, palette)[0]).not.toBe(
      indexFrame(last, palette)[0],
    );
  });

  it("counts the bits a palette needs", () => {
    expect(paletteBits(2)).toBe(1);
    expect(paletteBits(3)).toBe(2);
    expect(paletteBits(4)).toBe(2);
    expect(paletteBits(5)).toBe(3);
    expect(paletteBits(256)).toBe(8);
  });
});

describe("writing the file", () => {
  it("comes back out as the picture that went in", async () => {
    // A GIF nobody can decode is not a GIF. The frame is read back through an
    // LZW decoder written against the format rather than against the encoder.
    const colours: Array<[number, number, number]> = [];
    for (let at = 0; at < 64; at += 1) {
      colours.push(at % 3 === 0 ? [255, 0, 0] : [0, 0, 255]);
    }
    const frame = pixels(colours);
    const palette = quantise([frame]);
    const indices = indexFrame(frame, palette);
    const blob = encodeGif([{ indices, delayMs: 400 }], 8, 8, palette);
    expect(blob.type).toBe("image/gif");

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const read = decodeFirstFrame(bytes);
    expect(read.width).toBe(8);
    expect(read.height).toBe(8);
    expect(read.indices).toEqual([...indices]);
    // And it ends where a GIF ends.
    expect(bytes[bytes.length - 1]).toBe(0x3b);
  });

  it("survives a picture with no two pixels alike", async () => {
    // The worst case for LZW: the dictionary never pays off and the codes
    // climb the whole way. Nothing about the framing may come apart.
    const colours: Array<[number, number, number]> = [];
    for (let at = 0; at < 400; at += 1) {
      colours.push([at % 256, (at * 7) % 256, (at * 13) % 256]);
    }
    const frame = pixels(colours);
    const palette = quantise([frame]);
    const indices = indexFrame(frame, palette);
    const blob = encodeGif([{ indices, delayMs: 100 }], 20, 20, palette);
    const read = decodeFirstFrame(new Uint8Array(await blob.arrayBuffer()));
    expect(read.indices).toEqual([...indices]);
  });

  it("keeps up with a picture that fills the dictionary", async () => {
    // Four thousand and ninety-six codes is all LZW has. Past that the encoder
    // starts again rather than freezing, and a decoder that did the other
    // thing would come apart from this point on, so the picture has to be big
    // and varied enough to get there.
    const colours: Array<[number, number, number]> = [];
    for (let at = 0; at < 40_000; at += 1) {
      const step = (at * 2_654_435_761) % 4_294_967_296;
      colours.push([step % 251, (step >> 8) % 241, (step >> 16) % 239]);
    }
    const frame = pixels(colours);
    const palette = quantise([frame]);
    const indices = indexFrame(frame, palette);
    const blob = encodeGif([{ indices, delayMs: 200 }], 200, 200, palette);
    const read = decodeFirstFrame(new Uint8Array(await blob.arrayBuffer()));
    expect(read.indices).toHaveLength(indices.length);
    expect(read.indices).toEqual([...indices]);
    // And it started the dictionary again rather than freezing it. A frozen
    // one still decodes, so nothing above would notice, but it compresses
    // worse and worse as the picture changes under it.
    expect(read.restarts).toBeGreaterThan(0);
  });

  it("says it loops for ever and holds each frame for the time given", async () => {
    const frame = pixels([
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
      [10, 11, 12],
    ]);
    const palette = quantise([frame]);
    const indices = indexFrame(frame, palette);
    const blob = encodeGif(
      [
        { indices, delayMs: 400 },
        { indices, delayMs: 400 },
      ],
      2,
      2,
      palette,
    );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = String.fromCharCode(...bytes);
    expect(text).toContain("NETSCAPE2.0");

    // The delay is written in hundredths of a second, so 400 ms is 40.
    const control = bytes.indexOf(0xf9);
    expect(bytes[control + 3] | (bytes[control + 4] << 8)).toBe(40);
  });

  it("refuses a loop with nothing in it rather than writing headers", () => {
    const palette = quantise([pixels([[0, 0, 0]])]);
    expect(() => encodeGif([], 2, 2, palette)).toThrow();
  });
});
