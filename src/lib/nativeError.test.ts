import { afterEach, describe, expect, it } from "vitest";
import { nativeErrorParams } from "./nativeError";
import { ensureLanguage, setLanguage, translate } from "../i18n";
import { en } from "../i18n/en";
import { fr } from "../i18n/fr";

/**
 * A failure the native side reported, said in the reader's own language.
 *
 * Two of these carry a count, and Rust writes a count as a bare run of digits.
 * A French reader was being told an export would be "4300000 mesures", which
 * is not how anybody writes that number, and once the sentence counted
 * properly it also had to be able to say one.
 */

afterEach(() => setLanguage("en"));

describe("a counted failure from the native side", () => {
  it("hands the number over as a number", () => {
    // Formatted here, it would reach the sentence as "4,300,000", which a
    // plural block cannot read: it would fall to the plural arm and print no
    // number at all.
    expect(nativeErrorParams("tooLarge", ["4300000"])).toEqual({
      0: 4_300_000,
    });
    expect(nativeErrorParams("tooManyTiles", [1])).toEqual({ 0: 1 });
  });

  it("leaves alone the arguments that are not counts", () => {
    // A layout version and a station whose name happens to be digits are
    // machine values, and must come through exactly as they were.
    expect(nativeErrorParams("unsupportedLayout", ["0031"])).toEqual({
      0: "0031",
    });
    expect(nativeErrorParams("tooLarge", ["not a number"])).toEqual({
      0: "not a number",
    });
  });

  it("writes the number the reader's way, and counts it properly", async () => {
    expect(
      translate(
        "dataExport.error.tooLarge",
        nativeErrorParams("tooLarge", ["4300000"]),
      ),
    ).toContain("4,300,000 readings");
    expect(
      translate(
        "bundle.error.tooManyTiles",
        nativeErrorParams("tooManyTiles", ["1"]),
      ),
    ).toContain("1 tile across");

    await ensureLanguage("fr");
    setLanguage("fr");
    const said = translate(
      "dataExport.error.tooLarge",
      nativeErrorParams("tooLarge", ["4300000"]),
    );
    // A space rather than a comma, which is how French writes it, and never
    // the bare digits Rust handed over.
    expect(said).not.toContain("4300000");
    expect(said).toContain("relevés");
  });
});

describe("a failure the native side blamed on a service", () => {
  it("says what the status means rather than printing it", () => {
    // `reqwest`'s own Display carries the address it failed on, and the whole
    // of it was being handed to the page: a bucket key that 404s reached the
    // panel as an S3 URL and a status code, in English, in every language.
    // The status is what travels now, and this is where it becomes words.
    const said = translate(
      "radar.error.httpStatus",
      nativeErrorParams("httpStatus", ["404"]),
    );
    expect(said).toContain(en["service.notFound"]);
    expect(said).not.toContain("404");
    expect(said).not.toContain("http");

    expect(
      translate(
        "radar.error.httpStatus",
        nativeErrorParams("httpStatus", ["503"]),
      ),
    ).toContain(en["service.busy"]);
  });

  it("says it in the reader's language, which the old text never was", async () => {
    await ensureLanguage("fr");
    setLanguage("fr");
    const said = translate(
      "radar.error.httpStatus",
      nativeErrorParams("httpStatus", ["503"]),
    );
    expect(said).toContain(fr["service.busy"]);
    expect(said).not.toContain(en["service.busy"]);
  });

  it("has a sentence for the failures that carry no status", () => {
    // A machine with no network, a host off the allowlist, and a reply larger
    // than the reader is going to be handed. None of them is a service saying
    // anything, so none of them has a code to say.
    for (const code of [
      "httpUnreachable",
      "httpRefused",
      "httpTooLarge",
    ] as const) {
      expect(nativeErrorParams(code, [])).toEqual({});
      expect(en[`radar.error.${code}`].length).toBeGreaterThan(0);
      expect(en[`bundle.error.${code}`].length).toBeGreaterThan(0);
    }
  });
});
