import { describe, expect, it } from "vitest";
import {
  MAX_LOOP_FRAMES,
  frameLimit,
  mrmsProvider,
  thinFrames,
  tileUrl,
} from "./mrms";
import { covers } from "./types";

describe("MRMS tiles", () => {
  it("builds a tile template the map can substitute into", () => {
    expect(tileUrl("http://mrms.localhost/", "composite", 1788083202)).toBe(
      "http://mrms.localhost/composite/1788083202/{z}/{x}/{y}.png",
    );
    // The scheme is spelled differently away from Windows, and the template
    // has to follow whatever Tauri hands over.
    expect(tileUrl("mrms://localhost/", "mesh", 1)).toBe(
      "mrms://localhost/mesh/1/{z}/{x}/{y}.png",
    );
  });

  it("asks for one frame per two minutes of loop, within reason", () => {
    expect(frameLimit(120)).toBe(60);
    expect(frameLimit(60)).toBe(30);
    // Never so few that there is nothing to animate, never more than an hour.
    expect(frameLimit(2)).toBe(5);
    expect(frameLimit(600)).toBe(60);
  });
});

describe("MRMS coverage", () => {
  it("claims the published CONUS domain and nothing outside it", () => {
    expect(covers(mrmsProvider, -93.7, 41.7)).toBe(true);
    expect(covers(mrmsProvider, -122.3, 47.6)).toBe(true);
    expect(covers(mrmsProvider, -80.2, 25.8)).toBe(true);
    // Alaska, Hawaii, and Europe are published as separate domains or not at
    // all, so the composite must not claim them.
    expect(covers(mrmsProvider, -149.9, 61.2)).toBe(false);
    expect(covers(mrmsProvider, -157.8, 21.3)).toBe(false);
    expect(covers(mrmsProvider, 2.35, 48.85)).toBe(false);
  });

  it("leads with a national grid rather than a mosaic of pictures", () => {
    expect(mrmsProvider.id).toBe("mrms");
    // Tiles are drawn on this machine, so there is no public service to spare.
    expect(mrmsProvider.tileBudgetLimit).toBeGreaterThan(10_000);
    expect(mrmsProvider.discoveryBudgetLimit).toBeLessThan(100);
  });
});

describe("thinning a long loop", () => {
  const frames = Array.from({ length: 60 }, (_, index) => index);

  it("keeps the newest frame whatever the step works out to", () => {
    for (const most of [1, 3, 7, 20, 59]) {
      expect(thinFrames(frames, most).at(-1)).toBe(59);
    }
  });

  it("never returns more than it was asked for", () => {
    for (const most of [1, 3, 7, 20, 59]) {
      expect(thinFrames(frames, most).length).toBeLessThanOrEqual(most);
    }
  });

  it("still spans the window rather than taking the newest few", () => {
    const kept = thinFrames(frames, MAX_LOOP_FRAMES);
    // Twenty frames out of sixty is one every six minutes across two hours.
    expect(kept.length).toBe(20);
    expect(kept[0]).toBe(2);
    expect(kept[1] - kept[0]).toBe(3);
    expect(kept).toEqual([...kept].sort((left, right) => left - right));
  });

  it("leaves a loop that already fits alone", () => {
    const short = [1, 2, 3];
    expect(thinFrames(short, 20)).toBe(short);
    expect(thinFrames([], 20)).toEqual([]);
  });
});
