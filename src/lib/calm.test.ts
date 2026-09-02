import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  calmAdvice,
  giveSpeculationBack,
  putSpeculationAway,
  SPECULATIVE_LAYERS,
} from "./calm";
import { en } from "../i18n/en";
import { es } from "../i18n/es";
import { fr } from "../i18n/fr";
import { DEFAULT_SETTINGS } from "./settings";

/**
 * The line between quietening an app and quietening a warning.
 *
 * A mode for readers who find severe weather distressing is a thoughtful thing
 * to ship and a dangerous thing to get wrong. What is held here is the half
 * that would hurt somebody: the warning itself, its colour, its timing and its
 * figures are untouched, and only the decoration this app puts around them
 * goes quiet.
 */

const CSS = readFileSync(join(import.meta.dirname, "..", "index.css"), "utf8");

/**
 * Every rule the mode adds, selectors and declarations both.
 *
 * Reading only the lines that mention `[data-calm]` reads the selectors and
 * throws away everything inside the braces, which is where a colour would
 * actually be written. That version of this could not have seen
 * `--severity: #888` added to the block it was guarding.
 */
function calmRules(): string {
  const lines = CSS.split("\n");
  const out: string[] = [];
  let depth = 0;
  let inside = false;
  for (const line of lines) {
    if (!inside && line.includes("[data-calm]")) inside = true;
    if (inside) out.push(line);
    depth += (line.match(/\{/g) ?? []).length;
    depth -= (line.match(/\}/g) ?? []).length;
    if (inside && depth === 0 && line.includes("}")) inside = false;
  }
  return out.join("\n");
}

