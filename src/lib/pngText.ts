/**
 * The provenance record, inside the picture rather than only beside it.
 *
 * Every export writes a `-provenance.json` next to the file, and the file is
 * the one that gets sent on: pasted into a message, dropped into a document,
 * uploaded to a thread. The sidecar stays behind, and a week later nobody can
 * say which radar, which volume or which minute the picture is of.
 *
 * PNG has carried text for this since 1996. An `iTXt` chunk is an ancillary
 * chunk holding a keyword and UTF-8 text, and anything that reads PNG either
 * shows it or ignores it, so a picture with one is still just a picture.
 *
 * Written by hand rather than by the encoder, because the encoder here is the
 * browser's: the still is `canvas.toBlob`, and by the time this app has bytes
 * the file is finished. Inserting an ancillary chunk before `IEND` is exactly
 * what the format allows for that.
 */

/** The eight bytes every PNG begins with. */
const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/**
 * The keyword this app writes its record under.
 *
 * Keywords are 1 to 79 Latin-1 characters and are the only thing a reader has
 * to go on, so it names the app and the thing rather than being `Comment`.
 */
export const PROVENANCE_KEYWORD = "OpenRadar Provenance";

/**
 * CRC-32 as PNG specifies it, which is the reflected polynomial 0xEDB88320.
 *
 * The table is built once. Every chunk carries one over its type and its data,
 * and a chunk with a wrong one is a corrupt file rather than a chunk a reader
 * skips.
 */
const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let at = 0; at < 256; at += 1) {
    let value = at;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[at] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value = TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

/** One chunk: its length, its type, its data and the CRC over the last two. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const named = new TextEncoder().encode(type);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(named, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * The `iTXt` payload: keyword, two compression bytes, two empty tags, text.
 *
 * Uncompressed on purpose. A compressed one would need zlib in the page for a
 * few kilobytes of JSON, and an uncompressed chunk is what a reader with a hex
 * editor and no tooling can still get the record out of.
 */
function textData(keyword: string, text: string): Uint8Array {
  const encoder = new TextEncoder();
  const named = encoder.encode(keyword);
  const body = encoder.encode(text);
  const out = new Uint8Array(named.length + 5 + body.length);
  out.set(named, 0);
  // The keyword's terminator, then compression flag 0 and method 0, then the
  // empty language tag and the empty translated keyword, each terminated.
  out.set([0, 0, 0, 0, 0], named.length);
  out.set(body, named.length + 5);
  return out;
}

/** Where `IEND` begins, or null when these bytes are not a PNG this can edit. */
function endOf(bytes: Uint8Array): number | null {
  if (bytes.length < SIGNATURE.length + 12) return null;
  if (SIGNATURE.some((byte, at) => bytes[at] !== byte)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Walked rather than searched for. The four bytes `IEND` can occur inside
  // compressed image data, and a chunk inserted at that offset would corrupt
  // the picture rather than annotate it.
  let at = SIGNATURE.length;
  while (at + 8 <= bytes.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (type === "IEND") return at;
    // A length read as an unsigned thirty-two bit number cannot walk
    // backwards, so the only way out here is off the end: a download that
    // stopped part way through is not a file to add a chunk to.
    const next = at + 12 + length;
    if (next > bytes.length) return null;
    at = next;
  }
  return null;
}

/**
 * Whether a keyword is one this writer can put in a file correctly.
 *
 * The format allows 1 to 79 characters from 32-126 and 161-255, with no
 * leading, trailing or consecutive spaces. This is stricter in one way and
 * the reason is the writer below: the keyword goes through `TextEncoder`,
 * which is UTF-8, into a field the format defines as Latin-1. Every code
 * above 126 therefore comes out as two bytes and reads back wrong, so
 * "Créditos" was written as "CrÃ©ditos" and a first attempt at this check
 * blessed it as a good keyword. ASCII is what round-trips, so ASCII is what
 * is allowed, and the alternative, encoding the field as Latin-1, buys a
 * range nothing here wants.
 *
 * The space rules are the specification's own, and they are about a person
 * reading the keyword back rather than about the bytes.
 */
function usableKeyword(keyword: string): boolean {
  return (
    keyword.length >= 1 &&
    keyword.length <= 79 &&
    !keyword.startsWith(" ") &&
    !keyword.endsWith(" ") &&
    !keyword.includes("  ") &&
    [...keyword].every((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code <= 126;
    })
  );
}

/**
 * The same picture with one `iTXt` chunk added before its end.
 *
 * The bytes back unchanged when they are not a PNG, which is what a WebM, an
 * MP4 or a GIF export hands over: a caller that annotates whatever it saved
 * should not have to know which of those it has, and none of the others has
 * anywhere to put this.
 */
export function withPngText(
  bytes: Uint8Array,
  keyword: string,
  text: string,
): Uint8Array {
  if (!usableKeyword(keyword)) return bytes;
  const end = endOf(bytes);
  if (end === null) return bytes;
  const added = chunk("iTXt", textData(keyword, text));
  const out = new Uint8Array(bytes.length + added.length);
  out.set(bytes.subarray(0, end), 0);
  out.set(added, end);
  out.set(bytes.subarray(end), end + added.length);
  return out;
}
