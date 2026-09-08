import { describe, expect, it } from "vitest";
import { MAX_KMZ_BYTES, MAX_KMZ_ENTRY_BYTES, readKmz } from "./kmz";
import { en } from "../i18n/en";

/**
 * A zip built by hand, so the reader is held against the format rather than
 * against a library's idea of it.
 *
 * Stored, not deflated: the compressed path is exercised separately with a
 * real deflate, and building one by hand here would be writing a compressor
 * to test a decompressor.
 */
function zipOf(entries: Array<{ name: string; body: string }>): ArrayBuffer {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let at = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const body = encoder.encode(entry.body);
    const local = new Uint8Array(30 + name.length + body.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(8, 0, true); // stored
    view.setUint32(18, body.length, true);
    view.setUint32(22, body.length, true);
    view.setUint16(26, name.length, true);
    view.setUint16(28, 0, true);
    local.set(name, 30);
    local.set(body, 30 + name.length);
    locals.push(local);

    const header = new Uint8Array(46 + name.length);
    const headerView = new DataView(header.buffer);
    headerView.setUint32(0, 0x02014b50, true);
    headerView.setUint16(10, 0, true); // stored
    headerView.setUint32(20, body.length, true);
    headerView.setUint32(24, body.length, true);
    headerView.setUint16(28, name.length, true);
    headerView.setUint32(42, at, true);
    header.set(name, 46);
    central.push(header);
    at += local.length;
  }

  const directoryAt = at;
  const directoryBytes = central.reduce((sum, one) => sum + one.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, directoryBytes, true);
  endView.setUint32(16, directoryAt, true);

  const total = at + directoryBytes + end.length;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of [...locals, ...central, end]) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out.buffer;
}

const KML =
  '<?xml version="1.0"?><kml><Document><name>Held</name></Document></kml>';

