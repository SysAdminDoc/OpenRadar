import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  animationIntervalMs,
  formatFrameTime,
  frameAgeMinutes,
  framesPerSecond,
  loopSpeedLabel,
} from "./radar";
import type { RadarFrame } from "./providers/types";

const frame: RadarFrame = {
  providerId: "ridge",
  time: 1788068400,
  tileUrl: "https://example.test/tile",
  tileSize: 256,
  maxZoom: 12,
  attribution: "NOAA",
};

describe("radar timing", () => {
  it("maps the observed speed range to bounded frame timing", () => {
    expect(animationIntervalMs(-0.8)).toBe(1800);
    expect(animationIntervalMs(0.5)).toBe(350);
    expect(animationIntervalMs(10)).toBe(350);
  });

  it("reports whole minutes of age and never a negative one", () => {
    expect(frameAgeMinutes(frame, frame.time * 1000 + 8 * 60_000)).toBe(8);
    expect(frameAgeMinutes(frame, frame.time * 1000 - 60_000)).toBe(0);
  });

  it("falls back to a waiting label with no frame", () => {
    expect(formatFrameTime(undefined)).toBe("Waiting for radar");
    expect(formatFrameTime(frame)).toMatch(/\d/);
  });
});

describe("how fast the loop says it is playing", () => {
  it("rises as the slider goes right, and never reads as the slider itself", () => {
    // The panel and the settings both printed `animationSpeed`, which is a
    // position from -0.8 to 0.5, so a fresh install read "-0.1" under the
    // word Speed. Frames a second rather than the interval the slider sets,
    // because this rises as the slider is pushed forward and an interval
    // falls: a control called Speed whose number drops as it speeds up is the
    // same defect wearing a unit.
    expect(framesPerSecond(-0.8)).toBeCloseTo(1000 / 1800, 6);
    expect(framesPerSecond(0.5)).toBeCloseTo(1000 / 350, 6);
    // Monotone across the whole range, which is the property the reader reads.
    let last = 0;
    for (let at = -0.8; at <= 0.5; at += 0.05) {
      const now = framesPerSecond(at);
      expect(now, `speed at ${at.toFixed(2)}`).toBeGreaterThanOrEqual(last);
      last = now;
    }
    // Positive everywhere, including at the default, which is what the raw
    // position was not.
    expect(framesPerSecond(-0.1)).toBeGreaterThan(0);
    expect(framesPerSecond(-0.1)).toBeCloseTo(1, 1);
  });

  it("is the interval the loop actually runs on, said the other way up", () => {
    // Tied to `animationIntervalMs` rather than to figures of its own, so the
    // two cannot drift into describing different loops.
    for (const speed of [-0.8, -0.4, -0.1, 0, 0.25, 0.5]) {
      expect(framesPerSecond(speed)).toBeCloseTo(
        1000 / animationIntervalMs(speed),
        9,
      );
    }
  });
});

describe("where the loop speed reaches a reader", () => {
  it("reads differently at every stop the slider has", () => {
    // A control that announces the same thing after it moves has not moved as
    // far as a screen reader is concerned. At one decimal three of the
    // fourteen stops read "0.6/s" and two more read "0.7/s", so arrowing the
    // slow end of the slider was silent: the value changed and the text a
    // reader hears did not.
    //
    // The stops are the input's own: -0.8 to 0.5 in tenths.
    const said = new Map<string, number[]>();
    for (let step = 0; step <= 13; step += 1) {
      const speed = Number((-0.8 + step / 10).toFixed(1));
      const label = loopSpeedLabel(speed);
      said.set(label, [...(said.get(label) ?? []), speed]);
    }
    const shared = [...said.entries()].filter(([, stops]) => stops.length > 1);
    expect(
      shared.map(([label, stops]) => `${label} at ${stops.join(", ")}`),
      "two stops of the slider read the same",
    ).toEqual([]);
    expect(said.size, "the stops were not all measured").toBe(14);
  });

  it("is never the slider's own position on any surface that prints it", () => {
    // Two surfaces show this number, the radar product panel's chip and the
    // settings slider's output, and both printed the raw position until
    // 2026-09-08. The rendered case in `RadarProductPanel.test.tsx` covers
    // the first; this covers both, because the second has no panel test of
    // its own and the two are one decision that must not drift apart.
    const root = join(import.meta.dirname, "..", "panels");
    const shows = ["RadarProductPanel.tsx", "SettingsPanel.tsx"];
    for (const name of shows) {
      const source = readFileSync(join(root, name), "utf8");
      // The shape that was wrong: the position handed straight to the number
      // formatter, with nothing turning it into a rate first.
      expect(
        source,
        `${name} prints animationSpeed without converting it`,
      ).not.toMatch(/formatNumber\(\s*[\w.]*animationSpeed\s*,/);
      // And the shape that is right has to be there, or this passes on a file
      // that stopped showing the speed at all and nobody noticed.
      expect(source, `${name} no longer shows the loop speed`).toContain(
        "loopSpeedLabel(",
      );
    }
  });
});
