import { afterEach, describe, expect, it } from "vitest";
import { ensureLanguage, setLanguage, translate } from "./index";
import { en } from "./en";
import { es } from "./es";
import { fr } from "./fr";

/**
 * "1 warnings" is the sort of thing that makes careful writing look generated.
 *
 * Which forms a language needs is the language's business: English has one and
 * other, Spanish counts its millions separately, French counts zero and one
 * together. `Intl.PluralRules` knows all of that, and a template says what to
 * write for each form it uses.
 */

afterEach(() => setLanguage("en"));

/** Spanish and French are lazy chunks, so they are asked for and awaited. */
async function speaking(which: "es" | "fr") {
  await ensureLanguage(which);
  setLanguage(which);
}

describe("counting things in the reader's own language", () => {
  it("says one thing for one and another for more", () => {
    expect(translate("journal.count", { count: 1 })).toBe("1 row");
    expect(translate("journal.count", { count: 0 })).toBe("0 rows");
    expect(translate("journal.count", { count: 12 })).toBe("12 rows");
    expect(translate("catchUp.awayHours", { hours: 1 })).toBe("1 hour");
    expect(translate("catchUp.awayHours", { hours: 5 })).toBe("5 hours");
  });

  it("counts twice in one sentence without confusing the two", () => {
    expect(translate("recap.counted", { alerts: 1, observations: 4 })).toBe(
      "1 warning and 4 observations.",
    );
    expect(translate("recap.counted", { alerts: 3, observations: 1 })).toBe(
      "3 warnings and 1 observation.",
    );
  });

  it("writes the number the way the reader writes numbers", () => {
    // The `#` is the number, formatted, so a plural block cannot be the one
    // place in the app that prints a bare English 1234.
    expect(translate("journal.count", { count: 1234 })).toBe("1,234 rows");
  });

  it("keeps the ordinary blanks in the arm that was chosen", () => {
    expect(translate("journal.countShown", { shown: 6, count: 1 })).toBe(
      "6 of 1 row",
    );
  });

  it("does the same in Spanish and French", async () => {
    await speaking("es");
    expect(translate("journal.count", { count: 1 })).toBe("1 fila");
    expect(translate("journal.count", { count: 9 })).toBe("9 filas");
    expect(translate("recap.counted", { alerts: 1, observations: 1 })).toBe(
      "1 aviso y 1 observación.",
    );

    await speaking("fr");
    expect(translate("journal.count", { count: 1 })).toBe("1 ligne");
    // French counts zero with one, which an English `count === 1` gets wrong.
    expect(translate("journal.count", { count: 0 })).toBe("0 ligne");
    expect(translate("journal.count", { count: 9 })).toBe("9 lignes");
  });

  it("falls back rather than showing braces when the number is missing", () => {
    // A caller that forgets the parameter should get a readable sentence, not
    // the template. Every plural has an `other` arm for exactly this.
    expect(translate("journal.count", {})).not.toContain("plural");
    expect(translate("journal.count", {})).not.toContain("{");
  });

  it("gives every plural block an other arm, in every language", () => {
    // The arm that is used when nothing else matches, and the one a reader
    // whose language needs a form the translator did not write falls back to.
    for (const [language, copy] of [
      ["English", en],
      ["Spanish", es],
      ["French", fr],
    ] as const) {
      for (const [key, value] of Object.entries(copy)) {
        if (!value.includes(", plural,")) continue;
        expect(value, `${language} ${key}`).toMatch(/\bother\s*\{/);
      }
    }
  });
});
