import { describe, expect, it } from "vitest";
import {
  cellKey,
  livingNames,
  withName,
  MAX_NAME,
  MAX_NAMES,
} from "./cellNames";

const KEY = cellKey("KFWS", "A1");

describe("naming a storm", () => {
  it("keeps the name against the identity the algorithm gave", () => {
    const named = withName(new Map(), KEY, "The one over the lake");
    expect(named.get(KEY)).toBe("The one over the lake");
    // A different radar's A1 is a different storm.
    expect(named.get(cellKey("KDYX", "A1"))).toBeUndefined();
  });

  it("takes a name back when it is cleared", () => {
    const named = withName(new Map([[KEY, "Big one"]]), KEY, "   ");
    expect(named.has(KEY)).toBe(false);
  });

  it("holds a name to a length and a set to a size", () => {
    const long = withName(new Map(), KEY, "x".repeat(MAX_NAME + 20));
    expect(long.get(KEY)?.length).toBe(MAX_NAME);

    let names = new Map<string, string>();
    for (let at = 0; at <= MAX_NAMES; at += 1) {
      names = withName(names, cellKey("KFWS", `A${at}`), `storm ${at}`);
    }
    expect(names.size).toBe(MAX_NAMES);
    // The oldest went, because somebody naming a thirteenth storm meant to.
    expect(names.has(cellKey("KFWS", "A0"))).toBe(false);
    expect(names.has(cellKey("KFWS", `A${MAX_NAMES}`))).toBe(true);
  });

  it("takes a line break out rather than letting one into a label", () => {
    const named = withName(new Map(), KEY, "over\nthe lake");
    expect(named.get(KEY)).toBe("over the lake");
  });
});

describe("when the algorithm stops tracking it", () => {
  it("lets the name go with the storm", () => {
    const names = new Map([
      [cellKey("KFWS", "A1"), "The big one"],
      [cellKey("KFWS", "B2"), "The other one"],
    ]);
    const alive = livingNames(names, "KFWS", ["A1"]);
    // Identifiers are reused. A name left behind would land on a different
    // storm entirely, which is worse than losing the name.
    expect(alive.get(cellKey("KFWS", "A1"))).toBe("The big one");
    expect(alive.has(cellKey("KFWS", "B2"))).toBe(false);
  });

  it("keeps a name the radar in question knows nothing about", () => {
    // Following a storm across the boundary between two sites changes which
    // one is tuned, and this used to delete every name over about six miles
    // of panning. A name is judged by the report of the radar that gave the
    // storm its identifier, and by nothing else.
    const names = new Map([[cellKey("KFWS", "A1"), "The big one"]]);
    expect(livingNames(names, "KDYX", ["B2"]).size).toBe(1);
    // And a poll that failed says nothing about which storms are tracked.
    // Treating it as "none of them" was a timeout deleting the lot.
    expect(livingNames(names, null, []).size).toBe(1);
    // The site's own report still decides its own names.
    expect(livingNames(names, "KFWS", ["B2"]).size).toBe(0);
  });
});
