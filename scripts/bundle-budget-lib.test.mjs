import { describe, expect, it } from "vitest";
import {
  budgetTable,
  firstLoadFailure,
  kilobytes,
  measureChunks,
  measureStatic,
} from "./bundle-budget-lib.mjs";

/**
 * The gate that stops a chunk growing a few kilobytes at a time.
 *
 * It had never been watched failing. A straight-line script that reads `dist/`
 * and exits cannot be, and this is the gate that has already caught a settings
 * chunk over budget, so a comparison written `>=` where it should be `>` would
 * have passed for ever. Everything below hands it files that are not on the
 * disc and checks which way each comparison falls.
 */

const budgets = [
  { name: "main", match: /^main-.*\.js$/, raw: 100, gzip: 30 },
  {
    name: "map worker",
    match: /^worker-.*\.js$/,
    raw: 50,
    gzip: 20,
  },
  {
    name: "panels",
    match: /^panels-.*\.js$/,
    raw: 40,
    gzip: 10,
    firstLoad: false,
  },
];

const files = ["main-abc.js", "worker-def.js", "panels-ghi.js"];

/** Sizes in bytes, so the arithmetic under test does the rounding. */
function sizes(over = {}) {
  const raw = {
    "main-abc.js": 100 * 1024,
    "worker-def.js": 50 * 1024,
    "panels-ghi.js": 40 * 1024,
    ...over,
  };
  return (file) => raw[file];
}

function gzips(over = {}) {
  const packed = {
    "main-abc.js": 30 * 1024,
    "worker-def.js": 20 * 1024,
    "panels-ghi.js": 10 * 1024,
    ...over,
  };
  return (file) => packed[file];
}

describe("what the bundle gate lets through", () => {
  it("passes a chunk sitting exactly on its budget", () => {
    // The boundary is the whole question: the app has shipped with a chunk on
    // both its numbers, and a gate that failed there would fail on a change
    // that made nothing bigger.
    const found = measureChunks({
      files,
      budgets,
      sizeOf: sizes(),
      gzipOf: gzips(),
    });
    expect(found.failures).toEqual([]);
    expect(found.rows.map((row) => row.name)).toEqual([
      "main",
      "map worker",
      "panels",
    ]);
  });

  it("fails a chunk a kilobyte over, on either measure", () => {
    const fat = measureChunks({
      files,
      budgets,
      sizeOf: sizes({ "main-abc.js": 101 * 1024 }),
      gzipOf: gzips(),
    });
    expect(fat.failures).toEqual(["main is 101 kB, over its 100 kB budget."]);

    const packed = measureChunks({
      files,
      budgets,
      sizeOf: sizes(),
      gzipOf: gzips({ "panels-ghi.js": 11 * 1024 }),
    });
    expect(packed.failures).toEqual([
      "panels is 11 kB gzipped, over its 10 kB budget.",
    ]);
  });

  it("refuses to measure nothing when a chunk is renamed or split", () => {
    // The failure mode a gate quietly dies of. A budget that matches no file
    // used to be worth nothing, and a budget matching two is a chunk that has
    // split behind the gate's back.
    const renamed = measureChunks({
      files: ["bundle-abc.js", "worker-def.js", "panels-ghi.js"],
      budgets,
      sizeOf: sizes(),
      gzipOf: gzips(),
    });
    expect(renamed.failures[0]).toContain("found 0");
    expect(renamed.rows.map((row) => row.name)).not.toContain("main");

    const split = measureChunks({
      files: [...files, "main-xyz.js"],
      budgets,
      sizeOf: sizes({ "main-xyz.js": 1024 }),
      gzipOf: gzips({ "main-xyz.js": 512 }),
    });
    expect(split.failures[0]).toContain("found 2");
  });

  it("counts the cold open out of the chunks that are actually fetched", () => {
    // `firstLoad: false` is what keeps a panel behind a `lazy` out of it. The
    // worker is in, because the map asks for it on the way to its first frame.
    const found = measureChunks({
      files,
      budgets,
      sizeOf: sizes(),
      gzipOf: gzips(),
    });
    expect(found.firstLoadGzip).toBe(50);
    expect(firstLoadFailure(50, 50)).toBeNull();
    expect(firstLoadFailure(51, 50)).toContain("over its 50 kB budget");
  });
});

describe("the files the pages name out of the public folder", () => {
  const read = (name) => {
    if (name === "favicon.png") return Buffer.alloc(10 * 1024);
    if (name === "icon.png") return Buffer.alloc(14 * 1024);
    throw new Error(`no ${name}`);
  };
  const gzipOf = (_name, bytes) => bytes.length;

  it("adds them to the first load rather than leaving them unmeasured", () => {
    const still = measureStatic({
      names: ["favicon.png", "icon.png"],
      read,
      gzipOf,
      rawKb: 30,
      gzipKb: 30,
    });
    expect(still.failures).toEqual([]);
    expect(still.row.raw).toBe(24);
    expect(still.row.gzip).toBe(24);
  });

  it("fails when one of them is renamed out of the build", () => {
    // A page declares these by name, so a missing one is a broken page and
    // not an asset to skip.
    const still = measureStatic({
      names: ["favicon.png", "gone.png"],
      read,
      gzipOf,
      rawKb: 30,
      gzipKb: 30,
    });
    expect(still.failures[0]).toContain("gone.png");
    expect(still.failures[0]).toContain("not in the build");
  });

  it("holds them to a raw budget as well, because a PNG is already deflated", () => {
    const still = measureStatic({
      names: ["favicon.png", "icon.png"],
      read,
      gzipOf,
      rawKb: 20,
      gzipKb: 30,
    });
    expect(still.failures).toEqual([
      "the static assets are 24 kB, over their 20 kB budget.",
    ]);
  });
});

describe("the table the gate prints", () => {
  it("puts every chunk and the cold open in it", () => {
    const found = measureChunks({
      files,
      budgets,
      sizeOf: sizes(),
      gzipOf: gzips(),
    });
    const lines = budgetTable(found.rows, found.firstLoadGzip, 60);
    expect(lines[0]).toContain("chunk");
    expect(lines).toHaveLength(budgets.length + 2);
    expect(lines.at(-1)).toContain("first load");
    expect(lines.at(-1)).toContain("60 kB");
  });
});

describe("kilobytes", () => {
  it("rounds rather than truncating, which is what a budget is written in", () => {
    expect(kilobytes(0)).toBe(0);
    expect(kilobytes(1024)).toBe(1);
    // 1.5 kB reads as 2, not 1: a gate that rounded down would let half a
    // kilobyte through on every chunk.
    expect(kilobytes(1536)).toBe(2);
    expect(kilobytes(1535)).toBe(1);
  });
});
