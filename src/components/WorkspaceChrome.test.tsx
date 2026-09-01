import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceChrome } from "./WorkspaceChrome";
import { DEFAULT_SETTINGS } from "../lib/settings";
import type { SweepImage } from "../lib/level2";
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
  cachedAgeSeconds: null,
  fetchedAt: Date.parse("2026-08-31T18:00:00Z"),
  newestObserved: undefined,
  setPlaying: vi.fn(),
  selectFrame: vi.fn(),
};

const COLLECTED = "2026-08-30T12:00:00Z";

/** A drawn sweep, live or not, for the legend to read. */
function sweepOf(live: boolean): SweepImage {
  return {
    station: "KDMX",
    siteName: "Des Moines, IA",
    productId: "reflectivity",
    paletteApplied: false,
    highContrast: false,
    dealiased: false,
    live,
    liveTilts: live ? 3 : 0,
    stormMotion: null,
    product: "Reflectivity",
    unit: "dBZ",
    elevationDegrees: 0.48,
    tilts: [0.48, 0.87],
    tiltIndex: 0,
    collected: COLLECTED,
    west: -96.5,
    south: 40,
    east: -90.5,
    north: 44,
    image: "data:image/png;base64,",
    volume: "v",
    radar: "WSR-88D",
    rangeKm: 230,
    source: {
      kind: "recent",
      label: "NOAA NEXRAD Level II",
      url: "https://registry.opendata.aws/noaa-nexrad/",
    },
  };
}

function chrome(
  distanceMiles: number,
  overrides: { sweep?: SweepImage | null; liveClock?: number } = {},
) {
  return (
    <WorkspaceChrome
      settings={DEFAULT_SETTINGS}
      timeline={timeline}
      frames={[]}
      sweep={overrides.sweep ?? null}
      mrmsLayers={[]}
      lightning={null}
      smoke={null}
      classification={null}
      forecastSmoke={null}
      wind={null}
      windReduced={false}
      announcement={{ said: 0, text: "" }}
      readout=""
      clock={Date.UTC(2026, 7, 30, 12)}
      liveClock={overrides.liveClock ?? Date.UTC(2026, 7, 30, 12)}
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

describe("the legend over a live sweep", () => {
  it("counts the seconds, not the minutes", () => {
    // The whole point of the live view is that the picture is seconds behind
    // rather than minutes. Read off the minute clock the age said nought for
    // everything collected since the last tick, and jumped a minute at a time
    // when the radar stalled.
    render(
      chrome(113, {
        sweep: sweepOf(true),
        liveClock: Date.parse(COLLECTED) + 37_000,
      }),
    );
    expect(screen.getByText(/LIVE, 37 S OLD/)).toBeTruthy();
  });

  it("says nothing about being live when the sweep is not", () => {
    render(
      chrome(113, {
        sweep: sweepOf(false),
        liveClock: Date.parse(COLLECTED) + 37_000,
      }),
    );
    expect(screen.queryByText(/LIVE/)).toBeNull();
    expect(screen.getByText(/0\.48° TILT/)).toBeTruthy();
  });
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

describe("which ramp the bar beside the map is drawn from", () => {
  /**
   * A media query that answers whatever this test wants it to. jsdom has no
   * `matchMedia` at all, which is the case the reader-facing code guards
   * against, so this is stubbed in rather than spied on.
   */
  function setContrast(on: boolean) {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-contrast") ? on : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  }

  const bar = () => document.querySelector(".legend-ramp") as HTMLElement;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("follows the sweep on screen rather than the preference now", () => {
    // A reader who has just turned contrast on is still looking at the sweep
    // they had. The bar has to describe that picture until the next one.
    setContrast(true);
    const sweep = { ...sweepOf(false), highContrast: false };
    render(chrome(113, { sweep }));
    expect(bar().style.background).toBe("");
  });

  it("draws the contrast ramp for a sweep drawn with it", () => {
    setContrast(false);
    const sweep = { ...sweepOf(false), highContrast: true };
    render(chrome(113, { sweep }));
    // Built at runtime from the ramp the native side painted with, rather
    // than from the stylesheet's own gradient.
    expect(bar().style.background).toContain("rgb(0, 37, 108)");
  });

  it("follows the preference for the mosaic, which has no such record", () => {
    // The mosaic tiles are asked for again when the preference changes, so
    // what is on screen is whatever it says now.
    setContrast(true);
    render(chrome(113, { sweep: null }));
    expect(bar().style.background).toContain("rgb(0, 37, 108)");
  });
});