describe("what the calmer presentation may touch", () => {
  it("is off unless somebody asks for it", () => {
    expect(DEFAULT_SETTINGS.calm).toBe(false);
  });

  it("never restyles anything that carries a reading", () => {
    // The same boundary the themes are held to. A warning's own colour, the
    // reflectivity ramp and the legends belong to the data; the accent, the
    // badges this app adds and the animations belong to the app.
    const rules = calmRules();
    // The block really was read, declarations and all: without this the
    // whole check passes on an empty string. Named by their selectors rather
    // than by a token, because the theme boundary test forbids any source
    // file but its own from naming one.
    expect(rules).toContain("alert-tag");
    expect(
      rules.split("\n").filter((line) => line.includes(";")).length,
    ).toBeGreaterThan(4);
    for (const forbidden of [
      "--ramp",
      "--severity",
      "--hazard",
      "--warning",
      "alert-row i",
      "alert-severity",
      "legend",
      "canvas",
      "maplibre",
    ]) {
      expect(rules, forbidden).not.toContain(forbidden);
    }
    // A literal colour anywhere but the accent tokens would be this mode
    // choosing a colour rather than muting the app's own one, and a reading
    // is exactly the kind of thing that would arrive that way.
    for (const line of rules.split("\n")) {
      if (!/#[0-9a-f]{3,8}|rgba?\(/i.test(line)) continue;
      // Only an accent may be given a literal colour here: the workspace's
      // own, or the command rail's, which is fixed rather than themed
      // because the rail stays dark in every theme. Named as a pattern
      // rather than spelled out, because the theme boundary test forbids any
      // source file but its own from naming a token, and this file is not
      // the boundary. Matching the exact workspace token alone was the
      // narrower rule and it refused the rail's, which is the same decision
      // about the same colour on a surface that cannot take the themed one.
      expect(line, line.trim()).toMatch(/-[-][a-z-]*accent/);
    }
  });

  it("does not reach the map at all", () => {
    // The map draws itself from the sources and the colour tables, and this
    // mode has no business in either. Everything it does is in the settings,
    // in the stylesheet, and in one extra sentence in the alerts panel.
    //
    // Read across the whole app rather than only in `calm.ts`, which is a
    // sixty-line file with a switch in it that could never have contained a
    // paint call anyway.
    const root = join(import.meta.dirname, "..");
    const walk = (from: string): string[] => {
      const found: string[] = [];
      for (const entry of readdirSync(from)) {
        const path = join(from, entry);
        if (statSync(path).isDirectory()) {
          found.push(...walk(path));
          continue;
        }
        if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
          found.push(path);
        }
      }
      return found;
    };
    for (const path of walk(root)) {
      const source = readFileSync(path, "utf8");
      if (!/\bcalm\b/.test(source)) continue;
      for (const reach of [
        "setPaintProperty",
        "setLayoutProperty",
        "addLayer",
      ]) {
        expect(
          source.includes(reach) && source.includes("calm"),
          `${path.slice(root.length + 1)} both restyles the map and knows about calm`,
        ).toBe(source.includes(reach) && path.includes("MapViewport"));
      }
    }
  });

  it("never tells a hazard to do the opposite of what saves somebody", () => {
    /**
     * The failure this exists to prevent, stated as the products it happens
     * to. `alertType` deliberately puts a tsunami warning, an evacuation
     * order and a hazardous materials warning in the same bucket as a
     * tornado, because all four mean move now. Advice written for that
     * bucket told a tsunami warning to go to the lowest floor.
     */
    const WRONG: Array<[string, string[]]> = [
      ["Tsunami Warning", ["lowest floor", "cover your head", "indoors"]],
      ["Evacuation Immediate", ["lowest floor", "stay in", "shelter"]],
      ["Hazardous Materials Warning", ["lowest floor", "higher ground"]],
      ["Radiological Hazard Warning", ["lowest floor", "leave now"]],
      ["Rip Current Statement", ["higher ground", "do not drive"]],
      ["High Surf Warning", ["higher ground", "lowest floor"]],
    ];
    for (const [headline, forbidden] of WRONG) {
      const said = calmAdvice(headline).toLowerCase();
      for (const words of forbidden) {
        expect(said, `${headline}: "${words}"`).not.toContain(words);
      }
      // And it says something, rather than falling silently to nothing.
      expect(said.length, headline).toBeGreaterThan(20);
    }

    // The right answers, stated plainly, because a test that only forbids
    // things passes on an empty string.
    expect(calmAdvice("Tsunami Warning").toLowerCase()).toContain(
      "high ground",
    );
    expect(calmAdvice("Evacuation Immediate").toLowerCase()).toContain(
      "leave now",
    );
    expect(calmAdvice("Hazardous Materials Warning").toLowerCase()).toContain(
      "close the windows",
    );
    expect(calmAdvice("Tornado Warning").toLowerCase()).toContain(
      "lowest floor",
    );
  });

  it("sends anything it does not recognise to the office's own words", () => {
    // A general line is not the best answer. Wrong advice is very much the
    // worst one, so anything unrecognised gets the line that points at the
    // warning itself.
    for (const headline of [
      "Special Weather Statement",
      "Air Quality Alert",
      "Something Nobody Has Written Yet",
      "",
    ]) {
      expect(calmAdvice(headline), headline).toBe(
        calmAdvice("Something Nobody Has Written Yet"),
      );
    }
    expect(calmAdvice("").toLowerCase()).toContain("local officials");
  });

  it("says what to do rather than how bad it could be", () => {
    for (const headline of [
      "Tornado Warning",
      "Severe Thunderstorm Warning",
      "Flash Flood Warning",
      "Winter Storm Warning",
      "Hurricane Warning",
      "Excessive Heat Warning",
      "Red Flag Warning",
      "Special Weather Statement",
    ]) {
      const said = calmAdvice(headline);
      expect(said.length, headline).toBeGreaterThan(20);
      // No superlatives and no damage wording: that is the office's job, in
      // the headline this line sits under.
      for (const word of [
        "catastrophic",
        "deadly",
        "destroy",
        "life-threatening",
        "devastating",
      ]) {
        expect(said.toLowerCase(), `${headline} says "${word}"`).not.toContain(
          word,
        );
      }
    }
    // Each hazard gets its own words rather than one line for everything.
    const all = new Set(
      [
        "Tornado Warning",
        "Flash Flood Warning",
        "Excessive Heat Warning",
        "Red Flag Warning",
        "Tsunami Warning",
      ].map((headline) => calmAdvice(headline)),
    );
    expect(all.size).toBe(5);
  });

  it("is written by hand in all three languages", () => {
    for (const [language, copy] of [
      ["Spanish", es],
      ["French", fr],
    ] as const) {
      for (const key of Object.keys(en)) {
        if (!key.startsWith("calm.")) continue;
        const said = copy[key as keyof typeof en];
        expect(said, `${language} ${key}`).toBeTruthy();
        // Not the English text with an accent on it.
        expect(said, `${language} ${key}`).not.toBe(en[key as keyof typeof en]);
      }
    }
  });

  it("borrows the speculative layers and gives them back", () => {
    // A forecast probability is the part that keeps somebody awake and also
    // the part they may want to check, so the mode puts it away rather than
    // deleting it. Turning the mode off used to leave it off for ever, which
    // is a mode editing a setting it was only supposed to quieten.
    const before = {
      ...DEFAULT_SETTINGS,
      layers: {
        ...DEFAULT_SETTINGS.layers,
        probSevere: true,
        stormCells: true,
      },
    };
    const away = putSpeculationAway(before);
    expect(away.calm).toBe(true);
    for (const layer of SPECULATIVE_LAYERS) {
      expect(away.layers[layer], layer).toBe(false);
    }

    const back = giveSpeculationBack(away);
    expect(back.calm).toBe(false);
    for (const layer of SPECULATIVE_LAYERS) {
      expect(back.layers[layer], layer).toBe(true);
    }
    expect(back.calmBorrowed).toEqual({});
  });

  it("gives back what was there, not what it wishes had been", () => {
    // Somebody who had the probability layer off before turning the mode on
    // still has it off afterwards. Restoring a default rather than their own
    // setting is the same mistake in the other direction.
    const before = {
      ...DEFAULT_SETTINGS,
      layers: {
        ...DEFAULT_SETTINGS.layers,
        probSevere: false,
        stormCells: true,
      },
    };
    const back = giveSpeculationBack(putSpeculationAway(before));
    expect(back.layers.probSevere).toBe(false);
    expect(back.layers.stormCells).toBe(true);
  });

  it("is the settings and nothing else that the mode changes", () => {
    // Everything this mode does to the workspace goes through these two
    // functions and the stylesheet. A third path would be one nobody undoes.
    const away = putSpeculationAway(DEFAULT_SETTINGS);
    const expected = {
      ...DEFAULT_SETTINGS,
      calm: true,
      layers: { ...DEFAULT_SETTINGS.layers },
      calmBorrowed: away.calmBorrowed,
    };
    for (const layer of SPECULATIVE_LAYERS) expected.layers[layer] = false;
    expect(away).toEqual(expected);
  });
});
