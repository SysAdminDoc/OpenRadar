/**
 * A GIF89a writer, because a WebM will not paste into most chats.
 *
 * The format is old and small: a palette of at most 256 colours, one index a
 * pixel, and the whole thing squeezed with LZW. Everything here is that, and
 * nothing else. There is no dependency because the encoder is a couple of
 * hundred lines and a dependency for it would be a supply chain for a file
 * format that has not changed since 1989.
 */

/** The most colours a GIF can hold. */
export const MAX_COLOURS = 256;

/** One frame, already reduced to indices into a shared palette. */
export interface IndexedFrame {
  indices: Uint8Array;
  /** How long this frame is held, in milliseconds. */
  delayMs: number;
}

/** A palette as flat RGB triples, and how many of them there are. */
export interface Palette {
  rgb: Uint8Array;
  count: number;
}

interface Box {
  colours: number[];
  /** Which channel this box is widest in, and how wide. */
  channel: number;
  spread: number;
}

/** The colours in a box, averaged, which is the colour it becomes. */
function averageOf(colours: number[]): [number, number, number] {
  let red = 0;
  let green = 0;
  let blue = 0;
  for (const colour of colours) {
    red += (colour >> 16) & 0xff;
    green += (colour >> 8) & 0xff;
    blue += colour & 0xff;
  }
  const many = colours.length;
  return [
    Math.round(red / many),
    Math.round(green / many),
    Math.round(blue / many),
  ];
}

function measure(colours: number[]): Box {
  const low = [255, 255, 255];
  const high = [0, 0, 0];
  for (const colour of colours) {
    const parts = [(colour >> 16) & 0xff, (colour >> 8) & 0xff, colour & 0xff];
    for (let channel = 0; channel < 3; channel += 1) {
      if (parts[channel] < low[channel]) low[channel] = parts[channel];
      if (parts[channel] > high[channel]) high[channel] = parts[channel];
    }
  }
  let channel = 0;
  let spread = -1;
  for (let each = 0; each < 3; each += 1) {
    const width = high[each] - low[each];
    if (width > spread) {
      spread = width;
      channel = each;
    }
  }
  return { colours, channel, spread };
}

/**
 * A palette for a set of pictures, by median cut.
 *
 * Split the colours repeatedly along whichever channel the box spans widest,
 * and average what is left in each box. It is the standard answer and it holds
 * up on a radar picture, which is a ramp over a map rather than a photograph:
 * the colours that matter are few and far apart, and the ones that are close
 * together are map furniture nobody is reading a value off.
 */
export function quantise(
  pixels: readonly Uint8ClampedArray[],
  wanted = MAX_COLOURS,
): Palette {
  const seen = new Set<number>();
  for (const frame of pixels) {
    for (let at = 0; at + 3 < frame.length; at += 4) {
      seen.add((frame[at] << 16) | (frame[at + 1] << 8) | frame[at + 2]);
    }
  }
  const colours = [...seen];
  const room = Math.max(1, Math.min(MAX_COLOURS, wanted));

  let boxes: Box[] = [measure(colours)];
  while (boxes.length < room) {
    // The widest box that still has something to split.
    let pick = -1;
    let spread = 0;
    for (let at = 0; at < boxes.length; at += 1) {
      if (boxes[at].colours.length > 1 && boxes[at].spread > spread) {
        spread = boxes[at].spread;
        pick = at;
      }
    }
    if (pick < 0) break;
    const box = boxes[pick];
    const shift = 16 - box.channel * 8;
    const sorted = [...box.colours].sort(
      (left, right) => ((left >> shift) & 0xff) - ((right >> shift) & 0xff),
    );
    const middle = Math.floor(sorted.length / 2);
    boxes = [
      ...boxes.slice(0, pick),
      measure(sorted.slice(0, middle)),
      measure(sorted.slice(middle)),
      ...boxes.slice(pick + 1),
    ];
  }

  const rgb = new Uint8Array(MAX_COLOURS * 3);
  boxes.forEach((box, at) => {
    const [red, green, blue] = averageOf(box.colours);
    rgb[at * 3] = red;
    rgb[at * 3 + 1] = green;
    rgb[at * 3 + 2] = blue;
  });
  return { rgb, count: boxes.length };
}

/** Every pixel of a frame, as the nearest colour the palette holds. */
export function indexFrame(
  pixels: Uint8ClampedArray,
  palette: Palette,
): Uint8Array {
  const out = new Uint8Array(pixels.length / 4);
  // A radar frame is a million pixels over a few hundred distinct colours, so
  // the same colour is looked up over and over.
  const known = new Map<number, number>();
  for (let at = 0, pixel = 0; at + 3 < pixels.length; at += 4, pixel += 1) {
    const red = pixels[at];
    const green = pixels[at + 1];
    const blue = pixels[at + 2];
    const key = (red << 16) | (green << 8) | blue;
    const held = known.get(key);
    if (held !== undefined) {
      out[pixel] = held;
      continue;
    }
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let entry = 0; entry < palette.count; entry += 1) {
      const dr = red - palette.rgb[entry * 3];
      const dg = green - palette.rgb[entry * 3 + 1];
      const db = blue - palette.rgb[entry * 3 + 2];
      const distance = dr * dr + dg * dg + db * db;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = entry;
        if (distance === 0) break;
      }
    }
    known.set(key, best);
    out[pixel] = best;
  }
  return out;
}

