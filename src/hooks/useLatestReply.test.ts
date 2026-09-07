import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useLatestReply } from "./useLatestReply";

afterEach(() => cleanup());

/**
 * What the guard is for, driven the way it fails in the wild.
 *
 * Not "does a state write after unmount warn", which React 19 never does and
 * which two tests in this repo passed against a guard that had been deleted.
 * The observable thing is order: two questions asked, the answers coming back
 * the other way round, and only the newer one counting.
 */
describe("telling an older answer from the newest one", () => {
  it("counts the newest run and no other", () => {
    const { result } = renderHook(() => useLatestReply());

    const first = result.current();
    expect(first.current()).toBe(true);

    // Asking again is what makes the first answer old.
    const second = result.current();
    expect(first.current()).toBe(false);
    expect(second.current()).toBe(true);
  });

  it("stops counting a run its own cleanup has closed", () => {
    const { result } = renderHook(() => useLatestReply());
    const reply = result.current();
    expect(reply.current()).toBe(true);
    reply.close();
    expect(reply.current()).toBe(false);
  });

  it("lets a late cleanup pass without unseating the run after it", () => {
    // React sets the next effect up before some teardowns have run in
    // development. A cleanup that invalidated whatever happened to be current
    // would switch the new run off and drop the answer the reader is waiting
    // for, which is worse than the bug it is guarding.
    const { result } = renderHook(() => useLatestReply());
    const first = result.current();
    const second = result.current();
    first.close();
    expect(second.current()).toBe(true);
  });

  it("keeps its token across a re-render", () => {
    const { result, rerender } = renderHook(() => useLatestReply());
    const reply = result.current();
    rerender();
    expect(reply.current()).toBe(true);
    result.current();
    expect(reply.current()).toBe(false);
  });

  it("gives each caller a counter of its own", () => {
    // One instance shared between two effects means the second effect to
    // start invalidates whatever the first is still waiting for. That is not
    // hypothetical: converting the settings panel to a single shared token
    // stopped the wallpaper answer ever landing, because the screen-awake
    // effect beside it ran a moment later and took the generation with it.
    // One call to the hook per effect.
    const { result } = renderHook(() => ({
      first: useLatestReply(),
      second: useLatestReply(),
    }));

    const mine = result.current.first();
    result.current.second();
    expect(mine.current()).toBe(true);
  });

  it("drops the older of two answers that come back out of order", async () => {
    // The shape of both defects a refutation found on 2026-09-05: a slow
    // first read landing after a fast second one and overwriting it.
    const { result } = renderHook(() => useLatestReply());
    let wrote = "";

    const slow = result.current();
    const quick = result.current();

    await act(async () => {
      if (quick.current()) wrote = "the newer answer";
      // And now the first one finally arrives.
      if (slow.current()) wrote = "the older answer";
      await Promise.resolve();
    });

    expect(wrote).toBe("the newer answer");
  });
});

/**
 * The ninth one, caught before a refutation pass has to find it.
 *
 * Ten effects wrote this guard by hand and two more that needed it went
 * without, which is what a pattern nobody enforces looks like after a week.
 * The ones below keep their own flag for a reason, and each reason is written
 * out; the list is exact in both directions, so a file that stops needing an
 * exemption fails this as loudly as a file that starts.
 *
 * The vocabulary is the whole gate. The first cut looked for `alive`, `live`,
 * `active`, `current`, `cancelled` and `stale`, and missed `mounted`, which is
 * what half of them actually say. It shipped advertising that nobody could
 * roll their own again while being blind to the commonest spelling of exactly
 * that, and a clean run meant nothing. Add a name here before believing one.
 *
 * It then did the same thing twice: the list that replaced it called itself
 * every name this codebase had actually used, and `open` was not on it. That
 * is 30 effects across 16 files, more than every other spelling together, so
 * for a second time the gate read clean while missing the majority of what it
 * was looking for. Those 30 are correct as written, which is why they are a
 * backlog and not a bug list, and `outstanding` below names every one of them
 * so a new one cannot join them quietly. AUD-361 converts them.
 */
