import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const REPO = join(ROOT, "..");

/**
 * Everything the app could write a class name into: its own source, and the
 * two HTML shells, which carry a handful of classes no component renders.
 */
function writtenText(): string {
  const parts: string[] = [];
  const walk = (from: string) => {
    for (const entry of readdirSync(from)) {
      const path = join(from, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.(tsx?|html)$/.test(entry)) continue;
      parts.push(readFileSync(path, "utf8"));
    }
  };
  walk(ROOT);
  for (const shell of ["index.html", "glance.html"]) {
    try {
      parts.push(readFileSync(join(REPO, shell), "utf8"));
    } catch {
      // A shell that is not there cannot be styled either way.
    }
  }
  return parts.join("\n");
}

/**
 * Classes the stylesheet is right to name even though this app never writes
 * one: MapLibre renders its own controls, and their markup is the library's.
 */
const NOT_OURS = /^maplibregl-/;

describe("the stylesheet styles things that exist", () => {
  it("names no class the app never writes", () => {
    // Dead rules are not free. They are read as live during a redesign, they
    // are carried through every refactor of the thing they appear to style,
    // and they ship. Three of them survived long enough to be audited: a
    // camera chip, a link row and an accent card, none of which had been
    // rendered in a long time.
    const css = readFileSync(join(ROOT, "index.css"), "utf8").replace(
      // A class named inside a comment is prose, not a selector.
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    const named = new Set<string>();
    for (const found of css.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) {
      named.add(found[1]);
    }
    expect(named.size).toBeGreaterThan(100);

    const source = writtenText();
    const orphans = [...named]
      .filter((name) => !NOT_OURS.test(name))
      // Substring rather than a word match on purpose: a name is often built
      // by template, as `command-group--${kind}`, and the stem is the part
      // that proves the rule is reachable.
      .filter((name) => !source.includes(name))
      .sort();
    expect(orphans).toEqual([]);
  });
});
