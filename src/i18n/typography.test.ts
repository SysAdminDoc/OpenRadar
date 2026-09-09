import { describe, expect, it } from "vitest";
import { en } from "./en";
import { es } from "./es";
import { fr } from "./fr";

/**
 * The parts of a translation the type gate cannot see.
 *
 * Key parity is checked by the compiler and says nothing about register,
 * terminology or typography, and those three are what make a translation read
 * as translated. Each thing here was found by reading all three catalogues on
 * 2026-09-08, and each is a rule rather than a spelling: the point is that the
 * next string written follows the one the catalogue already keeps.
 */

/** Every value in a catalogue, with its key, so a failure can name it. */
function entries(copy: Record<string, string>): Array<[string, string]> {
  return Object.entries(copy);
}

describe("how a percentage is written", () => {
  // One rule per language, because a catalogue that does it both ways is a
  // catalogue where the next writer guesses. French takes a space before the
  // sign and Spanish takes none; English takes none.
  it("puts a space before the sign in French and nowhere else", () => {
    for (const [key, value] of entries(fr)) {
      if (!value.includes("%")) continue;
      // Every `%` that follows something is preceded by a space.
      expect(/\S%/.test(value), `fr ${key}: ${value}`).toBe(false);
    }
    for (const [copy, name] of [
      [en, "en"],
      [es, "es"],
    ] as const) {
      for (const [key, value] of entries(copy)) {
        if (!value.includes("%")) continue;
        expect(/\s%/.test(value), `${name} ${key}: ${value}`).toBe(false);
      }
    }
  });
});

describe("how a Spanish catalogue addresses the reader", () => {
  it("keeps to tú, which is what the other hundred and twenty strings use", () => {
    // One string had slipped into usted: "Abra el formulario … y péguelo",
    // in a catalogue that says "Mueve el mapa", "Acércate" and "Borra un
    // paquete" everywhere else. A reader does not notice which form it is;
    // they notice that one sentence sounds like a different app.
    const usted =
      /\b(Abra|Pegue|Haga|Vaya|Elija|Pulse|Escriba|Mueva|Borre|Suba|Toque|Mire|Espere|Zoom(?:e|ee))\b/;
    for (const [key, value] of entries(es)) {
      expect(usted.test(value), `es ${key}: ${value}`).toBe(false);
    }
  });

  it("writes a decimal the way the reader reads one", () => {
    // Every number the app formats goes through `Intl`, which writes "2,5" in
    // Spanish. A number written into a string by hand does not, and one had
    // been: "magnitud mayor a 2.5".
    for (const [key, value] of entries(es)) {
      expect(
        /\b\d+\.\d\b/.test(value),
        `es ${key} writes a decimal point: ${value}`,
      ).toBe(false);
    }
  });
});

describe("one word per thing", () => {
  it("does not call the replay bundle what it calls a folder", () => {
    // A French reader told to "ouvrir le dossier" could not tell a replay
    // bundle from a folder: sixteen `bundle.*` strings said "dossier" while
    // the logs folder and the downloads folder said it too. The bundle is a
    // "paquet de reprise" now, and "dossier" means a folder.
    for (const [key, value] of entries(fr)) {
      if (!key.startsWith("bundle.") && !key.startsWith("toast.bundle")) {
        continue;
      }
      expect(
        value.toLowerCase().includes("dossier"),
        `fr ${key}: ${value}`,
      ).toBe(false);
    }
  });

  it("does not call the replay bundle what it calls an incident pack", () => {
    // Spanish kept "paquete" for both, which are two different objects in two
    // different panels. Qualified it is unambiguous and stays; bare it is the
    // incident pack's word, and the bundle strings name the thing itself.
    const bare = /\bpaquete\b(?!\s+de\s+repetición)/i;
    for (const [key, value] of entries(es)) {
      if (!key.startsWith("bundle.")) continue;
      expect(
        bare.test(value),
        `es ${key} calls it a bare paquete: ${value}`,
      ).toBe(false);
    }
  });
});

describe("where a description ends", () => {
  // Fifty-two of the descriptions under a switch ended in a period and
  // sixty-two did not, with adjacent rows in the same panel disagreeing. A
  // reader does not think "that one has a full stop"; they see a column of
  // text that was written by two people. The rule is the shortest one that
  // reads right: a fragment is not a sentence and takes no stop, and two
  // sentences take two stops.
  //
  // The three catalogues agree on it exactly, which is what makes it a rule
  // rather than a preference: the translations mirror the original's
  // punctuation everywhere, so the decision only has to be made once.
  const boundary = /[.!?]\s+[A-ZÀ-Ü0-9]/;

  for (const [copy, name] of [
    [en, "en"],
    [es, "es"],
    [fr, "fr"],
  ] as const) {
    it(`stops a ${name} description only when it is more than one sentence`, () => {
      for (const [key, value] of entries(copy)) {
        if (!key.endsWith("Detail")) continue;
        // A plural block carries its own punctuation inside the arms, where
        // the rule cannot see the end of the sentence.
        if (/\{[a-z]+, plural/.test(value)) continue;
        const many = boundary.test(value);
        expect(value.trimEnd().endsWith("."), `${name} ${key}: ${value}`).toBe(
          many,
        );
      }
    });
  }
});

describe("what a sentence calls the thing it is given", () => {
  // The file's own header forbids a numbered placeholder and twenty-three
  // strings used one. `{0}` says nothing about what will land there, so a
  // translator moving a clause has to count the placeholders in the original
  // to find out which is which, and a language that puts them the other way
  // round has to keep the numbers straight while doing it.
  for (const [copy, name] of [
    [en, "en"],
    [es, "es"],
    [fr, "fr"],
  ] as const) {
    it(`names every argument a ${name} string takes`, () => {
      for (const [key, value] of entries(copy)) {
        expect(/\{\s*\d/.test(value), `${name} ${key}: ${value}`).toBe(false);
      }
    });
  }
});
