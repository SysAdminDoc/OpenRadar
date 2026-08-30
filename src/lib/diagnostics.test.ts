import { describe, expect, it } from "vitest";
import {
  blurCoordinates,
  blurUserPaths,
  diagnosticsBlock,
  redact,
} from "./diagnostics";

describe("the diagnostics block somebody pastes into a bug report", () => {
  it("does not say where the reader is", () => {
    // The workspace logs positions to four decimals, which is about ten
    // metres. A bug report is a public thing.
    expect(blurCoordinates("centre 41.7123, -93.7456 zoom 9")).toBe(
      "centre 41.7, -93.7 zoom 9",
    );
    expect(blurCoordinates("watch at -33.86882,151.20929")).toBe(
      "watch at -33.9,151.2",
    );
    // A version number, a count and a duration are not coordinates.
    expect(blurCoordinates("OpenRadar 0.2.0 took 1.5 s over 12 frames")).toBe(
      "OpenRadar 0.2.0 took 1.5 s over 12 frames",
    );
  });

  it("does not say who the reader is", () => {
    // Every profile path on every platform carries the account name.
    expect(
      blurUserPaths("failed to open C:\\Users\\matthew\\AppData\\cache\\a.png"),
    ).toBe("failed to open <home>\\AppData\\cache\\a.png");
    expect(blurUserPaths("read /Users/matthew/Library/Caches/a.png")).toBe(
      "read <home>/Library/Caches/a.png",
    );
    expect(blurUserPaths("read /home/matthew/.cache/a.png")).toBe(
      "read <home>/.cache/a.png",
    );
  });

  it("takes both out of every line of the block", () => {
    const block = diagnosticsBlock({
      renderer: "ANGLE (NVIDIA)",
      mapReady: true,
      radarReady: true,
      activeSource: "mrms",
      platform: "Windows",
      // A user agent carries version numbers shaped exactly like coordinates,
      // and blurring them makes the one field saying what the reader is
      // running useless.
      webview: "Chrome/140.0.7339.16",
      health: [
        {
          id: "mrms",
          lastSuccess: Date.UTC(2026, 7, 30, 12),
          lastFailure: null,
          lastError: null,
          consecutiveFailures: 0,
          frameCount: 20,
        },
      ],
      log: [
        {
          at: Date.UTC(2026, 7, 30, 12, 1),
          level: "warn",
          scope: "radar",
          message:
            "no tile for 41.7123,-93.7456 from C:\\Users\\matthew\\AppData\\Local\\tiles",
        },
      ],
    });

    expect(block).toContain("OpenRadar");
    expect(block).toContain("ANGLE (NVIDIA)");
    expect(block).toContain("mrms");
    // And nothing that identifies the reader or their address.
    expect(block).not.toContain("matthew");
    expect(block).not.toContain("41.7123");
    expect(block).not.toContain("-93.7456");
    expect(block).toContain("41.7,-93.7");
    expect(block).toContain("<home>");
    // And the version it was told about survives intact.
    expect(block).toContain("Chrome/140.0.7339.16");
    // So does the timestamp, whose milliseconds are shaped like a coordinate
    // and were being rounded away with them.
    expect(block).toContain("2026-08-30T12:01:00.000Z");
  });

  it("leaves a line with nothing to hide alone", () => {
    const line = "MRMS answered with 20 frames";
    expect(redact(line)).toBe(line);
  });
});
