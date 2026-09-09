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
  /**
   * The same text with a multi-part abbreviation's periods taken out.
   *
   * Spanish writes the United States "EE. UU.", and reading the first of those
   * periods as a sentence end made one catalogue see two sentences in a
   * fragment the other two saw one in, which is the one place the three
   * disagreed about the rule.
   *
   * A run of two or more, not one. "One or two capitals then a period" was
   * the first attempt and it is far too wide: it exempts "5 MB." as well, so
   * "under 5 MB. Larger files are rejected" reads as one sentence and its
   * missing stop goes unseen, while "larger than 20 MB. The export stops
   * there." is called one sentence with a stop on it and fails for being
   * correct. `MB.` already appears ten times, five in English and five in
   * Spanish; French writes "Mo" and has none.
   * What makes "EE. UU." an abbreviation rather than a sentence end is that
   * the next token is another one or two capitals with a period of its own,
   * which "Larger" and "The" are not.
   *
   * Two cases this cannot separate, both of them where the abbreviation's own
   * period would have to do a sentence's job as well: a real sentence starting
   * straight after a run, and a run at the end of a value that is genuinely
   * more than one sentence ("La capa es opcional. Cubre solo EE. UU."). A
   * name's initials mid-string are the same shape from the other side. None of
   * the three is in a catalogue today.
   *
   * `À-Ü` spans U+00D7, which is the multiplication sign rather than a
   * letter, so the class is written around it.
   */
  const spelledOut = (value: string) =>
    value.replace(
      /(^|\s)([A-ZÀ-ÖØ-Ü]{1,2}\.(?:\s*[A-ZÀ-ÖØ-Ü]{1,2}\.)+)/g,
      (_whole, before: string, run: string) => before + run.replace(/\./g, ""),
    );

  /**
   * Whether a description is more than one sentence.
   *
   * A stop, a space, and something a sentence can start with, which is a
   * capital or a digit: "100% means the rain has met it" is a sentence and
   * "0.5 degrees" is not two.
   */
  const moreThanOne = (value: string) =>
    /[.!?]\s+[A-ZÀ-ÖØ-Ü0-9]/.test(spelledOut(value));

  /**
   * Whether a description ends in a full stop.
   *
   * The same abbreviation from the other end: the period at the end of "solo
   * EE. UU." belongs to a word, not to a sentence.
   */
  const stops = (value: string) => spelledOut(value).trimEnd().endsWith(".");

  it("reads a sentence end and an abbreviation apart", () => {
    // Driven here rather than only across the catalogues, because the
    // catalogues cannot tell these rules apart: exactly one live string
    // changes classification under the abbreviation handling, and it passes
    // either way. A rule the corpus cannot distinguish is a rule nothing is
    // holding, so the cases it exists for are written down.
    //
    // Each entry is the value, then what the two halves should say about it.
    const cases: Array<[string, { stops: boolean; many: boolean }]> = [
      // The abbreviation this was written for. One fragment, no stop of its
      // own: the period belongs to "UU".
      ["Imágenes del USGS, solo EE. UU.", { stops: false, many: false }],
      ["USGS imagery, US only", { stops: false, many: false }],
      // A unit that is one or two capitals is not an abbreviation of this
      // kind, and the sentence after it is a sentence. Both directions: a
      // missing stop has to be seen, and a correct pair has to be left alone.
      [
        "The upload must be under 5 MB. Larger files are rejected",
        { stops: false, many: true },
      ],
      [
        "Nothing larger than 20 MB. The export stops there.",
        { stops: true, many: true },
      ],
      // The ordinary shapes the sweep below is made of.
      [
        "Everything in the workspace, drawn larger",
        { stops: false, many: false },
      ],
      [
        "The block is on your clipboard. Open the issue form and paste it in.",
        { stops: true, many: true },
      ],
      // A decimal is not a sentence boundary, and neither is a period with no
      // space after it.
      ["Gates below 0.5 degrees are dropped", { stops: false, many: false }],
      ["100% means the rain has met it", { stops: false, many: false }],
    ];
    for (const [value, want] of cases) {
      expect({ stops: stops(value), many: moreThanOne(value) }, value).toEqual(
        want,
      );
    }
  });

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
        expect(stops(value), `${name} ${key}: ${value}`).toBe(
          moreThanOne(value),
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
