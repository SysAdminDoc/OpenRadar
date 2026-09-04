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
  for (let step = at; step < source.length; step += 1) {
    const character = source[step];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}") depth -= 1;
    else if (character === ">" && depth === 0) return source.slice(at, step + 1);
  }
  return source.slice(at);
}

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
