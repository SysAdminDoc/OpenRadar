import { describe, expect, it } from "vitest";
import { dataExportErrorText, exportSize } from "./dataExport";

describe("what a refused data export says", () => {
  it("uses the reader's wording for a code it knows", () => {
    // The count is a number a person reads, so it is grouped rather than
    // being handed on as the native side's digits. This asserted the raw
    // string, which is the bug: a Spanish or French reader was being told
    // the export would be "9000000 mediciones".
    expect(
      dataExportErrorText({ code: "tooLarge", args: ["9000000"] }),
    ).toContain("9,000,000");
    expect(dataExportErrorText({ code: "notDrawn", args: [] })).toContain(
      "not on the map",
    );
    expect(dataExportErrorText({ code: "nothingInView", args: [] })).toContain(
      "no part of that grid",
    );
  });

  it("keeps the radar's own wording for a radar failure", () => {
    // The export path can fail the same ways the picture can, and a reader
    // should not get a second vocabulary for the same problem.
    const said = dataExportErrorText({
      code: "noVolume",
      args: ["KDMX"],
      text: "raw",
    });
    expect(said).toContain("KDMX");
    expect(said).not.toBe("raw");
  });

  it("falls back to what the native side said, then to a plain sentence", () => {
    expect(
      dataExportErrorText({ code: "nobody-knows", args: [], text: "as said" }),
    ).toBe("as said");
    expect(dataExportErrorText(new Error("boom"))).toBe("boom");
    expect(dataExportErrorText(null)).toContain("could not");
  });
});

describe("how big the file is", () => {
  it("reads in the units a person reads sizes in", () => {
    expect(exportSize(512)).toBe("512 bytes");
    expect(exportSize(4096)).toBe("4 kB");
    expect(exportSize(5_452_595)).toBe("5.2 MB");
  });
});
