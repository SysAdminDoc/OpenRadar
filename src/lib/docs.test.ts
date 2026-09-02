import { readFileSync } from "node:fs";
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
