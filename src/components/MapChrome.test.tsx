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
