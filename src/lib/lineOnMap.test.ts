import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  casingFor,
  inkFor,
  lightness,
  MAP_INK,
  MAP_INK_HALO,
  parseColor,
} from "./lineOnMap";
import { isLightBasemap } from "./mapStyles";
import {
  MAP_GROUND_DARK,
  MAP_GROUND_LIGHT,
  MAP_STYLE_OPTIONS,
} from "./mapStyles";

describe("reading a colour the browser handed back", () => {
  it("takes the forms a stylesheet resolves to", () => {
    expect(parseColor("#fff")).toEqual({ red: 255, green: 255, blue: 255 });
    expect(parseColor("#0b1220")).toEqual({ red: 11, green: 18, blue: 32 });
    expect(parseColor("rgb(148, 163, 184)")).toEqual({
      red: 148,
      green: 163,
      blue: 184,
    });
    // The alpha is dropped on purpose: a casing is chosen from the hue, and a
    // translucent line over an unknown ground has no settled lightness.
    expect(parseColor("rgba(219, 230, 247, 0.66)")).toEqual({
      red: 219,
      green: 230,
      blue: 247,
    });
  });

  it("answers nothing rather than a wrong colour", () => {
    for (const bad of [
      "",
      "transparent",
      "color-mix(in oklab, red, blue)",
      "rgb(1, 2)",
    ]) {
      expect(parseColor(bad), bad).toBeNull();
      expect(lightness(bad), bad).toBeNull();
    }
  });
});

describe("the stroke that goes underneath", () => {
  it("is dark under a light line and light under a dark one", () => {
    // The defect this exists for: a near-white line at full opacity over the
    // light basemap composites to about one to one, so somebody turns the
    // accessibility preference on and the lines vanish.
    expect(casingFor("#f8fafc")).toContain("9, 12, 18");
    expect(casingFor("rgba(219, 230, 247, 0.66)")).toContain("9, 12, 18");
    expect(casingFor("#0b1220")).toContain("255, 255, 255");
    expect(casingFor("#475569")).toContain("255, 255, 255");
  });

  it("guesses dark for a colour it cannot read", () => {
    // Every basemap the app offers is lighter than black and most are much
    // lighter, so the dark casing is the safer guess.
    expect(casingFor("color-mix(in oklab, red, blue)")).toContain("9, 12, 18");
  });

  it("orders the greys the way an eye does", () => {
    const white = lightness("#ffffff");
    const grey = lightness("#94a3b8");
    const black = lightness("#000000");
    expect(white).toBe(1);
    expect(black).toBe(0);
    expect(grey).toBeGreaterThan(0);
    expect(grey).toBeLessThan(1);
  });
});

describe("which basemaps draw the ground light", () => {
  it("has an answer for every style the app offers", () => {
    // Not a hand list that a new style can be added beside. Every option in
    // the picker is asked, so a style with no answer takes the default and
    // that default is stated here rather than discovered on a map.
    for (const style of MAP_STYLE_OPTIONS) {
      expect(typeof isLightBasemap(style.id), style.id).toBe("boolean");
    }
    expect(isLightBasemap("pro-light")).toBe(true);
    expect(isLightBasemap("grayscale")).toBe(true);
    expect(isLightBasemap("pro-dark")).toBe(false);
    // Photographs of land are mid-toned, and a light line reads on them where
    // a dark one disappears into shadow.
    expect(isLightBasemap("aerial")).toBe(false);
  });
});

