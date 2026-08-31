import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  LIVE_CONTRACTS,
  cargoRanCount,
  classifyRun,
  exitCodeFor,
  refuseToRun,
  resolveCargo,
  summarize,
  vitestRanCount,
} from "./live-contracts-lib.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("the live contract list", () => {
  it("names every contract once", () => {
    const ids = LIVE_CONTRACTS.map((contract) => contract.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every contract something to run and somebody to reach", () => {
    for (const contract of LIVE_CONTRACTS) {
      expect(contract.label.length, contract.id).toBeGreaterThan(0);
      expect(contract.host, contract.id).toMatch(/\./);
      expect(["native", "browser"]).toContain(contract.kind);
      if (contract.kind === "native") {
        expect(contract.filter, contract.id).toBeTruthy();
      } else {
        expect(contract.files?.length, contract.id).toBeGreaterThan(0);
      }
    }
  });

  // A contract naming a test file that has been renamed would run nothing and
  // report a skip forever, which is the quiet failure this gate exists to
  // prevent. This holds the list to the files actually on disk.
  it("points at browser test files that exist", () => {
    for (const contract of LIVE_CONTRACTS) {
      if (contract.kind !== "browser") continue;
      for (const file of contract.files) {
        expect(fs.existsSync(path.join(root, file)), file).toBe(true);
      }
    }
  });

  // Same trap on the native side: a module renamed out from under a filter
  // makes cargo run nothing and exit cleanly.
  it("points at native modules that exist", () => {
    for (const contract of LIVE_CONTRACTS) {
      if (contract.kind !== "native") continue;
      const module = contract.filter.split("::")[0];
      const file = path.join(root, "src-tauri", "src", `${module}.rs`);
      expect(fs.existsSync(file), contract.filter).toBe(true);
    }
  });

  it("requires the sources a release actually depends on", () => {
    const required = LIVE_CONTRACTS.filter((contract) => contract.required).map(
      (contract) => contract.id,
    );
    expect(required).toContain("mrms");
    expect(required).toContain("level2");
  });
});

describe("refusing to run in the wrong place", () => {
  it("refuses on GitHub infrastructure", () => {
    expect(refuseToRun({ GITHUB_ACTIONS: "true" })).toMatch(/GitHub/);
  });

  it("refuses on any shared build infrastructure", () => {
    expect(refuseToRun({ CI: "1" })).toMatch(/shared build/);
  });

  it("runs on a machine somebody is sitting at", () => {
    expect(refuseToRun({})).toBeNull();
  });
});

describe("finding cargo", () => {
  // rustup's install location, which is not always on the PATH a spawned
  // process inherits. Calling cargo by name there fails with ENOENT on a
  // machine where the toolchain is installed and working.
  it("prefers where rustup puts it", () => {
    const found = resolveCargo(
      { USERPROFILE: "C:/Users/x" },
      (candidate) => candidate === "C:/Users/x/.cargo/bin/cargo.exe",
      "win32",
    );
    expect(found).toBe("C:/Users/x/.cargo/bin/cargo.exe");
  });

  it("honours an explicit CARGO_HOME", () => {
    const found = resolveCargo(
      { CARGO_HOME: "/opt/cargo" },
      (candidate) => candidate === "/opt/cargo/bin/cargo",
      "linux",
    );
    expect(found).toBe("/opt/cargo/bin/cargo");
  });

  it("falls back to the PATH when it is not where rustup puts it", () => {
    expect(resolveCargo({ HOME: "/home/x" }, () => false, "linux")).toBe(
      "cargo",
    );
  });
});

describe("reading what a runner did", () => {
  it("counts a clean run as a pass", () => {
    expect(classifyRun({ code: 0, timedOut: false, ranCount: 3 })).toBe("pass");
  });

  // The trap worth the most here. A runner that exits zero having run nothing
  // looks exactly like success.
  it("counts a clean run of nothing as a skip", () => {
    expect(classifyRun({ code: 0, timedOut: false, ranCount: 0 })).toBe("skip");
  });

  it("counts a non-zero exit and a timeout as failures", () => {
    expect(classifyRun({ code: 1, timedOut: false, ranCount: 3 })).toBe("fail");
    expect(classifyRun({ code: 0, timedOut: true, ranCount: 3 })).toBe("fail");
  });

  // A toolchain this machine lacks says nothing about the weather services,
  // and reporting it as a failure would put a red mark against all of them.
  it("counts a missing runner as a skip rather than a failure", () => {
    expect(
      classifyRun({
        code: 1,
        timedOut: false,
        ranCount: 0,
        missingRunner: true,
      }),
    ).toBe("skip");
  });

  it("reads how many tests vitest actually ran", () => {
    expect(vitestRanCount("  Tests  3 passed (3)")).toBe(3);
    expect(vitestRanCount("  Tests  2 passed | 1 skipped (3)")).toBe(2);
    // The failed count comes first in this form, which a naive read of the
    // line after "Tests" misses entirely and reports as a skip.
    expect(vitestRanCount("  Tests  1 failed | 6 passed (7)")).toBe(7);
    // A whole file skipped prints no Tests line.
    expect(vitestRanCount("Test Files  1 skipped (1)")).toBe(0);
  });

  // The exact shape a failing live run prints. The banner above the summary
  // also contains the word "Tests", and reading that one instead reported a
  // real provider failure as "0 ran", which classifies as a skip.
  it("reads past the failure banner to the summary line", () => {
    const output = [
      " FAIL  src/lib/guidance.test.ts",
      "",
      "⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯",
      "",
      " Test Files  1 failed (1)",
      "      Tests  1 failed | 6 passed (7)",
    ].join("\n");
    expect(vitestRanCount(output)).toBe(7);
  });

  it("reads how many tests cargo actually ran, across targets", () => {
    expect(
      cargoRanCount("test result: ok. 6 passed; 0 failed; 12 ignored; 0 measured"),
    ).toBe(6);
    expect(
      cargoRanCount(
        "test result: ok. 6 passed; 0 failed; 12 ignored\ntest result: ok. 2 passed; 0 failed; 0 ignored",
      ),
    ).toBe(8);
    expect(cargoRanCount("test result: ok. 0 passed; 0 failed; 18 ignored")).toBe(
      0,
    );
  });
});

describe("what the run is worth", () => {
  const result = (overrides) => ({
    id: "x",
    status: "pass",
    required: false,
    ...overrides,
  });

  it("fails only when a required contract failed", () => {
    expect(exitCodeFor([result({ status: "fail", required: true })])).toBe(1);
    expect(exitCodeFor([result({ status: "fail", required: false })])).toBe(0);
  });

  it("never fails for a skip, however many", () => {
    expect(
      exitCodeFor([
        result({ status: "skip", required: true }),
        result({ status: "skip", required: true }),
      ]),
    ).toBe(0);
  });

  it("summarizes into something a machine can read", () => {
    const summary = summarize(
      [
        result({ id: "a", status: "pass" }),
        result({ id: "b", status: "fail", required: true }),
        result({ id: "c", status: "skip" }),
      ],
      Date.parse("2026-08-31T12:00:00Z"),
      Date.parse("2026-08-31T12:05:00Z"),
    );
    expect(summary.counts).toEqual({ pass: 1, fail: 1, skip: 1 });
    expect(summary.startedAt).toBe("2026-08-31T12:00:00.000Z");
    expect(summary.contracts).toHaveLength(3);
    expect(() => JSON.parse(JSON.stringify(summary))).not.toThrow();
  });
});
