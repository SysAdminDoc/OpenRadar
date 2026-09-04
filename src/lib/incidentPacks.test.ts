import { afterEach, describe, expect, it } from "vitest";
import { packErrorText } from "./incidentPacks";
import { ensureLanguage, setLanguage } from "../i18n";
import { en } from "../i18n/en";
import { fr } from "../i18n/fr";

afterEach(() => setLanguage("en"));

/**
 * What a pack failure says to the reader.
 *
 * The native side serialized these as its own English sentence, so a French
 * reader was told "that region needs 41200 tiles, above the 25000 tile
 * limit": the wrong language, and a count written the way `usize` writes one
 * rather than the way a person does.
 */
describe("a pack failure in the reader's language", () => {
  it("counts the tiles the way a person writes a number", () => {
    const said = packErrorText({
      code: "tooManyTiles",
      args: ["41200"],
      text: "that region needs 41200 tiles, above the 25000 tile limit",
    });
    expect(said).toContain("41,200");
    expect(said).not.toContain("41200");
  });

  it("says it in French when that is what is on", async () => {
    await ensureLanguage("fr");
    setLanguage("fr");
    const said = packErrorText({
      code: "diskCeiling",
      args: [],
      text: "the incident pack disk ceiling would be exceeded",
    });
    expect(said).toBe(fr["packs.error.diskCeiling"]);
    expect(said).not.toBe(en["packs.error.diskCeiling"]);
  });

  it("reads a code a manifest stored on its own", () => {
    // The pack row reads this field back out of a file, where it is a bare
    // code rather than the `{code, args, text}` a rejected command sends.
    expect(packErrorText("pausedOnExit")).toBe(en["packs.error.pausedOnExit"]);
    expect(packErrorText("corrupt")).toBe(en["packs.error.corrupt"]);
  });

  it("still shows a sentence an older build wrote into a manifest", () => {
    // Manifests already on disk hold English rather than a code. Better read
    // in the wrong language than swallowed.
    const old = "The download paused when OpenRadar closed.";
    expect(packErrorText(old)).toBe(old);
  });

  it("falls back to the native words, then to a sentence of its own", () => {
    // A code from a build that knows more failures than this one does.
    expect(
      packErrorText({ code: "somethingNew", args: [], text: "a new fault" }),
    ).toBe("a new fault");
    expect(packErrorText({})).toBe(en["packs.error.failed"]);
    expect(packErrorText(new Error("a thread went away"))).toBe(
      "a thread went away",
    );
  });
});
