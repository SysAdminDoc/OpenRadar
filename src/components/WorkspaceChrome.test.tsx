import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceChrome } from "./WorkspaceChrome";
import { DEFAULT_SETTINGS } from "../lib/settings";
import { formatDistance, setUnits } from "../lib/units";
import type { RadarTimelineState } from "../hooks/useRadarTimeline";

/**
 * The strip over the map is mounted for the life of the window, so a switch to
 * metric has to reach it with nothing else prompting a redraw. Every end-to-end
 * route to this goes through a settings change, which re-renders the whole
 * workspace and would pass whether or not the component listens. Calling the
 * setter directly is the only way to tell the difference.
 */
const timeline: RadarTimelineState = {
  frames: [],
  frameIndex: 0,
  playing: false,
  source: null,
  sourceLabel: null,
  attribution: null,
  error: null,
  cached: false,
  newestObserved: undefined,
  setPlaying: vi.fn(),
  selectFrame: vi.fn(),
};

function chrome(distanceMiles: number) {
  return (
    <WorkspaceChrome
      settings={DEFAULT_SETTINGS}
      timeline={timeline}
      frames={[]}
      sweep={null}
      mrmsLayers={[]}
      lightning={null}
      wind={null}
      windReduced={false}
      clock={Date.UTC(2026, 7, 30, 12)}
      radarAgeMinutes={null}
      cursor={null}
      activeTool="range"
      // Written when it is asked for rather than when the click happened,
      // which is the only way a measurement can change units in place.
      toolResult={() => formatDistance(distanceMiles)}
      activeSurface={null}
      productOpen={false}
      dualPane={false}
      toasts={[]}
      onClearTools={vi.fn()}
      onToggleProduct={vi.fn()}
      onSurface={vi.fn()}
      onTool={vi.fn()}
      onLocate={vi.fn()}
      onDualPane={vi.fn()}
      onProjection={vi.fn()}
      onPreset={vi.fn()}
      onShare={vi.fn()}
      onZoomIn={vi.fn()}
      onZoomOut={vi.fn()}
      onResetNorth={vi.fn()}
      onDismissToast={vi.fn()}
    />
  );
}

afterEach(() => {
  cleanup();
  setUnits("imperial");
});

describe("the strip over the map", () => {
  it("redraws a measurement when the units change under it", () => {
    render(chrome(113));
    expect(screen.getByText("113 mi")).toBeTruthy();

    act(() => setUnits("metric"));
    expect(screen.getByText("182 km")).toBeTruthy();
    expect(screen.queryByText("113 mi")).toBeNull();
  });
});
