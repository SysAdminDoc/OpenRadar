import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RadarTimeline } from "./MapChrome";
import type { RadarFrame } from "../lib/radar";

afterEach(cleanup);

const frame: RadarFrame = {
  providerId: "ridge",
  time: Date.parse("2026-08-30T18:00:00Z") / 1000,
  tileUrl: "https://example.test/{z}/{x}/{y}.png",
  tileSize: 256,
  maxZoom: 10,
  attribution: "Test radar",
};

describe("the radar timeline slider", () => {
  it("names the timestamp represented by its numeric value", () => {
    render(
      <RadarTimeline
        frames={[frame]}
        frameIndex={0}
        playing={false}
        error={null}
        sourceLabel="Test radar"
        ageMinutes={0}
        onFrameIndex={vi.fn()}
        onPlaying={vi.fn()}
      />,
    );

    const slider = screen.getByRole("slider", { name: "Radar frame" });
    const visibleTime = document.querySelector(
      ".timeline-copy strong",
    )?.textContent;
    expect(slider.getAttribute("aria-valuetext")).toBe(visibleTime);
  });

  it("returns to the newest frame from the playback band", () => {
    const onFrameIndex = vi.fn();
    render(
      <RadarTimeline
        frames={[frame, { ...frame, time: frame.time + 300 }]}
        frameIndex={0}
        playing={false}
        error={null}
        sourceLabel="Test radar"
        ageMinutes={0}
        onFrameIndex={onFrameIndex}
        onPlaying={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Go live" }));
    expect(onFrameIndex).toHaveBeenCalledWith(1);
  });
});

/** Every component file under a directory, tests and stories left out. */
function tsxUnder(from: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(from)) {
    const path = join(from, name);
    if (statSync(path).isDirectory()) {
      found.push(...tsxUnder(path));
      continue;
    }
    if (!name.endsWith(".tsx") || name.includes(".test.")) continue;
    found.push(path);
  }
  return found;
}

function allIndexesOf(source: string, pattern: RegExp): number[] {
  return [...source.matchAll(pattern)].map((found) => found.index);
}

/**
 * The whole of one opening JSX tag, from `<` to the `>` that closes it.
 *
 * Reading to the first `>` is wrong and quietly so: an arrow function in a
 * prop ends the tag early, so `<div onClick={() => go()} aria-label="X">`
 * looked like a tag with no name on it and the gate passed over a real
 * offender. Braces are counted, and a `>` inside one is not the end.
 */
function openingTagAt(source: string, at: number): string {
  let depth = 0;
  let quote: string | null = null;
  let comment: "line" | "block" | null = null;
  for (let step = at; step < source.length; step += 1) {
    const character = source[step];
    const next = source[step + 1];

    // Comments first. A prop can hold a whole arrow function body, and this
    // codebase writes comments with apostrophes in them, so treating a
    // possessive as an opening quote swallowed the rest of the tag and the
    // element after it, which is how a real offender could hide behind the
    // next element's role.
    if (comment === "line") {
      if (character === "\n") comment = null;
      continue;
    }
    if (comment === "block") {
      if (character === "*" && next === "/") {
        step += 1;
        comment = null;
      }
      continue;
    }

    if (quote) {
      // An escaped quote does not close the string.
      if (character === "\\") {
        step += 1;
        continue;
      }
      if (character === quote) quote = null;
      continue;
    }

    if (character === "/" && next === "/" && depth > 0) {
      comment = "line";
      step += 1;
      continue;
    }
    if (character === "/" && next === "*" && depth > 0) {
      comment = "block";
      step += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    // Never below zero: a stray closing brace used to leave the scan unable
    // to recognise its own tag end for the rest of the file.
    else if (character === "}") depth = Math.max(0, depth - 1);
    else if (character === ">" && depth === 0)
      return source.slice(at, step + 1);
  }
  return source.slice(at);
}

describe("the gate that reads the markup", () => {
  // A gate nobody has tried to fool is a gate nobody has tested. Each of
  // these was a real hole: the first two let an unnamed container through
  // because the scan ended at a > inside a prop, and the third read the rest
  // of the file as one string because of an apostrophe in a comment.
  const cases: [string, string][] = [
    ["an arrow function", '<div onClick={() => go()} aria-label="X">'],
    ["a comparison", '<div hidden={n > 2} aria-label="X">'],
    [
      "a possessive in a comment",
      '<div onClick={() => {\n  // it\'s the way out\n  go();\n}} aria-label="X">',
    ],
    ["a quote in a string", '<div title={"a > b"} aria-label="X">'],
    ["an escaped quote", '<div title="say \\"hi\\"" aria-label="X">'],
    ["a template", '<div className={`a-${kind}`} aria-label="X">'],
    ["a stray closing brace", '<div title={"}"} aria-label="X">'],
  ];

  for (const [name, markup] of cases) {
    it(`reads a whole tag past ${name}`, () => {
      const read = openingTagAt(markup, 0);
      expect(read).toBe(markup);
      // And the gate's own question gets the right answer: named, no role.
      expect(read.includes("aria-label")).toBe(true);
      expect(/\brole=/.test(read)).toBe(false);
    });
  }

  it("does not run past the tag into the element after it", () => {
    // The shape that hid a real offender: the scan swallowed this tag, the
    // close, and the span after it, then found that span's role and passed.
    const markup =
      '<div onClick={() => {\n  // it\'s fine\n}} aria-label="X">\n</div>\n<span role="img" aria-label="ok">x</span>';
    expect(openingTagAt(markup, 0)).not.toContain("role=");
  });
});

describe("a container that carries a name", () => {
  it("carries a role to hang it on", () => {
    // `aria-label` on a plain `div` is dropped: the element has no role, so
    // there is nothing for a name to be the name of. Every segmented control
    // in Settings had one, and a screen reader announced "Flat, pressed"
    // with no "Projection" anywhere near it. `axe`'s own rules do not catch
    // this, because the markup is not invalid, only useless.
    const offenders: string[] = [];
    for (const file of tsxUnder(join(process.cwd(), "src"))) {
      const source = readFileSync(file, "utf8");
      // `section` is left out on purpose: a named one is implicitly a
      // region, which is a role for its name to hang on.
      for (const at of allIndexesOf(source, /<(div|span|li)\b/g)) {
        const text = openingTagAt(source, at);
        if (!text.includes("aria-label")) continue;
        if (/\brole=/.test(text)) continue;
        // A name on a hidden element is decoration, not a label.
        if (text.includes('aria-hidden="true"')) continue;
        const line = source.slice(0, at).split("\n").length;
        offenders.push(`${relative(process.cwd(), file)}:${line}`);
      }
    }
    expect(
      offenders,
      `${offenders.join(", ")} names a container with no role to hang it on`,
    ).toEqual([]);
  });
});

describe("a slider says what it is showing", () => {
  it("carries the reading beside it, not the number behind the thumb", () => {
    // A range input announces its `value`. Every one of these has an
    // `<output>` next to it holding the reading a person sees, and the two
    // are rarely the same thing: the opacity slider showed 70% and announced
    // 0.7, the loop showed "90 minutes" and announced 90, and the pack
    // ceiling showed "4 GB" and announced 4096. Only the timeline had
    // `aria-valuetext`.
    const offenders: string[] = [];
    for (const file of tsxUnder(join(process.cwd(), "src"))) {
      const source = readFileSync(file, "utf8");
      for (const at of allIndexesOf(source, /type="range"/g)) {
        // The whole element, from its own `<input` back through to the `>`
        // that closes the opening tag.
        const start = source.lastIndexOf("<input", at);
        const tag = openingTagAt(source, start);
        if (tag.includes("aria-valuetext")) continue;
        const line = source.slice(0, at).split("\n").length;
        offenders.push(`${relative(process.cwd(), file)}:${line}`);
      }
    }
    expect(offenders, `${offenders.join(", ")} announces a raw value`).toEqual(
      [],
    );
  });
});
