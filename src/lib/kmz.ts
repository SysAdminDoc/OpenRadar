import { translate } from "../i18n";
/**
 * KMZ: one KML in a zip, which is how almost every published KML arrives.
 *
 * A whole zip library for one entry is a dependency this does not need. The
 * format's own central directory says where each entry is and how it was
 * stored, and the two storage methods a KMZ ever uses are "not compressed"
 * and "deflate", which the platform decompresses itself.
 *
 * Everything here is bounded before it is read. A zip is a file whose header
 * says how big its contents are, and believing that header is how a small
 * download becomes a large allocation.
 */

/** The largest entry this will inflate, so a bomb cannot be unpacked. */
export const MAX_KMZ_ENTRY_BYTES = 64 * 1024 * 1024;
/** The largest archive it will look at at all. */
export const MAX_KMZ_BYTES = 16 * 1024 * 1024;

interface ZipEntry {
  name: string;
  compression: number;
  compressedBytes: number;
  uncompressedBytes: number;
  headerAt: number;
}

/** The end-of-central-directory record, found from the back of the file. */
function endOfDirectory(bytes: DataView): { at: number; count: number } | null {
  // Scanned backwards over the comment the record may carry, which is the
  // only way to find it: the record is last, but not at a fixed offset.
  const start = Math.max(0, bytes.byteLength - 22 - 0xffff);
  for (let at = bytes.byteLength - 22; at >= start; at -= 1) {
    if (bytes.getUint32(at, true) !== 0x06054b50) continue;
    return {
      at: bytes.getUint32(at + 16, true),
      count: bytes.getUint16(at + 10, true),
    };
  }
  return null;
}

function readDirectory(bytes: DataView): ZipEntry[] {
  const end = endOfDirectory(bytes);
  if (!end) throw new Error(translate("kmz.notZip"));
  const entries: ZipEntry[] = [];
  let at = end.at;
  for (let read = 0; read < end.count; read += 1) {
    if (at + 46 > bytes.byteLength) break;
    if (bytes.getUint32(at, true) !== 0x02014b50) break;
    const nameLength = bytes.getUint16(at + 28, true);
    const extraLength = bytes.getUint16(at + 30, true);
    const commentLength = bytes.getUint16(at + 32, true);
    const name = new TextDecoder().decode(
      new Uint8Array(bytes.buffer, bytes.byteOffset + at + 46, nameLength),
    );
    entries.push({
      name,
      compression: bytes.getUint16(at + 10, true),
      compressedBytes: bytes.getUint32(at + 20, true),
      uncompressedBytes: bytes.getUint32(at + 24, true),
      headerAt: bytes.getUint32(at + 42, true),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflate(raw: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error(translate("kmz.noDecompressor"));
  }
  // A stream built from the bytes rather than from a Blob. A Blob does not
  // carry a stream everywhere this runs, and going through one buys nothing:
  // the bytes are already in memory.
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(raw);
      controller.close();
    },
  });
  const stream = source.pipeThrough(new DecompressionStream("deflate-raw"));
  const parts: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    // Checked as it arrives rather than from the header: a header is a claim
    // and this is the thing that actually landed.
    if (total > MAX_KMZ_ENTRY_BYTES) {
      await reader.cancel();
      throw new Error(translate("kmz.tooBigUnpacked"));
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

/**
 * The KML inside a KMZ.
 *
 * `doc.kml` by convention, and the first `.kml` entry otherwise, which is what
 * every reader does: the convention is a convention rather than a rule and
 * plenty of published archives name theirs after the layer.
 */
export async function readKmz(archive: ArrayBuffer): Promise<string> {
  if (archive.byteLength > MAX_KMZ_BYTES) {
    throw new Error(translate("kmz.tooBig"));
  }
  const bytes = new DataView(archive);
  const entries = readDirectory(bytes);
  const kml =
    entries.find((entry) => entry.name.toLowerCase() === "doc.kml") ??
    entries.find((entry) => entry.name.toLowerCase().endsWith(".kml"));
  if (!kml) throw new Error(translate("kmz.noKml"));
  if (kml.uncompressedBytes > MAX_KMZ_ENTRY_BYTES) {
    throw new Error(translate("kmz.tooBigUnpacked"));
  }

  // The local header, whose own name and extra lengths are the ones that
  // count: the central directory's may differ, and reading the data from the
  // directory's offsets is how an archive reads as corrupt.
  const local = kml.headerAt;
  if (local + 30 > archive.byteLength) {
    throw new Error(translate("kmz.truncated"));
  }
  if (bytes.getUint32(local, true) !== 0x04034b50) {
    throw new Error(translate("kmz.notZipLayout"));
  }
  const nameLength = bytes.getUint16(local + 26, true);
  const extraLength = bytes.getUint16(local + 28, true);
  const from = local + 30 + nameLength + extraLength;
  const to = from + kml.compressedBytes;
  if (to > archive.byteLength) throw new Error(translate("kmz.truncated"));
  const raw = new Uint8Array(archive, from, kml.compressedBytes);

  if (kml.compression === 0) {
    return new TextDecoder().decode(raw);
  }
  if (kml.compression !== 8) {
    throw new Error(translate("kmz.compression"));
  }
  return new TextDecoder().decode(await inflate(raw));
}