describe("the KML inside a KMZ", () => {
  it("reads the one every archive is supposed to carry", async () => {
    const archive = zipOf([
      { name: "doc.kml", body: KML },
      { name: "files/icon.png", body: "not really a png" },
    ]);
    expect(await readKmz(archive)).toContain("<name>Held</name>");
  });

  it("takes the first KML when nobody followed the convention", async () => {
    // `doc.kml` is a convention rather than a rule, and plenty of published
    // archives name theirs after the layer.
    const archive = zipOf([
      { name: "files/style.css", body: "body{}" },
      { name: "tornado-tracks.kml", body: KML },
    ]);
    expect(await readKmz(archive)).toContain("<name>Held</name>");
  });

  it("prefers doc.kml over another one beside it", async () => {
    const archive = zipOf([
      {
        name: "other.kml",
        body: "<kml><Document><name>Other</name></Document></kml>",
      },
      { name: "doc.kml", body: KML },
    ]);
    expect(await readKmz(archive)).toContain("<name>Held</name>");
  });

  it("says so when the archive holds no KML at all", async () => {
    const archive = zipOf([{ name: "readme.txt", body: "nothing here" }]);
    await expect(readKmz(archive)).rejects.toThrow(/no KML/);
  });

  it("refuses something that is not a zip", async () => {
    const bytes = new TextEncoder().encode(KML);
    await expect(readKmz(bytes.buffer as ArrayBuffer)).rejects.toThrow(
      /not a zip/,
    );
  });

  it("refuses an archive larger than it will read", async () => {
    // Checked before anything is parsed. A zip is a file whose header says
    // how big its contents are, and believing that header is how a small
    // download becomes a large allocation.
    const huge = new ArrayBuffer(MAX_KMZ_BYTES + 1);
    await expect(readKmz(huge)).rejects.toThrow(/larger than/);
  });

  it("refuses one that is truncated rather than reading past the end", async () => {
    // An archive whose directory says where an entry is and whose bytes stop
    // short. Read without the bounds check this throws a RangeError out of a
    // typed-array constructor, which reaches the reader as a stack trace
    // rather than as a sentence about their file.
    const archive = zipOf([{ name: "doc.kml", body: KML }]);
    const cut = new Uint8Array(archive).slice(0, 25).buffer as ArrayBuffer;
    await expect(readKmz(cut)).rejects.toThrow(/not a zip|truncated/);
  });

  it("refuses a directory entry claiming a name longer than the file", async () => {
    // The three lengths in a central directory entry are the entry's own
    // claim about itself, and the name was read at whatever length it said.
    // Every other length here is checked and this one was not, so the reader
    // got `RangeError: Invalid typed array length: 200` out of a typed-array
    // constructor and the toast showed the engine's sentence rather than the
    // one this module has for a truncated file.
    const bytes = new Uint8Array(60);
    const view = new DataView(bytes.buffer);
    // One directory entry at 0, whose name runs two hundred bytes past the
    // sixty this file holds.
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(28, 200, true);
    // The end-of-central-directory record at 38, saying one entry, there.
    view.setUint32(38, 0x06054b50, true);
    view.setUint16(38 + 10, 1, true);
    view.setUint32(38 + 16, 0, true);

    // The catalogue's own sentence, and not the engine's. Asserted by name
    // as well as by text, because a RangeError carrying the right words would
    // still be the wrong thing to have thrown.
    const refused = await readKmz(bytes.buffer).catch(
      (error: unknown) => error,
    );
    expect(refused).toBeInstanceOf(Error);
    expect((refused as Error).name).toBe("Error");
    expect((refused as Error).message).toBe(en["kmz.truncated"]);
  });

  it("reads a last entry whose comment length is nonsense", async () => {
    // Only the name is read out of a directory entry. The comment is skipped
    // over, and where the skip lands is caught at the top of the next turn
    // round the loop, so a bogus comment length on the last entry costs
    // nothing. The first version of the bound above added all three lengths
    // together and refused this archive, which the reader had been handling
    // correctly for as long as it had existed.
    const good = new Uint8Array(zipOf([{ name: "doc.kml", body: KML }]));
    const view = new DataView(good.buffer);
    // The single directory entry sits straight after the one local header.
    const directoryAt = 30 + 7 + KML.length;
    expect(view.getUint32(directoryAt, true)).toBe(0x02014b50);
    view.setUint16(directoryAt + 32, 0xffff, true);

    expect(await readKmz(good.buffer)).toContain("<name>Held</name>");
  });
});

describe("a deflated entry", () => {
  it("is inflated when the platform can", async () => {
    if (typeof CompressionStream === "undefined") return;
    // Built with the platform's own compressor, so what is read back is a
    // real deflate stream rather than this test's idea of one.
    const raw = new TextEncoder().encode(KML);
    const packed = new Uint8Array(
      await new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(raw);
            controller.close();
          },
        }).pipeThrough(new CompressionStream("deflate-raw")),
      ).arrayBuffer(),
    );

    const encoder = new TextEncoder();
    const name = encoder.encode("doc.kml");
    const local = new Uint8Array(30 + name.length + packed.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(8, 8, true); // deflate
    view.setUint32(18, packed.length, true);
    view.setUint32(22, raw.length, true);
    view.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(packed, 30 + name.length);

    const header = new Uint8Array(46 + name.length);
    const headerView = new DataView(header.buffer);
    headerView.setUint32(0, 0x02014b50, true);
    headerView.setUint16(10, 8, true);
    headerView.setUint32(20, packed.length, true);
    headerView.setUint32(24, raw.length, true);
    headerView.setUint16(28, name.length, true);
    headerView.setUint32(42, 0, true);
    header.set(name, 46);

    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(8, 1, true);
    endView.setUint16(10, 1, true);
    endView.setUint32(12, header.length, true);
    endView.setUint32(16, local.length, true);

    const out = new Uint8Array(local.length + header.length + end.length);
    out.set(local, 0);
    out.set(header, local.length);
    out.set(end, local.length + header.length);

    expect(await readKmz(out.buffer)).toContain("<name>Held</name>");
  });
});

