import { describe, expect, it } from "vitest";
import { framesInOrder, sampleDurations, writeMp4, type Mp4Frame } from "./mp4";

/**
 * A box reader, so the file is checked by being parsed rather than by being
 * compared against bytes this test wrote out by hand.
 */
interface Box {
  name: string;
  at: number;
  size: number;
  body: Uint8Array;
}

function boxesIn(bytes: Uint8Array, from = 0, to = bytes.length): Box[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const found: Box[] = [];
  let at = from;
  while (at + 8 <= to) {
    const size = view.getUint32(at);
    if (size < 8 || at + size > to) break;
    found.push({
      name: String.fromCharCode(...bytes.slice(at + 4, at + 8)),
      at,
      size,
      body: bytes.slice(at + 8, at + size),
    });
    at += size;
  }
  return found;
}

/** A box by path, e.g. `moov/trak/mdia/minf/stbl/stsz`. */
function find(bytes: Uint8Array, path: string): Box {
  const parts = path.split("/");
  let level = boxesIn(bytes);
  let box: Box | undefined;
  for (const [depth, name] of parts.entries()) {
    box = level.find((one) => one.name === name);
    if (!box) throw new Error(`no ${path} (stopped at ${name})`);
    if (depth + 1 < parts.length) level = boxesIn(box.body);
  }
  return box as Box;
}

function u32At(bytes: Uint8Array, at: number): number {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(at);
}

/** An avcC that is plainly this test's, so it can be found in the output. */
const DESCRIPTION = new Uint8Array([1, 0x42, 0xe0, 0x28, 0xff, 0xe0, 0, 4]);

function frames(count: number, everyMs = 400): Mp4Frame[] {
  return Array.from({ length: count }, (_, at) => ({
    timeMs: at * everyMs,
    keyFrame: at === 0,
    data: new Uint8Array([at + 1, at + 1, at + 1]),
  }));
}

const OPTIONS = {
  width: 1280,
  height: 720,
  description: DESCRIPTION,
  lastFrameMs: 400,
};

describe("the file an MP4 export writes", () => {
  const file = writeMp4(frames(5), OPTIONS);

  it("opens with a brand a player will recognise", () => {
    const ftyp = find(file, "ftyp");
    expect(ftyp.at).toBe(0);
    expect(String.fromCharCode(...ftyp.body.slice(0, 4))).toBe("isom");
    // The compatible brands say what it actually is, and avc1 is the one that
    // tells a player it does not need to guess.
    const brands = String.fromCharCode(...ftyp.body.slice(8));
    expect(brands).toContain("avc1");
  });

  it("lays the media out before the movie that describes it", () => {
    const top = boxesIn(file).map((one) => one.name);
    expect(top).toEqual(["ftyp", "mdat", "moov"]);
  });

  it("says where the samples are, and is right", () => {
    const stco = find(file, "moov/trak/mdia/minf/stbl/stco");
    expect(u32At(stco.body, 4)).toBe(1);
    const offset = u32At(stco.body, 8);
    // The first sample is the first frame's own bytes, which this test made
    // recognisable. An offset that is out by the media box's header is the
    // classic way this file comes out unplayable.
    expect(file[offset]).toBe(1);
    expect(offset).toBe(find(file, "mdat").at + 8);
  });

  it("lists every sample's size, in order", () => {
    const stsz = find(file, "moov/trak/mdia/minf/stbl/stsz");
    // A zero shared size means the sizes are listed one by one below.
    expect(u32At(stsz.body, 4)).toBe(0);
    expect(u32At(stsz.body, 8)).toBe(5);
    for (let at = 0; at < 5; at += 1) {
      expect(u32At(stsz.body, 12 + at * 4)).toBe(3);
    }
  });

  it("carries the encoder's own configuration untouched", () => {
    const avcC = find(file, "moov/trak/mdia/minf/stbl/stsd");
    // The sample entry sits after the version, flags and entry count.
    const entry = boxesIn(avcC.body, 8)[0];
    expect(entry.name).toBe("avc1");
    const inner = boxesIn(entry.body, 78)[0];
    expect(inner.name).toBe("avcC");
    expect([...inner.body]).toEqual([...DESCRIPTION]);
  });

  it("states the picture's size where a player looks for it", () => {
    const entry = boxesIn(
      find(file, "moov/trak/mdia/minf/stbl/stsd").body,
      8,
    )[0];
    const view = new DataView(
      entry.body.buffer,
      entry.body.byteOffset,
      entry.body.byteLength,
    );
    expect(view.getUint16(24)).toBe(1280);
    expect(view.getUint16(26)).toBe(720);
    // And on the track, in the sixteen-sixteen fixed point it wants there.
    const tkhd = find(file, "moov/trak/tkhd");
    expect(u32At(tkhd.body, 76) / 0x10000).toBe(1280);
    expect(u32At(tkhd.body, 80) / 0x10000).toBe(720);
  });

  it("holds every frame for as long as the loop does", () => {
    const stts = find(file, "moov/trak/mdia/minf/stbl/stts");
    // One run, because a loop is one duration repeated.
    expect(u32At(stts.body, 4)).toBe(1);
    expect(u32At(stts.body, 8)).toBe(5);
    expect(u32At(stts.body, 12)).toBe(400);
    // Which is the duration the movie and the track both claim.
    expect(u32At(find(file, "moov/mvhd").body, 16)).toBe(2000);
    expect(u32At(find(file, "moov/trak/tkhd").body, 20)).toBe(2000);
  });

  it("names the frames a player may start at", () => {
    const stss = find(file, "moov/trak/mdia/minf/stbl/stss");
    expect(u32At(stss.body, 4)).toBe(1);
    // One-based, so the first frame is 1 and not 0. Nothing opens on a
    // difference from a picture nobody has.
    expect(u32At(stss.body, 8)).toBe(1);
  });
});

describe("what the writer refuses", () => {
  it("will not write a file with no configuration to decode it by", () => {
    expect(() =>
      writeMp4(frames(2), { ...OPTIONS, description: new Uint8Array() }),
    ).toThrow(/codec configuration/);
  });

  it("will not write a stream whose frames are out of order", () => {
    // Nothing here writes composition offsets, so a stream with bidirectional
    // frames cannot be described. Written anyway it would play backwards in
    // places, which is worse than refusing.
    const reordered = frames(3);
    reordered[2].timeMs = 100;
    expect(framesInOrder(reordered)).toBe(false);
    expect(framesInOrder(frames(3))).toBe(true);
    expect(() => writeMp4(reordered, OPTIONS)).toThrow(/reorder/);
  });

  it("will not write an empty file", () => {
    expect(() => writeMp4([], OPTIONS)).toThrow(/at least one frame/);
  });
});

describe("how long each frame is held", () => {
  it("measures every frame but the last against the next one", () => {
    const uneven: Mp4Frame[] = [0, 200, 700].map((timeMs) => ({
      timeMs,
      keyFrame: timeMs === 0,
      data: new Uint8Array([1]),
    }));
    // The last has nothing after it to be measured against, so the caller
    // states it.
    expect(sampleDurations(uneven, 300)).toEqual([200, 500, 300]);
  });
});
