import { afterEach, describe, expect, it } from "vitest";
import { ensureLanguage, setLanguage, translate } from "./index";
import { en } from "./en";
import { es } from "./es";
import { fr } from "./fr";
import { hailLine } from "../lib/overlays/alerts";
import { setUnits } from "../lib/units";

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

  it("counts in the pseudolocale too, which is a language like any other", async () => {
    // The pseudolocale is selectable in Settings, so what it renders is what
    // somebody sees. Accenting the machinery of a plural block stops it being
    // one, and the whole of the ICU source lands on screen: twenty-five of
    // these strings rendered as literal `{đáýš, ƥłúřáł, óñé {# đáý} ...}`.
    await ensureLanguage("pseudo");
    setLanguage("pseudo");
    for (const count of [1, 7]) {
      const said = translate("journal.count", { count });
      expect(said).not.toContain("plural");
      expect(said).not.toContain("{");
      expect(said).toContain(String(count));
    }
    // Still longer and stranger than the English, which is the whole point of
    // it: a label sized to its English text has to show up as clipped here.
    const said = translate("journal.count", { count: 7 });
    expect(said).toContain("⟦");
    expect(said.length).toBeGreaterThan("7 rows".length * 1.3);
    expect(said).not.toContain("rows");
  });

  it("prints the number it chose its words by", () => {
    // The block reads 1.5 as a plural, and a number rounded to no decimals
    // would have printed "2" beside the plural words. The sentence and its
    // own number have to agree.
    expect(translate("journal.count", { count: 1.5 })).toBe("1.5 rows");
    expect(translate("journal.count", { count: 2 })).toBe("2 rows");
  });

  it("falls back to the plural, without a number, when the number is missing", () => {
    // A caller that forgets the parameter, or hands over a string that was
    // already formatted, has a bug. What it must not do is put the template
    // on screen. What it does instead is stated exactly, because "does not
    // contain a brace" is also true of the empty string.
    expect(translate("journal.count", {})).toBe(" rows");
    expect(translate("journal.count", { count: "1,024" })).toBe(" rows");
    // Which is the shape of the mistake: the words are right and the number
    // is simply gone. Pass the raw number.
    expect(translate("journal.count", { count: 1024 })).toBe("1,024 rows");
  });

  it("writes a fractional count the reader's way, in every plural block", async () => {
    // The hail size in a warning popup was the one plural in the three
    // catalogues that named its value as `{size}` rather than `#`. The block
    // chose the arm on the number and then `translate` filled the name in with
    // `String(...)`, so a 1.75 inch tag read "1.75 pulgadas de granizo" in a
    // catalogue that writes every other number "1,75". This holds all of them
    // rather than that one, because the mistake is invisible until a value
    // with a decimal point goes through.
    for (const [language, copy] of [
      ["en", en],
      ["es", es],
      ["fr", fr],
    ] as const) {
      await ensureLanguage(language);
      setLanguage(language);
      for (const [key, value] of Object.entries(copy)) {
        const block = /\{(\w+), plural,/.exec(value);
        if (!block) continue;
        expect(
          value.slice(block.index).includes(`{${block[1]}}`),
          `${language} ${key} names its own count inside an arm rather than using #`,
        ).toBe(false);
      }
    }
  });

  it("writes a hail size in the reader's notation and units", async () => {
    await ensureLanguage("fr");
    setLanguage("fr");
    setUnits("imperial");
    // French counts 1.75 as singular, which is the point of asking the
    // catalogue rather than the value: `i = 1` picks the `one` arm and the
    // noun stays singular after a decimal.
    expect(hailLine(1.75)).toBe("1,75 pouce de grêle");
    expect(hailLine(2.5)).toBe("2,5 pouces de grêle");
    expect(hailLine(1)).toBe("1 pouce de grêle");
    // And the one measurement in a warning popup follows the units setting
    // like every other measurement in the app.
    setUnits("metric");
    expect(hailLine(1.75)).toBe("4,4 cm de grêle");

    // A tag that is not a number is remote input, and `maxHailSize` is
    // trimmed and nothing else. Unguarded, metric printed "NaN cm de grêle"
    // and imperial printed the unit with no number in front of it, because
    // the plural block writes nothing for a value it cannot read. A line the
    // popup cannot make sense of is one it leaves out.
    for (const nonsense of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
      expect(hailLine(nonsense), String(nonsense)).toBeNull();
    }
    setUnits("imperial");
    for (const nonsense of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
      expect(hailLine(nonsense), String(nonsense)).toBeNull();
    }
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

describe("a key no catalogue has", () => {
  it("returns something rather than taking the window down", () => {
    // `translate` fell back from a translation to English and stopped there.
    // With neither holding the key the template was `undefined` and the next
    // line read `.includes` off it, so a string nobody wrote threw and the
    // error boundary took the whole window: a reader saw nothing at all
    // rather than one wrong word. Seen on 2026-09-08 restoring a panel that
    // named a key removed the same day.
    const said = translate("not.a.real.key" as never);
    expect(typeof said).toBe("string");
    expect(said).toBe("not.a.real.key");
  });

  it("does not throw when it is handed parameters either", () => {
    // The plural block is read off the template first, which is where it
    // threw. A caller passing parameters is the ordinary case.
    expect(() =>
      translate("not.a.real.key" as never, { count: 3 }),
    ).not.toThrow();
  });
});
