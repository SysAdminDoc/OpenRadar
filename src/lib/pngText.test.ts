import { describe, expect, it } from "vitest";
import { PROVENANCE_KEYWORD, withPngText } from "./pngText";

/**
 * The reader, written here rather than in the module.
 *
 * Nothing in the app reads a picture back, so a reader that shipped would be
 * dead code. What it is for is refuting the writer: a chunk this cannot get
 * the text out of, at the offsets and with the checksum the format says, is
 * not a chunk anything else will read either.
 */
function chunks(bytes: Uint8Array): Array<{ type: string; data: Uint8Array }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const found: Array<{ type: string; data: Uint8Array }> = [];
  let at = 8;
  while (at + 12 <= bytes.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const data = bytes.subarray(at + 8, at + 8 + length);
    // The checksum the format carries, recomputed here: a chunk whose CRC is
    // wrong is a corrupt file, and every viewer says so rather than skipping
    // the chunk quietly.
    expect(
      view.getUint32(at + 8 + length),
      `${type} carries a wrong checksum`,
    ).toBe(crc(bytes.subarray(at + 4, at + 8 + length)));
    found.push({ type, data });
    at += 12 + length;
  }
  return found;
}

function crc(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

/**
 * The text of an `iTXt` chunk, walked the way the format describes it.
 *
 * Not "skip five bytes". The first version of this did exactly that, which is
 * the same arithmetic the writer does, so a writer one terminator short
 * produced a chunk this read back perfectly and nothing else would have: the
 * reader agreed with the writer instead of with the specification. Each field
 * is found by its own terminator, and a missing one is a failure here.
 */
function textOf(data: Uint8Array): { keyword: string; text: string } {
  const decoder = new TextDecoder();
  const terminator = (from: number) => {
    const at = data.indexOf(0, from);
    expect(at, `no terminator after byte ${from}`).toBeGreaterThan(-1);
    return at;
  };
  const keywordEnd = terminator(0);
  // Compression flag and compression method, one byte each.
  expect(data[keywordEnd + 1], "compressed, which nothing here writes").toBe(0);
  expect(data[keywordEnd + 2], "an unknown compression method").toBe(0);
  const languageEnd = terminator(keywordEnd + 3);
  const translatedEnd = terminator(languageEnd + 1);
  return {
    keyword: decoder.decode(data.subarray(0, keywordEnd)),
    text: decoder.decode(data.subarray(translatedEnd + 1)),
  };
}

/**
 * The smallest real PNG: signature, IHDR, one IDAT, IEND.
 *
 * Built rather than fetched so the test says what is in it. The IDAT holds
 * bytes that spell `IEND`, which is the case a chunk inserted by searching for
 * those four characters would corrupt.
 */
function tinyPng(): Uint8Array {
  const out: number[] = [137, 80, 78, 71, 13, 10, 26, 10];
  const add = (type: string, data: number[]) => {
    const named = [...type].map((character) => character.charCodeAt(0));
    out.push(
      (data.length >>> 24) & 0xff,
      (data.length >>> 16) & 0xff,
      (data.length >>> 8) & 0xff,
      data.length & 0xff,
      ...named,
      ...data,
    );
    const checksum = crc(new Uint8Array([...named, ...data]));
    out.push(
      (checksum >>> 24) & 0xff,
      (checksum >>> 16) & 0xff,
      (checksum >>> 8) & 0xff,
      checksum & 0xff,
    );
  };
  // 1x1, 8-bit greyscale, no interlacing.
  add("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0]);
  add("IDAT", [...[..."IEND"].map((one) => one.charCodeAt(0)), 1, 2, 3]);
  add("IEND", []);
  return new Uint8Array(out);
}

describe("the record inside the picture", () => {
  const record = JSON.stringify(
    { format: "openradar-export", frames: [{ index: 0, label: "KDMX" }] },
    null,
    2,
  );

  it("gives back the text it was handed, byte for byte", () => {
    // The whole point: the sidecar beside the file and the text inside it are
    // the same document, so a picture that arrived on its own can still be
    // read. Two spaces of indentation and all.
    const written = withPngText(tinyPng(), PROVENANCE_KEYWORD, record);
    const carried = chunks(written).filter((one) => one.type === "iTXt");
    expect(carried).toHaveLength(1);
    expect(textOf(carried[0].data)).toEqual({
      keyword: PROVENANCE_KEYWORD,
      text: record,
    });
  });

  it("leaves the picture that was already there alone", () => {
    // Everything before the new chunk is the file as it arrived, in order,
    // and the file still ends where a PNG ends.
    const before = tinyPng();
    const written = withPngText(before, PROVENANCE_KEYWORD, record);
    const kinds = chunks(written).map((one) => one.type);
    expect(kinds).toEqual(["IHDR", "IDAT", "iTXt", "IEND"]);
    // The image data itself is untouched. It spells `IEND` on purpose: a
    // writer that found the end by searching for those four bytes would have
    // cut the picture in half here, and every chunk after it would still have
    // parsed as long as nothing checked the order.
    const idat = chunks(written).find((one) => one.type === "IDAT");
    expect([...(idat?.data ?? [])]).toEqual([73, 69, 78, 68, 1, 2, 3]);
  });

  it("hands back anything that is not a PNG unchanged", () => {
    // A WebM, an MP4 and a GIF all come through the same writer and none of
    // them has anywhere to put this. Identity rather than equality, because
    // the caller decides whether to rewrap the blob on exactly that.
    const webm = new Uint8Array([26, 69, 223, 163, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(withPngText(webm, PROVENANCE_KEYWORD, record)).toBe(webm);
    // And a PNG signature over bytes that are not chunks, which is a truncated
    // download rather than a file to edit.
    const cut = tinyPng().subarray(0, 20);
    expect(withPngText(cut, PROVENANCE_KEYWORD, record)).toBe(cut);
  });

  it("refuses a keyword the format does not allow", () => {
    // One to seventy-nine Latin-1 characters, which was documented and not
    // checked: an empty keyword, a four hundred byte one and one written in
    // Japanese all produced a file, and the last reads back as mojibake in
    // every viewer because the field is Latin-1 while the text beside it is
    // UTF-8. The picture comes back untouched rather than carrying a chunk
    // nothing can read.
    const png = tinyPng();
    for (const bad of [
      "",
      "k".repeat(80),
      "気象レーダー",
      "with\nnewline",
      // The specification's own space rules, which are about a person reading
      // the keyword back rather than about the bytes.
      " leading",
      "trailing ",
      "two  spaces",
      // And the one a first attempt at this let through. The writer encodes
      // this field with `TextEncoder`, which is UTF-8, into a field the
      // format defines as Latin-1: "Créditos" was written as the bytes for
      // "CrÃ©ditos" and every viewer read it back that way. ASCII is what
      // round-trips, so ASCII is what is allowed.
      "Créditos",
    ]) {
      expect(withPngText(png, bad, record), JSON.stringify(bad)).toBe(png);
    }
    // And the boundaries on the good side, so the limit is a limit rather
    // than a refusal of everything.
    expect(withPngText(png, "k".repeat(79), record)).not.toBe(png);
    expect(withPngText(png, "One Space", record)).not.toBe(png);
  });

  it("writes a keyword a reader gets back exactly", () => {
    // The keyword is the only thing anybody has to find this by, so it is
    // read back byte for byte rather than trusted. Every allowed character
    // is one byte, which is what makes that true.
    const written = withPngText(tinyPng(), PROVENANCE_KEYWORD, record);
    const carried = chunks(written).find((one) => one.type === "iTXt");
    const keyword = carried!.data.subarray(0, carried!.data.indexOf(0));
    expect([...keyword]).toEqual(
      [...PROVENANCE_KEYWORD].map((one) => one.charCodeAt(0)),
    );
    expect(new TextDecoder().decode(keyword)).toBe(PROVENANCE_KEYWORD);
  });

  it("carries text that is not ASCII", () => {
    // `iTXt` is the UTF-8 one of the three text chunks, which is why it is the
    // one used: a place name in the record is whatever the reader's catalogue
    // says, and `tEXt` is Latin-1.
    const said = JSON.stringify({ place: "Île-de-France 東京 Ñuñoa" });
    const written = withPngText(tinyPng(), PROVENANCE_KEYWORD, said);
    const carried = chunks(written).find((one) => one.type === "iTXt");
    expect(textOf(carried!.data).text).toBe(said);
  });
});