/** Bytes, grown as they are written. */
class Writer {
  private bytes: number[] = [];

  byte(value: number): void {
    this.bytes.push(value & 0xff);
  }

  short(value: number): void {
    this.bytes.push(value & 0xff, (value >> 8) & 0xff);
  }

  raw(values: ArrayLike<number>): void {
    for (let at = 0; at < values.length; at += 1) this.bytes.push(values[at]);
  }

  text(value: string): void {
    for (const letter of value) this.bytes.push(letter.charCodeAt(0));
  }

  done(): Uint8Array {
    return new Uint8Array(this.bytes);
  }
}

/**
 * One frame's pixels, LZW-compressed the way GIF wants them.
 *
 * Codes start one bit wider than the palette needs, to leave room for the two
 * the format reserves, and grow as the dictionary fills. The dictionary is
 * cleared when it is full rather than frozen, which keeps a long frame from
 * compressing worse and worse as the picture changes under it.
 */
function lzw(indices: Uint8Array, minimumCodeSize: number): Uint8Array {
  const clear = 1 << minimumCodeSize;
  const end = clear + 1;
  const LIMIT = 4096;

  const out: number[] = [];
  let held = 0;
  let bits = 0;
  let width = minimumCodeSize + 1;
  const emit = (code: number) => {
    held |= code << bits;
    bits += width;
    while (bits >= 8) {
      out.push(held & 0xff);
      held >>= 8;
      bits -= 8;
    }
  };

  // A run and the byte after it, as one number, so the dictionary is a map of
  // integers rather than of strings. Every single byte is already a code, so
  // the dictionary only ever holds runs of two or more.
  let table = new Map<number, number>();
  let next = end + 1;
  const reset = () => {
    table = new Map();
    next = end + 1;
    width = minimumCodeSize + 1;
  };

  emit(clear);
  if (!indices.length) {
    emit(end);
    if (bits > 0) out.push(held & 0xff);
    return new Uint8Array(out);
  }

  let run = indices[0];
  for (let at = 1; at < indices.length; at += 1) {
    const letter = indices[at];
    const key = run * LIMIT + letter;
    const longer = table.get(key);
    if (longer !== undefined) {
      run = longer;
      continue;
    }
    emit(run);
    if (next < LIMIT) {
      table.set(key, next);
      next += 1;
      if (next > 1 << width && width < 12) width += 1;
    } else {
      // Full. Start again rather than freezing it, so a frame whose picture
      // changes under it does not compress worse and worse to the end.
      emit(clear);
      reset();
    }
    run = letter;
  }
  emit(run);
  emit(end);
  if (bits > 0) out.push(held & 0xff);
  return new Uint8Array(out);
}

/** How many bits a palette of this many colours needs. */
export function paletteBits(count: number): number {
  let bits = 1;
  while (1 << bits < count) bits += 1;
  return Math.min(8, Math.max(1, bits));
}

/**
 * A whole animated GIF.
 *
 * One palette for every frame, because a radar loop is the same ramp over the
 * same map and a palette a frame would be four kilobytes each for no gain.
 */
export function encodeGif(
  frames: readonly IndexedFrame[],
  width: number,
  height: number,
  palette: Palette,
): Blob {
  if (!frames.length) throw new Error("a loop with no frames in it");
  const bits = paletteBits(palette.count);
  const out = new Writer();

  out.text("GIF89a");
  out.short(width);
  out.short(height);
  // A global colour table, this many bits deep, unsorted.
  out.byte(0x80 | ((bits - 1) << 4) | (bits - 1));
  out.byte(0); // background colour
  out.byte(0); // no aspect ratio to declare
  out.raw(palette.rgb.subarray(0, (1 << bits) * 3));

  // The Netscape block, which is how a GIF says it loops for ever.
  out.byte(0x21);
  out.byte(0xff);
  out.byte(11);
  out.text("NETSCAPE2.0");
  out.byte(3);
  out.byte(1);
  out.short(0);
  out.byte(0);

  for (const frame of frames) {
    out.byte(0x21);
    out.byte(0xf9);
    out.byte(4);
    out.byte(0); // no transparency, keep what is there
    // Held in hundredths of a second, which is the resolution the format has.
    out.short(Math.max(2, Math.round(frame.delayMs / 10)));
    out.byte(0);
    out.byte(0);

    out.byte(0x2c);
    out.short(0);
    out.short(0);
    out.short(width);
    out.short(height);
    out.byte(0); // no local table, not interlaced

    const minimumCodeSize = Math.max(2, bits);
    out.byte(minimumCodeSize);
    const squeezed = lzw(frame.indices, minimumCodeSize);
    for (let at = 0; at < squeezed.length; at += 255) {
      const block = squeezed.subarray(at, Math.min(at + 255, squeezed.length));
      out.byte(block.length);
      out.raw(block);
    }
    out.byte(0);
  }

  out.byte(0x3b);
  return new Blob([out.done()], { type: "image/gif" });
}
