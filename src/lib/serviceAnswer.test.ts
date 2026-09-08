import { describe, expect, it } from "vitest";
import { failureSentence, serviceAnswer } from "./serviceAnswer";
import { recentLog } from "./log";

/**
 * What a reader is told when a public service does not answer.
 *
 * Nine messages printed the protocol's own number at somebody who wants to
 * know whether it is going to rain. "The tide service returned 503" says
 * nothing about whether to wait, to check what they typed, or to give up.
 */
describe("what a service's answer means", () => {
  it("groups the codes by what the reader should do", () => {
    // Grouped rather than enumerated: 502 and 504 are the same answer to
    // anybody who is not reading the protocol.
    for (const status of [500, 502, 503, 504]) {
      expect(serviceAnswer(status), String(status)).toBe("is busy");
    }
    expect(serviceAnswer(404)).toBe("could not find it");
    expect(serviceAnswer(429)).toBe("has been asked too often");
    for (const status of [400, 401, 403, 418]) {
      expect(serviceAnswer(status), String(status)).toBe("refused");
    }
    expect(serviceAnswer(204)).toBe("answered in a way this could not read");
  });

  it("says none of it as a number", () => {
    for (const status of [400, 404, 418, 429, 500, 503, 204]) {
      expect(serviceAnswer(status)).not.toMatch(/\d/);
    }
  });

  it("keeps the number where somebody debugging will find it", () => {
    // The diagnostics block a reader pastes into a bug report is built from
    // this log, so taking the code out of the sentence must not lose it.
    serviceAnswer(503);
    const said = recentLog()
      .map((entry) => entry.message)
      .join("\n");
    expect(said).toContain("503");
  });
});

/**
 * What a reader is told when the request never reached a service at all.
 *
 * Every fetch here turns a bad status into one of the catalogue's own
 * sentences before it throws, so a panel could print what it caught. What
 * nothing covered was the case with no status: a refused connection, a name
 * that would not resolve, a captive portal, an aeroplane. `fetch` rejects
 * with a `TypeError` there, and the panels printed its message, which is the
 * browser engine's words in English whatever language the app is read in.
 */
describe("what a reader is told when nothing answered", () => {
  it("does not repeat the engine's own words", () => {
    // Chromium's is "Failed to fetch"; WebView2 on another channel differs,
    // and neither is ever translated.
    const said = failureSentence(new TypeError("Failed to fetch"));
    expect(said).toBe("The service could not be reached.");
    expect(said).not.toContain("Failed to fetch");
  });

  it("keeps a sentence this app wrote", () => {
    // A bad status is already turned into a catalogue line by whichever
    // adapter threw it, so the helper must not paint over one.
    expect(failureSentence(new Error("The tide service is busy."))).toBe(
      "The tide service is busy.",
    );
  });

  it("has something to say about anything at all", () => {
    for (const thrown of [null, undefined, "a string", 7, {}, new Error("")]) {
      expect(failureSentence(thrown), String(thrown)).toBe(
        "The request failed.",
      );
    }
  });

  it("lets the caller say it in its own words", () => {
    // A rejection with nothing in it comes from the native bridge rather than
    // from a service, and each panel has a better sentence for that than any
    // general one.
    expect(
      failureSentence({ code: "nope" }, "The sounding could not be read."),
    ).toBe("The sounding could not be read.");
    // But a request that never reached anybody is still described by why,
    // whatever the caller would rather say.
    expect(
      failureSentence(
        new TypeError("Failed to fetch"),
        "The sounding could not be read.",
      ),
    ).toBe("The service could not be reached.");
  });

  it("ends every answer as a sentence", () => {
    // These are printed on their own and after a full stop, unlike the verb
    // phrases above them, which complete a sentence somebody else started.
    for (const thrown of [new TypeError("x"), null]) {
      expect(failureSentence(thrown)).toMatch(/\.$/);
    }
  });
});
