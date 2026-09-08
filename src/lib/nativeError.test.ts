import { afterEach, describe, expect, it } from "vitest";
import { nativeErrorParams } from "./nativeError";
import { dataExportErrorText } from "./dataExport";
import { ensureLanguage, setLanguage, translate } from "../i18n";
import { en } from "../i18n/en";
import { es } from "../i18n/es";
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

  it("reads as one sentence, whatever the status turns out to mean", async () => {
    // The four sentences were written when the native side sent a bare status
    // code and they ended "could not be reached. {0}". The verb phrases that
    // replaced the code complete a sentence somebody else started, so a 503
    // from the archive read "The radar archive could not be reached. is busy",
    // and the same in Spanish and in French. Every one of the four keys has to
    // hold every one of the five answers.
    const keys = [
      "radar.error.httpStatus",
      "packs.error.httpStatus",
      "bundle.error.httpStatus",
      "dataExport.error.gridHttpStatus",
    ] as const;
    const statuses = [404, 429, 403, 503, 418];
    for (const language of ["en", "es", "fr"] as const) {
      await ensureLanguage(language);
      setLanguage(language);
      for (const key of keys) {
        for (const status of statuses) {
          const code = key.startsWith("dataExport")
            ? "gridHttpStatus"
            : "httpStatus";
          const said = translate(
            key,
            nativeErrorParams(code, [String(status)]),
          );
          // The tell the defect leaves: a full stop, a space, then the verb
          // phrase that was meant to follow a subject.
          expect(said, `${language} ${key} ${status}`).not.toMatch(
            /\.\s+\p{Ll}/u,
          );
          // And it is a whole sentence rather than a fragment.
          expect(said, `${language} ${key} ${status}`).toMatch(/\.$/);
          expect(said, `${language} ${key} ${status}`).not.toContain(
            String(status),
          );
        }
      }
    }
  });

  it("carries no object the subject has to agree with", () => {
    // The four subjects are a service, a server, an archive and a replay
    // service, and in Spanish and French the thing each of them could not
    // find is a mesh, a tile, a volume and a rebroadcast: three of the four
    // are feminine. A verb phrase carrying a fixed masculine object pronoun
    // therefore disagreed with three of its four subjects, and the sentence
    // gate above cannot see it because it looks only for a full stop followed
    // by a lower-case letter.
    //
    // Held as a property of the phrases rather than of the sentences: they
    // complete a sentence somebody else started and cannot know its object.
    const gendered = [
      // Spanish object pronouns, and the French elided one.
      /\blo\b/,
      /\bla\b/,
      /\blos\b/,
      /\blas\b/,
      /\bl'/,
      /\ble\b/,
    ];
    for (const [language, copy] of [
      ["es", es],
      ["fr", fr],
    ] as const) {
      for (const key of [
        "service.busy",
        "service.notFound",
        "service.tooMany",
        "service.refused",
        "service.unexpected",
      ] as const) {
        for (const pattern of gendered) {
          expect(
            pattern.test(copy[key]),
            `${language} ${key} reads "${copy[key]}"`,
          ).toBe(false);
        }
      }
    }
  });

  it("keeps the five phrases as they were checked against every subject", () => {
    // A regex cannot see agreement. "está ocupado" and "est occupé" were
    // right after "el servidor de teselas" and wrong after "la búsqueda de
    // lugares", "l'analyse de fumée", "la prévision" and "l'archive des
    // avertissements", every one of which completes with one of these; the
    // pronoun rule above looks for an object and saw none of it.
    //
    // So the phrases are pinned instead. Each was rendered after all twelve
    // subjects in the tree that end with `{answer}` or `{0}` and read for
    // agreement, and none of them now carries a gender at all. Changing one
    // fails here, which is the point: the next person has to do that reading
    // again rather than write a phrase that agrees with the subject they
    // happened to be looking at.
    expect({
      es: {
        busy: es["service.busy"],
        notFound: es["service.notFound"],
        tooMany: es["service.tooMany"],
        refused: es["service.refused"],
        unexpected: es["service.unexpected"],
      },
      fr: {
        busy: fr["service.busy"],
        notFound: fr["service.notFound"],
        tooMany: fr["service.tooMany"],
        refused: fr["service.refused"],
        unexpected: fr["service.unexpected"],
      },
    }).toEqual({
      es: {
        busy: "no da abasto",
        notFound: "no encontró nada",
        tooMany: "ha recibido demasiadas consultas",
        refused: "se negó a responder",
        unexpected: "respondió de una forma que no se pudo leer",
      },
      fr: {
        busy: "ne suit plus",
        notFound: "n'a rien trouvé",
        tooMany: "a reçu trop de demandes",
        refused: "a refusé de répondre",
        unexpected: "a répondu d'une manière illisible",
      },
    });
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

describe("no catalogue line is only a placeholder", () => {
  it("wraps every native failure in words somebody wrote", () => {
    // Three keys were exactly "{0}" or "{state}", so a Spanish reader whose
    // grid export failed saw a Rust error's Display text in English inside a
    // translated toast, and a French reader saw the RDA's own word inside a
    // French sentence. A catalogue value that is only a parameter is not a
    // translation of anything.
    // A positional argument is always a string the native side or a feed
    // handed over, so a value that is only one is a line nobody wrote. A
    // named one is a different thing and three of those are deliberate:
    // `settings.radiusValue` and `tool.rangeResult` hold a distance this app
    // formatted with the catalogue's own unit words, and `alerts.impactBadge`
    // holds an office tag. Each exists so a language can put wording around
    // the value if it needs to.
    const bare = Object.entries(en)
      .filter(([, value]) => /^\{\d+\}$/.test(value.trim()))
      .map(([key]) => key);
    expect(bare).toEqual([]);

    // And the state key by name, so this cannot pass because it was renamed.
    expect(en["radar.faultNotOperating"]).toContain("{state}");
    expect(en["radar.faultNotOperating"].trim()).not.toBe("{state}");
  });

  it("says what went wrong with a grid, in the reader's own language", async () => {
    // The MRMS errors were flattened to their Display text and handed
    // through. Each one now carries a code the catalogue answers.
    const cases: Array<[string, string[]]> = [
      ["gridUnknownProduct", ["mrms-rala"]],
      ["gridBadListing", []],
      ["gridNoFrames", ["MergedReflectivityQCComposite"]],
      ["gridNotGrib", []],
      ["gridUnreadable", []],
      ["gridNotDrawn", []],
    ];
    for (const [code, args] of cases) {
      const said = dataExportErrorText({ code, args });
      expect(said, code).not.toBe("");
      expect(said, code).not.toContain("{");
      // Not the code itself leaking through as the whole message.
      expect(said, code).not.toBe(code);
    }
    // And the argument reaches the sentence.
    expect(
      dataExportErrorText({ code: "gridUnknownProduct", args: ["mrms-rala"] }),
    ).toContain("mrms-rala");

    await ensureLanguage("fr");
    setLanguage("fr");
    expect(dataExportErrorText({ code: "gridNotGrib", args: [] })).toBe(
      fr["dataExport.error.gridNotGrib"],
    );
    setLanguage("en");
  });
});
