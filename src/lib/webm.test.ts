import { describe, expect, it } from "vitest";
import { writeWebm, type WebmFrame } from "./webm";

/**
 * A reader for the parts of Matroska this muxer writes, so the tests check the
 * bytes rather than checking that the writer agrees with itself.
 */
class Reader {
  at = 0;
  constructor(readonly data: Uint8Array) {}

  /** An element id, which announces its own width in its first byte. */
  id(): string {
    const first = this.data[this.at];
    let width = 1;
    for (let bit = 7; bit >= 4; bit -= 1) {
      if (first & (1 << bit)) break;
      width += 1;
    }
    const out = [...this.data.slice(this.at, this.at + width)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    this.at += width;
    return out;
  }

  /** A length, whose width is announced the same way and then masked off. */
  size(): number {
    const first = this.data[this.at];
    let width = 1;
    for (let bit = 7; bit >= 0; bit -= 1) {
      if (first & (1 << bit)) break;
      width += 1;
    }
    let value = first & ((1 << (8 - width)) - 1);
    for (let step = 1; step < width; step += 1) {
      value = value * 256 + this.data[this.at + step];
    }
    this.at += width;
    return value;
  }

  take(length: number): Uint8Array {
    const out = this.data.slice(this.at, this.at + length);
    this.at += length;
    return out;
  }
}

/** Every element at one level, as id and body. */
function children(data: Uint8Array): Array<{ id: string; body: Uint8Array }> {
  const reader = new Reader(data);
  const out: Array<{ id: string; body: Uint8Array }> = [];
  while (reader.at < data.length) {
    const id = reader.id();
    const size = reader.size();
    out.push({ id, body: reader.take(size) });
  }
  return out;
}

function only(data: Uint8Array, id: string): Uint8Array {
  const found = children(data).find((child) => child.id === id);
  if (!found) throw new Error(`no ${id}`);
  return found.body;
}

function asUint(body: Uint8Array): number {
  return body.reduce((sum, byte) => sum * 256 + byte, 0);
}

function frame(timeMs: number, keyFrame: boolean, fill: number): WebmFrame {
  return { timeMs, keyFrame, data: new Uint8Array([fill, fill, fill]) };
}

const OPTIONS = {
  width: 640,
  height: 360,
  codecId: "V_VP9",
  lastFrameMs: 400,
};

describe("a WebM file this writes", () => {
  const file = writeWebm(
    [frame(0, true, 1), frame(400, false, 2), frame(800, false, 3)],
    OPTIONS,
  );

  it("starts with the bytes every player looks for", () => {
    expect([...file.slice(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
    const header = only(file, "1a45dfa3");
    expect(new TextDecoder().decode(only(header, "4282"))).toBe("webm");
  });

  it("says how big the picture is and what decodes it", () => {
    const segment = only(file, "18538067");
    const track = only(only(segment, "1654ae6b"), "ae");
    expect(new TextDecoder().decode(only(track, "86"))).toBe("V_VP9");
    expect(asUint(only(track, "d7"))).toBe(1);
    // Track type 1 is video.
    expect(asUint(only(track, "83"))).toBe(1);
    const video = only(track, "e0");
    expect(asUint(only(video, "b0"))).toBe(640);
    expect(asUint(only(video, "ba"))).toBe(360);
  });

  it("runs as long as the last frame is held, not to its start", () => {
    const info = only(only(file, "18538067"), "1549a966");
    // One tick is one millisecond, so the duration reads in milliseconds.
    expect(asUint(only(info, "2ad7b1"))).toBe(1_000_000);
    const duration = new DataView(
      only(info, "4489").buffer,
      only(info, "4489").byteOffset,
    ).getFloat64(0, false);
    expect(duration).toBe(1200);
  });

  it("holds every frame at the time it was given, in order", () => {
    const clusters = children(only(file, "18538067")).filter(
      (child) => child.id === "1f43b675",
    );
    expect(clusters).toHaveLength(1);
    const parts = children(clusters[0].body);
    expect(asUint(parts[0].body)).toBe(0);

    const blocks = parts.filter((part) => part.id === "a3");
    expect(blocks).toHaveLength(3);
    const times = blocks.map((block) =>
      new DataView(block.body.buffer, block.body.byteOffset + 1).getInt16(
        0,
        false,
      ),
    );
    expect(times).toEqual([0, 400, 800]);
    // Track one, then the timecode and flags, then the frame itself.
    expect(blocks[0].body[0]).toBe(0x81);
    expect(blocks[0].body[3]).toBe(0x80);
    expect(blocks[1].body[3]).toBe(0x00);
    expect([...blocks[2].body.slice(4)]).toEqual([3, 3, 3]);
  });

  it("points a cue at the byte the cluster starts on", () => {
    const segment = only(file, "18538067");
    const cue = only(only(only(segment, "1c53bb6b"), "bb"), "b7");
    const position = asUint(only(cue, "f1"));
    // Counted from the first byte inside the segment, which is where a player
    // seeks from. The element it lands on has to be a cluster.
    const reader = new Reader(segment.slice(position));
    expect(reader.id()).toBe("1f43b675");
  });
});

describe("what the writer refuses and where it splits", () => {
  it("refuses a file with no frames, or one that opens on a difference", () => {
    expect(() => writeWebm([], OPTIONS)).toThrow(/at least one frame/);
    expect(() => writeWebm([frame(0, false, 1)], OPTIONS)).toThrow(/key frame/);
  });

  it("opens a new cluster before a block timecode could overflow", () => {
    // A block's offset from its cluster is a signed 16-bit number, so a long
    // loop that stayed in one cluster would wrap and play out of order.
    const long: WebmFrame[] = [];
    for (let index = 0; index < 120; index += 1) {
      long.push(frame(index * 400, index % 20 === 0, 1));
    }
    const file = writeWebm(long, OPTIONS);
    const clusters = children(only(file, "18538067")).filter(
      (child) => child.id === "1f43b675",
    );
    expect(clusters.length).toBeGreaterThan(1);

    for (const cluster of clusters) {
      for (const block of children(cluster.body).filter(
        (part) => part.id === "a3",
      )) {
        const offset = new DataView(
          block.body.buffer,
          block.body.byteOffset + 1,
        ).getInt16(0, false);
        expect(offset).toBeGreaterThanOrEqual(0);
        expect(offset).toBeLessThan(32_768);
      }
    }
    // Every cluster starts on a key frame, because that is what a seek lands
    // on and a cue points at.
    for (const cluster of clusters) {
      const first = children(cluster.body).find((part) => part.id === "a3");
      expect(first?.body[3]).toBe(0x80);
    }
  });

  it("splits anyway when the encoder never sends a second key frame", () => {
    const long: WebmFrame[] = [];
    for (let index = 0; index < 200; index += 1) {
      long.push(frame(index * 400, index === 0, 1));
    }
    const clusters = children(
      only(writeWebm(long, OPTIONS), "18538067"),
    ).filter((child) => child.id === "1f43b675");
    expect(clusters.length).toBeGreaterThan(2);
    for (const cluster of clusters) {
      for (const block of children(cluster.body).filter(
        (part) => part.id === "a3",
      )) {
        const offset = new DataView(
          block.body.buffer,
          block.body.byteOffset + 1,
        ).getInt16(0, false);
        expect(offset).toBeGreaterThanOrEqual(0);
      }
    }
    // Only the one cluster that opens on a key frame is offered as a seek.
    const cues = children(
      only(only(writeWebm(long, OPTIONS), "18538067"), "1c53bb6b"),
    );
    expect(cues).toHaveLength(1);
  });

  it("writes a length wide enough for a frame bigger than 127 bytes", () => {
    const big = {
      timeMs: 0,
      keyFrame: true,
      data: new Uint8Array(5000).fill(7),
    };
    const file = writeWebm([big], OPTIONS);
    const cluster = children(only(file, "18538067")).find(
      (child) => child.id === "1f43b675",
    );
    const block = children(cluster!.body).find((part) => part.id === "a3");
    expect(block?.body.length).toBe(5000 + 4);
  });
});