describe("a mark drawn straight onto the basemap", () => {
  /**
   * The ratio between two colours, as the contrast guidelines define it.
   *
   * Three to one is the line for something that is not text: a cell ring, a
   * dashed track, a dot. Below it the mark is there and cannot be found.
   */
  const contrast = (one: string, other: string) => {
    const first = lightness(one);
    const second = lightness(other);
    if (first === null || second === null) {
      throw new Error(`${one} or ${other} is not a colour`);
    }
    const high = Math.max(first, second);
    const low = Math.min(first, second);
    return (high + 0.05) / (low + 0.05);
  };

  it("reads on the ground it is drawn over, in both lightnesses", () => {
    // Every role, rather than the one the defect was found in: they are all
    // marks on the same two grounds, and a table is only worth having if
    // adding a row to it is covered the day it is added.
    for (const [role, pair] of Object.entries(MAP_INK)) {
      expect(
        contrast(pair.light, MAP_GROUND_LIGHT),
        `${role} over the light ground`,
      ).toBeGreaterThanOrEqual(3);
      expect(
        contrast(pair.dark, MAP_GROUND_DARK),
        `${role} over the dark ground`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("measures the near-whites that shipped as unreadable over the light one", () => {
    // The defect, in the colours it was written in, so the measurement above
    // is known to be able to say no. Written out rather than read from the
    // table: what the app should use next is not this test's business, only
    // that it can tell the two apart.
    for (const was of ["#f8fafc", "#e2e8f0", "#eff6ff", "#f87171"]) {
      expect(contrast(was, MAP_GROUND_LIGHT), was).toBeLessThan(3);
    }
  });

  it("puts a cell's name against the opposite of its own ink", () => {
    // The label is text and takes the higher line. Its halo is what it is
    // read against, because the ground under a name is whatever the weather
    // put there.
    expect(
      contrast(MAP_INK.cell.light, MAP_INK_HALO.light),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(MAP_INK.cell.dark, MAP_INK_HALO.dark),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("hands the light ink to a light basemap and the dark one otherwise", () => {
    for (const role of Object.keys(MAP_INK) as Array<keyof typeof MAP_INK>) {
      expect(inkFor(role, true), role).toBe(MAP_INK[role].light);
      expect(inkFor(role, false), role).toBe(MAP_INK[role].dark);
    }
  });
});

describe("a ramp whose colour is the value", () => {
  /**
   * The two ramps `MAP_INK` could not fix, written out as the map draws them.
   *
   * A ramp cannot take that table's answer, which is to give a mark the
   * lightness the ground is not: here the colour is what the value means. So
   * they get a casing instead, and what has to be measured is the casing
   * against the ground rather than the ramp against it.
   */
  const PROBSEVERE_STOPS = ["#fde68a", "#fb923c", "#dc2626"];
  const ROUTE_STOPS = ["#94a3b8", "#4ade80", "#facc15", "#fb923c", "#f43f5e"];

  const contrast = (first: string, second: string) => {
    const one = lightness(first);
    const other = lightness(second);
    if (one === null || other === null) return 0;
    const high = Math.max(one, other);
    const low = Math.min(one, other);
    return (high + 0.05) / (low + 0.05);
  };

  it("has stops a pale ground swallows, which is what the casing is for", () => {
    // The finding this exists for, in the colours it was found in. Without
    // this the assertion below could pass on a ramp that never needed one.
    const swallowed = [...PROBSEVERE_STOPS, ...ROUTE_STOPS].filter(
      (stop) => contrast(stop, MAP_GROUND_LIGHT) < 3,
    );
    expect(swallowed).toContain("#fde68a");
    expect(swallowed).toContain("#facc15");
    expect(swallowed).toContain("#94a3b8");
  });

  it("puts a stroke under it that the pale ground cannot swallow", () => {
    // The casing is chosen against the ground rather than against the line,
    // because a ramp has no one lightness to be the opposite of.
    const casing = casingFor(MAP_GROUND_LIGHT);
    expect(
      contrast(casing, MAP_GROUND_LIGHT),
      "the casing over the light ground",
    ).toBeGreaterThan(3);
    for (const stop of [...PROBSEVERE_STOPS, ...ROUTE_STOPS]) {
      expect(
        contrast(stop, casing),
        `${stop} over the casing`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("draws no casing over the dark ground, where none is needed", () => {
    // Every stop already reads there, and the casing that would go under it
    // is light: it would take the red end of the ProbSevere ramp from 3.7 to
    // one down to 1.2. A casing that is not needed is a casing that hurts.
    for (const stop of [...PROBSEVERE_STOPS, ...ROUTE_STOPS]) {
      expect(
        contrast(stop, MAP_GROUND_DARK),
        `${stop} over the dark ground`,
      ).toBeGreaterThanOrEqual(3);
    }
    // And the map is what decides not to draw it: the layer is there in both
    // lightnesses and its opacity is what turns it off, so the stack does not
    // change shape with the theme.
    const drawn = readFileSync(
      join(process.cwd(), "src", "components", "MapViewport.tsx"),
      "utf8",
    );
    expect(drawn).toContain('"line-opacity": overLightRef.current ? 1 : 0,');
  });
});
