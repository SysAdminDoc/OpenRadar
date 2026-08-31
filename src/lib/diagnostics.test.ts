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

  it("leaves a version number alone, wherever it is", () => {
    // A version is shaped exactly like a coordinate, and log lines carry them:
    // the updater names versions, a user agent has several. Blurring every
    // signed decimal turned Chrome/140.0.7339.16 into Chrome/140.0.7.16 and
    // build 1.0.7339 into build 1.0.7, which still reads like a version and
    // is not one.
    expect(blurCoordinates("update to 1.0.7339 failed")).toBe(
      "update to 1.0.7339 failed",
    );
    expect(
      blurCoordinates("Mozilla/5.0 Chrome/140.0.7339.16 Safari/537.36"),
    ).toBe("Mozilla/5.0 Chrome/140.0.7339.16 Safari/537.36");
    // Nothing outside a degree of latitude or longitude is a position either.
    expect(blurCoordinates("read 1048576.25 bytes")).toBe(
      "read 1048576.25 bytes",
    );
    // And a real position still goes.
    expect(blurCoordinates("at 41.7123, -93.7456")).toBe("at 41.7, -93.7");
  });

  it("does not say who the reader is, however the path is written", () => {
    // Four ways a profile path names somebody that the first pass missed.
    expect(blurUserPaths("open D:\\Profiles\\matthew\\radar.pal")).toBe(
      "open <home>\\radar.pal",
    );
    expect(
      blurUserPaths("read \\\\fileserver\\users\\matthew.p\\NWSREF.pal"),
    ).toBe("read <home>\\NWSREF.pal");
    expect(blurUserPaths("fetch https://matthew@example.com/x failed")).toBe(
      "fetch https://<user>@example.com/x failed",
    );
    expect(blurUserPaths("open C:\\Users\\MATTHE~1\\radar.pal")).toBe(
      "open <home>\\radar.pal",
    );
    // A name with a space in it. Stopping at the space left the surname
    // behind, and a surname on its own still names somebody.
    expect(blurUserPaths("open C:\\Users\\John Smith\\radar.pal")).toBe(
      "open <home>\\radar.pal",
    );
    expect(blurUserPaths("read /Users/john smith/Library/a.pal")).toBe(
      "read <home>/Library/a.pal",
    );
    expect(blurUserPaths("read \\\\server\\Users\\John Smith\\a.pal")).toBe(
      "read <home>\\a.pal",
    );
  });

  it("redacts what a source failed with, not only the log", () => {
    // A failure message is whatever the service said, and a request URL
    // carries the position it was asking about.
    const block = diagnosticsBlock({
      renderer: null,
      mapReady: true,
      radarReady: true,
      activeSource: null,
      health: [
        {
          id: "mrms",
          lastSuccess: null,
          lastFailure: Date.UTC(2026, 7, 30, 12),
          lastError:
            "GET https://api.weather.gov/points/41.74561,-93.71234 failed (500)",
          consecutiveFailures: 2,
          frameCount: 0,
        },
      ],
      log: [],
    });
    expect(block).toContain("41.7,-93.7");
    expect(block).not.toContain("41.74561");
    expect(block).not.toContain("-93.71234");
    // And the status code survives, which is the useful half.
    expect(block).toContain("(500)");
  });

  it("leaves a line with nothing to hide alone", () => {
    const line = "MRMS answered with 20 frames";
    expect(redact(line)).toBe(line);
  });

  it("writes down where each drawn layer came from", () => {
    const fetchedAt = Date.parse("2026-08-31T12:01:00Z");
    const block = diagnosticsBlock({
      renderer: "test",
      mapReady: true,
      radarReady: true,
      activeSource: "MRMS",
      health: [],
      log: [],
      now: fetchedAt,
      layers: [
        {
          sourceId: "hrrr",
          label: "HRRR",
          attribution: "Iowa State Mesonet",
          kind: "forecast",
          observedAt: null,
          validAt: Date.parse("2026-08-31T13:00:00Z"),
          fetchedAt,
          freshForMs: null,
          cachedAgeSeconds: null,
          modelRun: {
            initUtc: "2026-08-31T12:00:00Z",
            leadMinutes: 60,
          },
        },
      ],
    });
    expect(block).toContain("Layers:");
    expect(block).toContain("HRRR (hrrr) · forecast");
    // The distinction a bug report about "wrong radar" usually turns on.
    expect(block).toContain("observed none");
    expect(block).toContain("run 2026-08-31T12:00:00Z +60 min");
  });

  it("says nothing about layers when none are drawn", () => {
    const block = diagnosticsBlock({
      renderer: "test",
      mapReady: true,
      radarReady: false,
      activeSource: null,
      health: [],
      log: [],
      layers: [],
    });
    expect(block).not.toContain("Layers:");
  });
});
