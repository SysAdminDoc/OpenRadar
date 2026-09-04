import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { forgetInFlight, inFlight, runOnce } from "./inFlight";

afterEach(() => forgetInFlight());

/**
 * A function's own body, so an assertion about a call site cannot be
 * satisfied by a match somewhere else in the file. Sliced from the name to
 * the next declaration at column zero.
 */
function bodyOf(file: string, name: string): string {
  const source = readFileSync(join(import.meta.dirname, "..", file), "utf8");
  const at = source.indexOf(name);
  expect(at).toBeGreaterThan(-1);
  const rest = source.slice(at);
  const end = rest.search(/\n(export |function |const [A-Z])/);
  return end === -1 ? rest : rest.slice(0, end);
}

describe("a job that outlives the thing that started it", () => {
  it("refuses a second run while the first is going", async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const work = vi.fn(() => held);

    const first = runOnce("export", work);
    expect(inFlight("export")).toBe(true);
    // The second press, with the first still writing files.
    expect(await runOnce("export", work)).toBe(false);
    expect(work).toHaveBeenCalledTimes(1);

    release();
    expect(await first).toBe(true);
    expect(inFlight("export")).toBe(false);
    // And once it is over, the button works again.
    expect(await runOnce("export", async () => {})).toBe(true);
  });

  it("lets go when the work throws", async () => {
    await expect(
      runOnce("export", () => Promise.reject(new Error("disk full"))),
    ).rejects.toThrow("disk full");
    // A failed export that never cleared its flag would leave the button
    // dead for the rest of the session.
    expect(inFlight("export")).toBe(false);
  });

  it("keeps jobs apart by name", async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = runOnce("export", () => held);
    expect(await runOnce("save", async () => {})).toBe(true);
    release();
    await running;
  });
});

describe("the panels that can be closed mid-run use it", () => {
  // These are the three places where the guard used to be component state.
  // Settings is mounted only while its surface is open, so closing it during
  // a run reset the flag and the button came back pressable over a job that
  // was still going. A test that drives the registry directly cannot see a
  // panel going back to `useState`, so the call sites are pinned here.
  const sites: [string, string, string][] = [
    ["panels/JournalSection.tsx", "JOURNAL_EXPORT", "journal-export"],
    ["panels/RecapSection.tsx", "RECAP_SAVE", "recap-save"],
    ["panels/StorageSection.tsx", "CACHE_CLEAR", "cache-clear"],
  ];

  for (const [file, constant, job] of sites) {
    it(`${file} runs its job through the registry`, () => {
      const source = readFileSync(
        join(import.meta.dirname, "..", file),
        "utf8",
      );
      expect(source).toContain(`const ${constant} = "${job}"`);
      expect(source).toContain(`runOnce(${constant},`);
      expect(source).toContain(`useInFlight(${constant})`);
      // And no local flag standing in for it again.
      expect(source).not.toMatch(
        /useState(<boolean>)?\(false\)[\s\S]{0,40}(exporting|saving|working)/,
      );
    });
  }

  it("holds the journal export button shut from the registry", () => {
    const body = bodyOf("panels/JournalSection.tsx", "export function Journal");
    expect(body).toContain("useInFlight(JOURNAL_EXPORT)");
    expect(body).not.toContain("setExporting");
  });
});
