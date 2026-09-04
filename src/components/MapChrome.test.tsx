import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
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

describe("a container that carries a name", () => {
  it("carries a role to hang it on", () => {
    // `aria-label` on a plain `div` is dropped: the element has no role, so
    // there is nothing for a name to be the name of. Every segmented control
    // in Settings had one, and a screen reader announced "Flat, pressed"
    // with no "Projection" anywhere near it. `axe`'s own rules do not catch
    // this, because the markup is not invalid, only useless.
    const roots = ["src/components", "src/panels"];
    const offenders: string[] = [];
    for (const root of roots) {
      for (const name of readdirSync(join(process.cwd(), root))) {
        if (!name.endsWith(".tsx") || name.includes(".test.")) continue;
        const file = join(process.cwd(), root, name);
        const source = readFileSync(file, "utf8");
        // Each opening tag on its own, so a role on a sibling cannot cover
        // for a name on this one.
        // `section` is left out on purpose: a named one is implicitly a
        // region, which is a role for its name to hang on.
        for (const tag of source.matchAll(/<(div|span|li)\b[^>]*>/gs)) {
          const text = tag[0];
          if (!text.includes("aria-label")) continue;
          if (/\brole=/.test(text)) continue;
          // A name on a hidden element is decoration, not a label.
          if (text.includes('aria-hidden="true"')) continue;
          const line = source.slice(0, tag.index).split("\n").length;
          offenders.push(`${root}/${name}:${line}`);
        }
      }
    }
    expect(
      offenders,
      `${offenders.join(", ")} names a container with no role to hang it on`,
    ).toEqual([]);
  });
});