describe("nobody rolls their own again", () => {
  /** Why each of these is not a reply to be dropped. */
  const allowed = new Map([
    [
      "src/App.tsx",
      "holds the glance listener's own unlisten handle, which the cleanup has to release rather than ignore",
    ],
    [
      "src/hooks/useWorkspaceActions.ts",
      "the same shape for the deep-link listener",
    ],
    [
      "src/hooks/useAmbient.ts",
      "an AbortController already cancels the fetch; the flag only stops the catch reporting a cancellation as a failure",
    ],
    [
      "src/hooks/useWelcomeHint.ts",
      "the same, around the greeting's own station lookup",
    ],
    [
      "src/hooks/useAlertWatch.ts",
      "an AbortController beside it again, and the flag gates a second variable the effect carries as well",
    ],
    [
      "src/hooks/useArchiveWarnings.ts",
      "the same shape around the archive's own fetch",
    ],
    [
      "src/hooks/useRadarTimeline.ts",
      "keeps a generation per request rather than per effect run, because one run of that effect makes several, which is finer than this hook offers",
    ],
  ]);

  /**
   * The `open` guards written before this hook existed, which the gate could
   * not see until 2026-09-07. Every one of them is correct as written, so
   * converting them is AUD-361 rather than a fix. The list is exact in both
   * directions: converting a file fails this until the file leaves the list,
   * and a hand-rolled guard in a file that is not here fails it too.
   *
   * `src/App.tsx` is in both lists. The scan reads whole files, and that one
   * holds an exempt listener handle as well as four of these, so neither list
   * describes all of it on its own.
   */
  const outstanding = new Set([
    "src/App.tsx",
    "src/glance.tsx",
    "src/hooks/useClassification.ts",
    "src/hooks/useCuriosities.ts",
    "src/hooks/useLightning.ts",
    "src/hooks/useMrmsOverlays.ts",
    "src/hooks/usePalette.ts",
    "src/hooks/useProbSevere.ts",
    "src/hooks/useRadarStatus.ts",
    "src/hooks/useSingleSiteRadar.ts",
    "src/hooks/useStormCells.ts",
    "src/hooks/useWind.ts",
    "src/panels/CuriositySection.tsx",
    "src/panels/HistoryPanel.tsx",
    "src/panels/IncidentPackManager.tsx",
    "src/panels/SearchPanel.tsx",
  ]);

  it("finds no hand-rolled run flag outside the ones that are not replies", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join, relative, sep } = await import("node:path");

    const root = join(process.cwd(), "src");
    const found = new Set<string>();
    const walk = (at: string) => {
      for (const name of readdirSync(at)) {
        const path = join(at, name);
        if (statSync(path).isDirectory()) {
          walk(path);
          continue;
        }
        if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) continue;
        if (name === "useLatestReply.ts") continue;
        const text = readFileSync(path, "utf8");
        if (
          // Whitespace a formatter could take away, and every name that has
          // turned up here so far. A name missing from this list is a hole in
          // the gate rather than a file that is clean, which it has proved
          // twice: once shipping without `mounted`, once without `open`.
          /\blet\s+(alive|live|active|current|mounted|open|cancelled|canceled|stale|done|running)\s*=\s*(true|false)\b/.test(
            text,
          )
        ) {
          found.add(relative(process.cwd(), path).split(sep).join("/"));
        }
      }
    };
    walk(root);

    for (const file of found) {
      expect(
        allowed.has(file) || outstanding.has(file),
        `${file} rolls its own "is this run still current" flag. Use useLatestReply, or add it to the exemptions with the reason it is not a reply.`,
      ).toBe(true);
    }
    for (const [file, why] of allowed) {
      expect(
        found.has(file),
        `${file} is exempted for "${why}" and no longer has a flag at all. Drop it from the list.`,
      ).toBe(true);
    }
    // The backlog only shrinks. A file converted off its hand-rolled guard
    // leaves this list in the same commit, or the next reader is told there
    // is more left to do than there is.
    for (const file of outstanding) {
      expect(
        found.has(file),
        `${file} is on the AUD-361 backlog and has no hand-rolled flag left. Drop it from the list.`,
      ).toBe(true);
    }
  });
});
