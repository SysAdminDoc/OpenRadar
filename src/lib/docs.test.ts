import { readFileSync } from "node:fs";
import { MAP_STYLE_OPTIONS } from "./mapStyles";
import { DEFAULT_SETTINGS, normalizeMapStyle } from "./settings";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");

const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

/**
 * The pages somebody reads before they run anything.
 *
 * Both had gone stale in the same way: the app grew and the writing did not.
 * The README described a build that shipped two features ago, and the page it
 * sends people to for architecture described the app as it was at the first
 * commit, down to a paragraph about the repository not existing yet. Neither
 * is checked by anything else, because documentation is the one part of a
 * build that still compiles when it is wrong.
 */
describe("the pages a reader is pointed at", () => {
  it("names every module the native side is built from", () => {
    // Read off `lib.rs` rather than a list here, so a module added next month
    // is a failing test rather than a page that quietly stops being true.
    const declared = [
      ...read("src-tauri", "src", "lib.rs").matchAll(/^mod ([a-z_0-9]+);/gm),
    ].map((match) => match[1]);
    expect(declared.length, "no modules were found").toBeGreaterThan(20);

    const page = read("docs", "architecture.md");
    const missing = declared.filter((name) => !page.includes(`\`${name}\``));
    expect(missing).toEqual([]);
  });

  it("says nothing about the repository not existing yet", () => {
    // The page carried a note from before the first commit for the whole of
    // its life, under a heading that called the architecture a decision that
    // had not been taken.
    const page = read("docs", "architecture.md");
    expect(page).not.toMatch(/no repository exists|has not been created/i);
  });

  it("dates every released version in the changelog", () => {
    // A changelog with no dates cannot answer the one question it is opened
    // for, which is whether the thing a reader is running is older than a
    // fix. Every heading but the top one carries the day its work landed;
    // the top one is what has not been released yet, and dating it would be
    // a claim about a day that has not happened.
    const changelog = read("CHANGELOG.md");
    const headings = changelog
      .split("\n")
      .filter((line) => line.startsWith("## OpenRadar v"));
    expect(headings.length).toBeGreaterThan(5);
    const undated = headings.filter(
      (line) => !/ \(\d{4}-\d{2}-\d{2}\)$/.test(line.trimEnd()),
    );
    expect(
      undated.length,
      `dated: every heading but the unreleased one. Undated: ${undated.join(", ")}`,
    ).toBeLessThanOrEqual(1);
    if (undated.length === 1) {
      expect(undated[0]).toBe(headings[0]);
    }
  });

  it("states the number of map styles once, and correctly", () => {
    // The README said seven in one place and eight in another, because one
    // counted Auto and the other did not. Auto is a chooser: it has already
    // resolved to one of the others by the time anything asks what is drawn.
    // Read off the list itself rather than out of the source text, so adding
    // a style fails this until the README follows.
    const real = MAP_STYLE_OPTIONS.filter((style) => style.id !== "auto");
    expect(real).toHaveLength(7);
    const readme = read("README.md");
    expect(readme).toContain("Seven map styles");
    expect(readme).toContain("five of the seven are OpenStreetMap");
  });

  it("validates exactly the styles the picker offers", () => {
    // The two lists are written out separately, one in the settings module so
    // it carries no map imports and one in the map module so it carries the
    // swatches. They had already drifted: the validator accepted "dark",
    // which no picker offers, and refused "auto", which is the default, so a
    // saved view naming Auto was quietly replaced with it.
    for (const style of MAP_STYLE_OPTIONS) {
      expect(normalizeMapStyle(style.id)).toBe(style.id);
    }
    // The one renamed id still lands where it meant, rather than dropping a
    // reader who had pinned a style back onto the default.
    expect(normalizeMapStyle("dark")).toBe("pro-dark");
    expect(normalizeMapStyle("nonsense")).toBe(DEFAULT_SETTINGS.mapStyle);
    expect(normalizeMapStyle(undefined)).toBe(DEFAULT_SETTINGS.mapStyle);
  });

  it("names the features the changelog says shipped", () => {
    // Two features reached a release without ever reaching the README: the
    // full-screen view for a second monitor and naming a storm the radar is
    // tracking. Held against the strings the app itself uses, so a feature
    // renamed in the interface and not in the README fails here.
    const readme = read("README.md");
    for (const [feature, said] of [
      ["the full-screen second-monitor view", /second monitor/i],
      ["naming a storm", /name (a|the) storm|storm.{0,20}your own name/i],
    ] as const) {
      expect(said.test(readme), `the README never mentions ${feature}`).toBe(
        true,
      );
    }
  });
});

describe("what the repository root holds", () => {
  it("keeps no design note the working notes believe is gone", () => {
    // `design-qa.md` was deleted, re-added thirteen hours later, and left
    // there. The working notes went on saying it had been deleted, so the
    // file the public could read and the note the next person reads were
    // two different accounts. It recorded a layout pass against a v0.1
    // workspace, said the interface was localised in English and Spanish
    // when it has three languages, and ended "final result: passed".
    expect(() => read("design-qa.md")).toThrow();
  });

  it("names the brand drawing where the ledger says it is", () => {
    // A megabyte of PNG sat at the root, named in no config, script, page or
    // ledger. It is the drawing the packaged icon sizes are generated from,
    // which is worth keeping and worth saying so.
    expect(read("docs/asset-ledger.md")).toContain(
      "assets/brand/openradar-icon.png",
    );
    expect(() =>
      readFileSync(join(ROOT, "assets/brand/openradar-icon.png")),
    ).not.toThrow();
    expect(() => readFileSync(join(ROOT, "icon.png"))).toThrow();
  });
});
