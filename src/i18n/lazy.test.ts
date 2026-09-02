import { afterEach, describe, expect, it } from "vitest";
import { ensureLanguage, setLanguage, translate } from "./index";
import { en } from "./en";
import { es } from "./es";
import { fr } from "./fr";

// Spanish and French are fetched when first wanted, so that a reader of one
// never downloads the others. Importing the catalogues here does not install
// them: what is being checked is that the workspace stays readable in the
// window before one arrives, and turns that language once it has.

afterEach(() => setLanguage("en"));

const FETCHED = [
  ["es", es],
  ["fr", fr],
] as const;

describe("copy that is not in the first load", () => {
  it.each(FETCHED)(
    "falls back to English until %s arrives, then reads it",
    async (which, copy) => {
      const key = "history.liveRadar";
      expect(en[key]).not.toBe(copy[key]);
      // Nothing has asked for this language yet in this file.
      expect(translate(key, undefined, which)).toBe(en[key]);

      await ensureLanguage(which);
      expect(translate(key, undefined, which)).toBe(copy[key]);

      // And a switch made without waiting lands too, because the fetch tells
      // the subscribers again when it is done.
      setLanguage(which);
      expect(translate(key)).toBe(copy[key]);
    },
  );

  it("has nothing to wait for in the languages that ship", async () => {
    // Resolved promises, not a network round trip: English is the first load
    // and the pseudolocale is made out of it.
    await expect(ensureLanguage("en")).resolves.toBeUndefined();
    await expect(ensureLanguage("pseudo")).resolves.toBeUndefined();
    setLanguage("pseudo");
    expect(translate("history.liveRadar")).not.toBe(en["history.liveRadar"]);
  });
});
