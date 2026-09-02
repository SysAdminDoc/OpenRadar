import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { calmAdvice, SPECULATIVE_LAYERS } from "./calm";
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

/** The calm block, on its own, so what it reaches can be read. */
function calmRules(): string {
  return CSS.split("\n")
    .filter((line) => line.includes("[data-calm]"))
    .join("\n");
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
    expect(rules.length).toBeGreaterThan(0);
    for (const forbidden of [
      "--ramp",
      "--severity",
      "--hazard",
      "--warning",
      "alert-row i",
      "legend",
      "maplibre",
      "canvas",
    ]) {
      expect(rules, forbidden).not.toContain(forbidden);
    }
  });

  it("does not reach the map at all", () => {
    // The map draws itself from the sources and the colour tables, and this
    // mode has no business in either. Everything it does is in the stylesheet
    // and in one extra sentence in the alerts panel.
    const source = readFileSync(join(import.meta.dirname, "calm.ts"), "utf8");
    for (const reach of [
      "setPaintProperty",
      "setLayoutProperty",
      "addLayer",
      "getCanvas",
      "#",
      "rgb",
    ]) {
      expect(source, reach).not.toContain(reach);
    }
  });

  it("says what to do rather than how bad it could be", () => {
    // Written by hand for each kind. A sentence assembled from parts reads
    // like an app talking, and this is the one place where the wording is the
    // point.
    for (const kind of [
      "tornado",
      "thunderstorm",
      "flood",
      "winter",
      "tropical",
      "heat",
      "fire",
      "anything else",
    ]) {
      const said = calmAdvice(kind);
      expect(said.length, kind).toBeGreaterThan(20);
      // No superlatives and no damage wording: that is the office's job, in
      // the headline this line sits under.
      for (const word of [
        "catastrophic",
        "deadly",
        "destroy",
        "life-threatening",
        "devastating",
      ]) {
        expect(said.toLowerCase(), `${kind} says "${word}"`).not.toContain(
          word,
        );
      }
    }
    // Each kind gets its own words rather than one line for everything.
    const all = new Set(
      ["tornado", "flood", "heat", "fire"].map((kind) => calmAdvice(kind)),
    );
    expect(all.size).toBe(4);
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

  it("puts speculation away rather than deleting it", () => {
    // A forecast probability is the part that keeps somebody awake and also
    // the part they may want to check, so it is a default rather than a rule.
    expect(SPECULATIVE_LAYERS).toContain("probSevere");
    const panel = readFileSync(
      join(import.meta.dirname, "..", "panels", "MapOptionsPanels.tsx"),
      "utf8",
    );
    // The switch is still there in the layers panel: nothing about this mode
    // removes a control.
    expect(panel).toContain("probSevere: false");
    // And the layers panel knows nothing about this mode: the switch is
    // where it always was, and turning the mode off does not put the layer
    // back on either, because that was the reader's choice by then.
    expect(panel.slice(panel.indexOf("LAYER_ROWS"))).not.toContain("calm");
  });
});
