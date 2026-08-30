import { describe, expect, it } from "vitest";
import { compareVersions, isNewer } from "./updates";
import { APP_VERSION } from "./settings";

describe("version comparison", () => {
  it("compares the numbers rather than the strings", () => {
    // The bug a string comparison gives you: "0.10.0" sorts before "0.9.0".
    expect(compareVersions("0.10.0", "0.9.0")).toBe(1);
    expect(compareVersions("0.9.0", "0.10.0")).toBe(-1);
    expect(compareVersions("1.0.0", "0.99.99")).toBe(1);
    expect(compareVersions("0.2.1", "0.2.1")).toBe(0);
  });

  it("ignores a leading v, which is how the tags are written", () => {
    expect(compareVersions("v0.2.0", "0.2.0")).toBe(0);
    expect(compareVersions("v0.3.0", "v0.2.9")).toBe(1);
  });

  it("treats a missing part as zero", () => {
    expect(compareVersions("0.2", "0.2.0")).toBe(0);
    expect(compareVersions("0.2.1", "0.2")).toBe(1);
  });

  it("puts a release ahead of its own prerelease", () => {
    expect(compareVersions("0.2.0", "0.2.0-rc.1")).toBe(1);
    expect(compareVersions("0.2.0-rc.1", "0.2.0")).toBe(-1);
    expect(compareVersions("0.2.0-rc.2", "0.2.0-rc.1")).toBe(1);
  });

  it("only offers what is actually newer than this build", () => {
    expect(isNewer(APP_VERSION)).toBe(false);
    expect(isNewer("0.0.1")).toBe(false);
    expect(isNewer("99.0.0")).toBe(true);
  });
});
