import { describe, expect, it } from "vitest";
import { code, declarationsIn, findDead } from "./unused-exports-lib.mjs";

/**
 * The gate that catches an export whose last caller went away.
 *
 * It had never been watched failing, which matters more here than in most
 * gates: the rule is a word search over stripped text, and every way it can
 * quietly stop finding anything looks exactly like a clean tree. A pattern
 * that no longer matches a declaration reports nothing wrong. So does a
 * stripper that swallows the file it was reading.
 */

const isTest = (path) => /\.test\.[tj]sx?$/.test(path);

describe("what counts as an export", () => {
  it("reads the four shapes this codebase writes them in", () => {
    const found = declarationsIn(
      "a.ts",
      [
        "export function named() {}",
        "export async function later() {}",
        "export function* walk() {}",
        "export const HELD = 1;",
        "export let moved = 2;",
        "export class Thing {}",
        "export type Shape = string;",
        "export interface Held { a: string }",
      ].join("\n"),
    );
    expect(found.map((one) => one.name)).toEqual([
      "named",
      "later",
      "walk",
      "HELD",
      "moved",
      "Thing",
      "Shape",
      "Held",
    ]);
  });

  it("reads every file whole, whatever it read before", () => {
    // The scan runs the same four expressions over every file in the tree,
    // and the one way it can go wrong that nobody would notice is reading
    // part of a file: a gate that has stopped finding things reports that
    // every export is named by something. This holds the property rather than
    // any one way of breaking it.
    const long = [
      "export const A = 1;",
      "// ".padEnd(400, "x"),
      "export const B = 2;",
    ].join("\n");
    expect(declarationsIn("long.ts", long).map((one) => one.name)).toEqual([
      "A",
      "B",
    ]);
    // Again, and then a different file, both read from the top.
    expect(declarationsIn("long.ts", long).map((one) => one.name)).toEqual([
      "A",
      "B",
    ]);
    expect(
      declarationsIn("short.ts", "export const C = 3;\n").map(
        (one) => one.name,
      ),
    ).toEqual(["C"]);
  });

  it("does not read an export that is not at the start of a line", () => {
    // The patterns are anchored, which is what keeps the word "export" inside
    // a sentence or a string out of the count.
    const found = declarationsIn(
      "a.ts",
      [
        'const note = "we export function nothing here";',
        "  export const x = 1;",
      ].join("\n"),
    );
    expect(found).toEqual([]);
  });
});

describe("stripping a file down to its code", () => {
  it("takes a line comment out, so a word in prose is not a caller", () => {
    // `Appearance` is an export and also the English for a settings heading;
    // `Flash` is a type and also half of "Flash Flood Warning". Each was
    // permanently unreportable while comments counted as uses.
    expect(code("const a = 1; // Appearance is nice\n")).not.toContain(
      "Appearance",
    );
    expect(code("const a = 1; // keep\nconst b = 2;\n")).toContain("const b");
  });

  it("leaves a URL alone, which is what the leading group is for", () => {
    const kept = code('const at = "https://example.com/tiles";\n');
    expect(kept).toContain("https://example.com/tiles");
  });

  it("leaves a block comment in, on purpose", () => {
    // A route glob such as `"http://cached.localhost/**"` opens what looks
    // like one and it runs to the next real close, which took thirty-two
    // thousand characters of live code out of the scan. A symbol named only
    // inside a block comment is a false negative; a symbol hidden by one is a
    // false positive that fails the build.
    const source = "/* Alive is mentioned here */\nconst x = 1;\n";
    expect(code(source)).toContain("Alive");
  });
});

describe("which exports are reported", () => {
  it("reports one nothing anywhere names", () => {
    const said = new Map([
      ["a.ts", "export function gone() {}\n"],
      ["b.ts", "const other = 1;\n"],
    ]);
    const found = findDead({
      declared: [{ path: "a.ts", name: "gone" }],
      said,
      isTest,
    });
    expect(found.dead).toEqual([{ path: "a.ts", name: "gone" }]);
  });

  it("does not report one its own file still calls", () => {
    // The larger of the two groups this deliberately says nothing about. A
    // rule extracted so a test can drive the real thing is exported for that
    // reason and used at home.
    const said = new Map([
      ["a.ts", "export function used() {}\nconst at = used();\n"],
      ["b.ts", "const other = 1;\n"],
    ]);
    const found = findDead({
      declared: [{ path: "a.ts", name: "used" }],
      said,
      isTest,
    });
    expect(found.dead).toEqual([]);
    expect(found.fileLocal).toBe(1);
    expect(found.testOnly).toBe(0);
  });

  it("counts one only a test names, and does not report it", () => {
    // The other group. Removing these exports would put the rules back inside
    // the components and leave the tests asserting models of them.
    const said = new Map([
      ["a.ts", "export function checked() {}\n"],
      ["a.test.ts", "import { checked } from './a';\nchecked();\n"],
    ]);
    const found = findDead({
      declared: [{ path: "a.ts", name: "checked" }],
      said,
      isTest,
    });
    expect(found.dead).toEqual([]);
    expect(found.testOnly).toBe(1);
    expect(found.fileLocal).toBe(0);
  });

  it("counts a real caller as a real caller even when a test names it too", () => {
    const said = new Map([
      ["a.ts", "export function shipped() {}\n"],
      ["b.ts", "shipped();\n"],
      ["a.test.ts", "shipped();\n"],
    ]);
    const found = findDead({
      declared: [{ path: "a.ts", name: "shipped" }],
      said,
      isTest,
    });
    expect(found.dead).toEqual([]);
    expect(found.testOnly).toBe(0);
  });

  it("matches whole words, so a longer name is not a caller", () => {
    // `read` and `readAll` are two symbols. A substring search would call the
    // second one a use of the first and hide it for ever.
    const said = new Map([
      ["a.ts", "export function read() {}\n"],
      ["b.ts", "readAll();\nunread();\n"],
    ]);
    const found = findDead({
      declared: [{ path: "a.ts", name: "read" }],
      said,
      isTest,
    });
    expect(found.dead).toEqual([{ path: "a.ts", name: "read" }]);
  });

  it("follows a re-export, because naming the word is what counts", () => {
    const said = new Map([
      ["a.ts", "export function passed() {}\n"],
      ["index.ts", "export { passed } from './a';\n"],
    ]);
    const found = findDead({
      declared: [{ path: "a.ts", name: "passed" }],
      said,
      isTest,
    });
    expect(found.dead).toEqual([]);
  });
});
