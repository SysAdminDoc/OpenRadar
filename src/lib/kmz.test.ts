import { describe, expect, it } from "vitest";
import { MAX_KMZ_BYTES, readKmz } from "./kmz";

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
