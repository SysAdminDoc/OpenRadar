import { describe, expect, it } from "vitest";
import {
  animationIntervalMs,
  parseRadarFrames,
  radarTileTemplate,
} from "./radar";

describe("radar discovery", () => {
  it("normalizes, deduplicates, and sorts trusted frames", () => {
    const frames = parseRadarFrames({
      host: "https://tilecache.rainviewer.com",
      radar: {
        past: [
          { time: 200, path: "/v2/radar/200" },
          { time: 100, path: "/v2/radar/100" },
          { time: 200, path: "/v2/radar/200" },
          { time: "300", path: "/v2/radar/300" },
        ],
      },
    });

    expect(frames.map((frame) => frame.time)).toEqual([100, 200]);
    expect(radarTileTemplate(frames[0])).toBe(
      "https://tilecache.rainviewer.com/v2/radar/100/512/{z}/{x}/{y}/2/1_1.png",
    );
  });

  it("rejects untrusted hosts and malformed paths", () => {
    expect(
      parseRadarFrames({
        host: "https://rainviewer.com.example.net",
        radar: { past: [{ time: 100, path: "/v2/radar/100" }] },
      }),
    ).toEqual([]);
    expect(
      parseRadarFrames({
        host: "https://tilecache.rainviewer.com",
        radar: { past: [{ time: 100, path: "https://example.net/tile" }] },
      }),
    ).toEqual([]);
  });

  it("maps the observed speed range to bounded frame timing", () => {
    expect(animationIntervalMs(-0.8)).toBe(1800);
    expect(animationIntervalMs(0.5)).toBe(350);
    expect(animationIntervalMs(10)).toBe(350);
  });
});
