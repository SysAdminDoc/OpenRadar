import { afterEach, describe, expect, it } from "vitest";
import { ensureLanguage, setLanguage, translate } from "./index";
import { en } from "./en";
import { es } from "./es";

// Spanish is fetched when it is first wanted, so that a reader of English
// never downloads it. Importing the catalogue here does not install it: what
// is being checked is that the workspace stays readable in the window before
// it arrives, and turns Spanish once it has.

afterEach(() => setLanguage("en"));

describe("copy that is not in the first load", () => {
  it("falls back to English until the Spanish arrives, then reads Spanish", async () => {
    const key = "history.liveRadar";
    expect(en[key]).not.toBe(es[key]);
    // Nothing has asked for Spanish yet in this file.
    expect(translate(key, undefined, "es")).toBe(en[key]);

    await ensureLanguage("es");
    expect(translate(key, undefined, "es")).toBe(es[key]);

    // And a switch made without waiting lands too, because the fetch tells
    // the subscribers again when it is done.
    setLanguage("es");
    expect(translate(key)).toBe(es[key]);
  });

  it("has nothing to wait for in the languages that ship", async () => {
    // Resolved promises, not a network round trip: English is the first load
    // and the pseudolocale is made out of it.
    await expect(ensureLanguage("en")).resolves.toBeUndefined();
    await expect(ensureLanguage("pseudo")).resolves.toBeUndefined();
    setLanguage("pseudo");
    expect(translate("history.liveRadar")).not.toBe(en["history.liveRadar"]);
  });
});
