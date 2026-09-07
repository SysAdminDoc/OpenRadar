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
        // Without this the runner executes the whole file, counts its offline
        // tests, and reports a healthy number for a live block that never ran.
        expect(contract.liveBlock, contract.id).toBeTruthy();
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

  // A renamed live block would silently match nothing, and the run would go on
  // reporting that the provider had been asked.
  it("names a live block that is actually in the file", () => {
    for (const contract of LIVE_CONTRACTS) {
      if (contract.kind !== "browser") continue;
      const source = contract.files
        .map((file) => fs.readFileSync(path.join(root, file), "utf8"))
        .join("\n");
      expect(source, contract.id).toContain(`"${contract.liveBlock}"`);
    }
  });

  // Same trap on the native side: a module renamed out from under a filter
  // makes cargo run nothing and exit cleanly.
  it("points at native modules that exist", () => {
    for (const contract of LIVE_CONTRACTS) {
      if (contract.kind !== "native") continue;
      const module = contract.filter.split("::")[0];
      // A module is one file or a directory of them. The single-site radar
      // became the second on 2026-09-05 and this gate would have gone on
      // passing while checking a path nothing writes to.
      const at = path.join(root, "src-tauri", "src", module);
      expect(
        fs.existsSync(`${at}.rs`) || fs.existsSync(path.join(at, "mod.rs")),
        contract.filter,
      ).toBe(true);
    }
  });

  /**
   * Where a cargo test filter lands in the source tree, or why it lands
   * nowhere.
   *
   * Null when the whole path resolves. A string when it does not, naming the
   * file that was being read and the segment it does not declare, because
   * "the filter is wrong" without those two is a morning of grep.
   */
  function resolveFilter(filter) {
    const [module, ...rest] = filter.split("::").filter(Boolean);
    const at = path.join(root, "src-tauri", "src", module);
    let file = fs.existsSync(`${at}.rs`) ? `${at}.rs` : path.join(at, "mod.rs");
    let dir = path.dirname(file);
    if (!fs.existsSync(file)) return `there is no ${module} module`;
    for (const segment of rest) {
      const text = fs.readFileSync(file, "utf8");
      if (!new RegExp(`\\b(mod|fn)\\s+${segment}\\b`).test(text)) {
        return `${path.relative(root, file)} declares no ${segment}`;
      }
      // Where the next segment is read. A module can name its own file with
      // `#[path]`, which every test module under `level2` does, and missing
      // that rejected a filter naming a test that genuinely exists: the walk
      // stayed in `decode.rs` and never looked at `decode_tests.rs`.
      const declared = new RegExp(
        `#\\[path\\s*=\\s*"([^"]+)"\\]\\s*(?:pub(?:\\([^)]*\\))?\\s+)?mod\\s+${segment}\\b`,
      ).exec(text);
      const candidates = [
        declared ? path.join(dir, declared[1]) : null,
        path.join(dir, `${segment}.rs`),
        path.join(dir, segment, "mod.rs"),
      ].filter(Boolean);
      // No file at all means an inline `mod`, or the test at the end of the
      // path, and either way the next segment is read where we are.
      const found = candidates.find((each) => fs.existsSync(each));
      if (found) {
        file = found;
        dir = path.dirname(found);
      }
    }
    return null;
  }

  it("resolves a filter the way cargo reads it", () => {
    // The two that broke, and the shapes around them. `level2::tests` is what
    // the contract carried for two days after the module split while matching
    // nothing; the deep one below it is a test that genuinely exists and that
    // an earlier version of this walk rejected, because every test module
    // under `level2` is declared `#[path = "..._tests.rs"]`.
    expect(resolveFilter("level2::")).toBeNull();
    expect(resolveFilter("mrms::tests")).toBeNull();
    expect(resolveFilter("chunks::tests")).toBeNull();
    expect(
      resolveFilter(
        "tdwr::tests::every_site_in_the_table_is_one_the_office_still_lists",
      ),
    ).toBeNull();
    expect(
      resolveFilter(
        "level2::decode::tests::unfolding_a_live_velocity_sweep_takes_the_folds_out",
      ),
    ).toBeNull();

    expect(resolveFilter("level2::tests")).toMatch(/declares no tests/);
    expect(resolveFilter("level2::nope")).toMatch(/declares no nope/);
    expect(resolveFilter("chunks::tests::no_such_test_name")).toMatch(
      /declares no no_such_test_name/,
    );
    expect(resolveFilter("nosuchmodule::tests")).toMatch(/no nosuchmodule/);
  });

  it("names a native path that cargo can actually match tests against", () => {
    // The check above resolves only the first segment of the filter, which is
    // why it went on passing after 2026-09-05: `level2` was still a module,
    // `level2::tests` had become `level2::decode::tests` and four siblings,
    // and the contract matched nothing. It ran zero tests, reported itself
    // skipped, and because a skipped required contract exits non-zero the
    // only thing anyone saw was a red run with nothing failing in it.
    for (const contract of LIVE_CONTRACTS) {
      if (contract.kind !== "native") continue;
      const module = contract.filter.split("::").filter(Boolean)[0];
      const at = path.join(root, "src-tauri", "src", module);
      expect(
        resolveFilter(contract.filter),
        `${contract.filter} names a path cargo will match nothing against`,
      ).toBeNull();

      // And the path has to reach an ignored test, or the contract asks the
      // network for nothing however well it resolves.
      const under = fs.existsSync(`${at}.rs`)
        ? [`${at}.rs`]
        : fs
            .readdirSync(at)
            .filter((name) => name.endsWith(".rs"))
            .map((name) => path.join(at, name));
      expect(
        under.some((each) =>
          fs.readFileSync(each, "utf8").includes("#[ignore"),
        ),
        `${contract.filter} reaches no ignored test`,
      ).toBe(true);
    }
  });

  // A skip is a filter too, and a filter that matches nothing fails the same
  // quiet way: it does not error, it just stops skipping. The level2 contract
  // sweeps a whole module and has to hold back two ignored tests under it that
  // ask no provider anything, one of which fetches 42 volumes. If either name
  // goes stale the live gate silently grows a ten-minute leg.
  it("skips by names that are really there", () => {
    for (const contract of LIVE_CONTRACTS) {
      if (contract.skip === undefined) continue;
      expect(Array.isArray(contract.skip), contract.id).toBe(true);

      const module = contract.filter.split("::").filter(Boolean)[0];
      const at = path.join(root, "src-tauri", "src", module);
      const under = fs.existsSync(`${at}.rs`)
        ? [`${at}.rs`]
        : fs
            .readdirSync(at)
            .filter((name) => name.endsWith(".rs"))
            .map((name) => path.join(at, name));
      const bodies = under.map((each) => fs.readFileSync(each, "utf8"));

      for (const name of contract.skip) {
        expect(name.length, contract.id).toBeGreaterThan(0);
        expect(
          bodies.some((body) => new RegExp(`fn ${name}`).test(body)),
          `${contract.id} skips ${name}, which names no test under ${module}`,
        ).toBe(true);
      }
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
      cargoRanCount(
        "test result: ok. 6 passed; 0 failed; 12 ignored; 0 measured",
      ),
    ).toBe(6);
    expect(
      cargoRanCount(
        "test result: ok. 6 passed; 0 failed; 12 ignored\ntest result: ok. 2 passed; 0 failed; 0 ignored",
      ),
    ).toBe(8);
    expect(
      cargoRanCount("test result: ok. 0 passed; 0 failed; 18 ignored"),
    ).toBe(0);
  });
});

describe("what the run is worth", () => {
  const result = (overrides) => ({
    id: "x",
    status: "pass",
    required: false,
    ...overrides,
  });

  it("fails when a required contract failed, and not for an optional one", () => {
    expect(exitCodeFor([result({ status: "fail", required: true })])).toBe(1);
    expect(exitCodeFor([result({ status: "fail", required: false })])).toBe(0);
  });

  // The quiet hole. A required source that was never actually asked, because
  // cargo was missing or a filter stopped matching, used to exit zero and read
  // exactly like a healthy run.
  it("fails when a required contract was skipped rather than proved", () => {
    expect(exitCodeFor([result({ status: "skip", required: true })])).toBe(1);
  });

  it("does not fail for an optional contract that was skipped", () => {
    expect(
      exitCodeFor([
        result({ status: "skip", required: false }),
        result({ status: "pass", required: true }),
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
