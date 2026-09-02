import { describe, expect, it } from "vitest";
import { pictureDataUrl } from "./journal";
import { JOURNAL_THUMB_MAX_BYTES } from "./journal";

/**
 * Turning thumbnail bytes into something a window can show.
 *
 * The bug this holds shut: `String.fromCharCode(...bytes)` spreads one
 * argument per byte, and somewhere above a hundred thousand of them the call
 * stack goes. A thumbnail is allowed up to `JOURNAL_THUMB_MAX_BYTES`, which
 * is above that line, so a picture that was otherwise perfectly acceptable
 * threw inside an effect with no catch and the small window went unwritten.
 */

describe("a picture on its way to the small window", () => {
  it("survives the largest thumbnail the record will hold", () => {
    const big = new Uint8Array(JOURNAL_THUMB_MAX_BYTES);
    for (let at = 0; at < big.length; at += 1) big[at] = at % 256;
    const url = pictureDataUrl(big);
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
    // Base64 is four characters for every three bytes, so the length is the
    // proof it encoded all of them rather than a prefix.
    expect(url.length).toBeGreaterThan((big.length * 4) / 3);
  });

  it("says the same thing the short way would have", () => {
    const small = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255, 128, 7]);
    expect(pictureDataUrl(small)).toBe(
      `data:image/png;base64,${btoa(String.fromCharCode(...small))}`,
    );
  });

  it("is stable at the chunk boundary", () => {
    for (const size of [8191, 8192, 8193, 16384, 16385]) {
      const bytes = new Uint8Array(size).fill(0xab);
      expect(pictureDataUrl(bytes), String(size)).toBe(
        `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`,
      );
    }
  });
});