describe("a deflated entry the decompressor cannot read", () => {
  /**
   * One deflated entry, whose compressed bytes are whatever is handed in.
   *
   * The three ways a real KMZ goes wrong are all shaped like this: the entry
   * says method 8, which is what virtually every KMZ uses, and what follows is
   * not a stream the decompressor will finish. Left alone it threw a bare
   * `TypeError` with an empty message, and the caller shows `failure.message`,
   * so the reader got "Overlay could not be added" and nothing else.
   */
  function deflatedZip(packed: Uint8Array, uncompressed: number): ArrayBuffer {
    const encoder = new TextEncoder();
    const name = encoder.encode("doc.kml");
    const local = new Uint8Array(30 + name.length + packed.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(8, 8, true);
    view.setUint32(18, packed.length, true);
    view.setUint32(22, uncompressed, true);
    view.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(packed, 30 + name.length);

    const header = new Uint8Array(46 + name.length);
    const headerView = new DataView(header.buffer);
    headerView.setUint32(0, 0x02014b50, true);
    headerView.setUint16(10, 8, true);
    headerView.setUint32(20, packed.length, true);
    headerView.setUint32(24, uncompressed, true);
    headerView.setUint16(28, name.length, true);
    headerView.setUint32(42, 0, true);
    header.set(name, 46);

    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(8, 1, true);
    endView.setUint16(10, 1, true);
    endView.setUint32(12, header.length, true);
    endView.setUint32(16, local.length, true);

    const out = new Uint8Array(local.length + header.length + end.length);
    out.set(local, 0);
    out.set(header, local.length);
    out.set(end, local.length + header.length);
    return out.buffer;
  }

  /** A real deflate of the sample document, from the platform's compressor. */
  async function deflated(): Promise<Uint8Array> {
    const raw = new TextEncoder().encode(KML);
    return new Uint8Array(
      await new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(raw);
            controller.close();
          },
        }).pipeThrough(new CompressionStream("deflate-raw")),
      ).arrayBuffer(),
    );
  }

  it("says the contents are damaged when the bytes are not deflate", async () => {
    if (typeof CompressionStream === "undefined") return;
    const rubbish = new Uint8Array([0xff, 0xfe, 0xfd, 0xfc, 0xfb, 0xfa]);
    await expect(readKmz(deflatedZip(rubbish, 64))).rejects.toThrow(
      en["kmz.damaged"],
    );
  });

  it("says so when the stream stops two bytes early", async () => {
    if (typeof CompressionStream === "undefined") return;
    const whole = await deflated();
    await expect(
      readKmz(deflatedZip(whole.slice(0, whole.length - 2), KML.length)),
    ).rejects.toThrow(en["kmz.damaged"]);
  });

  it("says so when there are no compressed bytes at all", async () => {
    if (typeof CompressionStream === "undefined") return;
    await expect(
      readKmz(deflatedZip(new Uint8Array(0), KML.length)),
    ).rejects.toThrow(en["kmz.damaged"]);
  });

  it("still says too big rather than damaged when it unpacks too far", async () => {
    if (typeof CompressionStream === "undefined") return;
    // The size check throws from inside the same loop the catch wraps, so a
    // catch written carelessly swallows it and reports every oversized archive
    // as damaged. The header here says the entry unpacks to sixty-four bytes,
    // which gets it past the check on the claim, and the stream then delivers
    // more than the cap: the in-loop check is the only thing left that can
    // stop it. Zeroes deflate to almost nothing, which is what makes the
    // archive itself small enough to reach the reader.
    const huge = new Uint8Array(MAX_KMZ_ENTRY_BYTES + 1024);
    const packed = new Uint8Array(
      await new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(huge);
            controller.close();
          },
        }).pipeThrough(new CompressionStream("deflate-raw")),
      ).arrayBuffer(),
    );
    await expect(readKmz(deflatedZip(packed, 64))).rejects.toThrow(
      en["kmz.tooBigUnpacked"],
    );
  });
});
