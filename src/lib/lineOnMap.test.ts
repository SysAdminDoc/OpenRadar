import { describe, expect, it } from "vitest";
import { casingFor, lightness, parseColor } from "./lineOnMap";
import { isLightBasemap } from "./mapStyles";
import { MAP_STYLE_OPTIONS } from "./mapStyles";

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
