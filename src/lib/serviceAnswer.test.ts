import { describe, expect, it } from "vitest";
import { serviceAnswer } from "./serviceAnswer";
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
