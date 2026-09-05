import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceChrome } from "./WorkspaceChrome";
import { en } from "../i18n/en";
import { DEFAULT_SETTINGS } from "../lib/settings";
import type { SweepImage } from "../lib/level2";
import type { SiteStatus } from "../lib/radarStatus";
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
    smoothed: false,
    dealiased: false,
    live,
    liveTilts: live ? 3 : 0,
    nextChunkAt: null,
    volumeEndsAt: null,
    stormMotion: null,
    product: "Reflectivity",
    unit: "dBZ",
    elevationDegrees: 0.48,
    tilts: [0.48, 0.87],
    tiltIndex: 0,
    collected: COLLECTED,
    beneathCollected: null,
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
  overrides: {
    sweep?: SweepImage | null;
    liveClock?: number;
    sweepLoop?: { index: number; count: number } | null;
    sweepStatus?: SiteStatus | null;
    siteStatus?: SiteStatus[];
    sitesInReach?: Array<{ station: string }>;
    onHoldSite?: (station: string) => void;
    /** The site the reader is holding, which is what can stop sending. */
    station?: string;
  } = {},
) {
  return (
    <WorkspaceChrome
      settings={
        overrides.station
          ? {
              ...DEFAULT_SETTINGS,
              radar: { ...DEFAULT_SETTINGS.radar, station: overrides.station },
            }
          : DEFAULT_SETTINGS
      }
      timeline={timeline}
      frames={[]}
      sweep={overrides.sweep ?? null}
      sweepLoop={overrides.sweepLoop ?? null}
      sweepStatus={overrides.sweepStatus ?? null}
      siteStatus={overrides.siteStatus ?? []}
      sitesInReach={overrides.sitesInReach ?? []}
      onHoldSite={overrides.onHoldSite ?? vi.fn()}
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
      onHoldToasts={vi.fn()}
      onReleaseToasts={vi.fn()}
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
    // "SEC" rather than "S": a lone S beside a number is the code's
    // abbreviation, not a word anybody reads.
    expect(screen.getByText(/LIVE, 37 SEC OLD/)).toBeTruthy();
  });

  it("says when the next piece is due and when the volume ends", () => {
    // A live picture is a volume being built a piece at a time, and the
    // legend said only how old the newest piece was: a reader watching a
    // sector fill in had nothing to say when the rest would arrive.
    const at = Date.parse(COLLECTED) + 37_000;
    render(
      chrome(113, {
        sweep: {
          ...sweepOf(true),
          nextChunkAt: new Date(at + 8_000).toISOString(),
          volumeEndsAt: new Date(at + 190_000).toISOString(),
        },
        liveClock: at,
      }),
    );
    expect(screen.getByText(/NEXT PIECE IN 8 S/)).toBeTruthy();
    expect(screen.getByText(/ENDS /)).toBeTruthy();
  });

  it("stops counting down once the piece is overdue", () => {
    // A countdown that has run out is a worse answer than the age beside it,
    // which keeps counting up and is still true.
    const at = Date.parse(COLLECTED) + 37_000;
    render(
      chrome(113, {
        sweep: {
          ...sweepOf(true),
          nextChunkAt: new Date(at - 1_000).toISOString(),
          volumeEndsAt: new Date(at + 60_000).toISOString(),
        },
        liveClock: at,
      }),
    );
    expect(screen.queryByText(/NEXT PIECE/)).toBeNull();
    // And the age it already had is still there.
    expect(screen.getByText(/LIVE, 37 SEC OLD/)).toBeTruthy();
  });

  it("says nothing about a projection the radar has not published", () => {
    // Until a start chunk has been read there is no coverage pattern, and
    // there is nothing honest to say about when the next piece is due.
    render(
      chrome(113, {
        sweep: sweepOf(true),
        liveClock: Date.parse(COLLECTED) + 37_000,
      }),
    );
    expect(screen.queryByText(/NEXT PIECE/)).toBeNull();
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

describe("the legend over a volume the loop reached back for", () => {
  it("says where in the loop it is and when that volume was collected", () => {
    // The volume arrives from the archive, the same door a reader's own
    // chosen file comes through, so before this it read HISTORICAL: a word
    // the app uses for a view that has left the present, in a view that has
    // not. What a scrubbing reader needs is how far back they are and the
    // time of the picture they are looking at, and that time is the volume's
    // own, five minutes from its neighbour, not the two-minute step above it.
    render(
      chrome(113, {
        sweep: {
          ...sweepOf(false),
          source: { ...sweepOf(false).source, kind: "archive" },
        },
        sweepLoop: { index: 2, count: 3 },
      }),
    );
    expect(screen.getByText(/VOLUME 2 OF 3/)).toBeTruthy();
    expect(screen.queryByText(/HISTORICAL/)).toBeNull();
    // Nor is it treated as history anywhere else. The same test decided the
    // credit line under the map and whether the scrubber was usable at all,
    // so one step back disabled the control that took it.
    expect(screen.queryByText("NOAA NEXRAD Level II")).toBeNull();
  });
});

describe("the legend over a radar that has gone quiet", () => {
  it("says how long since anything was heard from it", () => {
    // A held site keeps being drawn when it stops sending, because the reader
    // chose it and the last volume is still the last thing anybody knows.
    // What it must not do is go on looking current: the sweep's own age is
    // how old this picture is, and this is how long the radar has been off.
    render(
      chrome(113, {
        sweep: sweepOf(false),
        liveClock: Date.parse(COLLECTED) + 37_000,
        sweepStatus: {
          station: "KDMX",
          status: "Operate",
          levelTwoAt: new Date(
            Date.parse(COLLECTED) - 40 * 60_000,
          ).toISOString(),
          fault: "noRecentData",
        },
      }),
    );
    expect(screen.getByText(/NOT HEARD FROM FOR/)).toBeTruthy();
  });

  it("says nothing while the radar is being heard from", () => {
    render(
      chrome(113, {
        sweep: sweepOf(false),
        sweepStatus: {
          station: "KDMX",
          status: "Operate",
          levelTwoAt: COLLECTED,
          fault: null,
        },
      }),
    );
    expect(screen.queryByText(/NOT HEARD FROM/)).toBeNull();
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

describe("a held radar that has stopped", () => {
  it("says so and offers the nearest one that has not", () => {
    // KLWX went down inside a tornado warning on 2026-08-17. A site the
    // reader chose keeps being drawn, because the last volume is still the
    // last thing anybody knows, and until now the only sign was the age on
    // the legend: the picture simply stopped moving.
    const onHoldSite = vi.fn();
    render(
      chrome(113, {
        sweepStatus: {
          station: "KLWX",
          status: "Start-Up",
          levelTwoAt: null,
          fault: "notOperating",
        },
        siteStatus: [
          {
            station: "KLWX",
            status: "Start-Up",
            levelTwoAt: null,
            fault: "notOperating",
          },
          {
            station: "KDOX",
            status: "Start-Up",
            levelTwoAt: null,
            fault: "notOperating",
          },
          {
            station: "KAKQ",
            status: "Operate",
            levelTwoAt: null,
            fault: null,
          },
        ],
        // Nearest first, and the nearest one is also down: the offer is the
        // nearest that is publishing, not the nearest.
        sitesInReach: [
          { station: "KLWX" },
          { station: "KDOX" },
          { station: "KAKQ" },
        ],
        onHoldSite,
        station: "KLWX",
      }),
    );

    const line = document.querySelector(".site-down");
    expect(line, "the chrome says the radar has stopped").toBeTruthy();
    expect(line?.textContent).toContain("KLWX");
    // The office's own word for it, in a sentence somebody wrote.
    expect(line?.textContent).toContain(en["radar.faultStartUp"]);

    const offer = screen.getByRole("button", {
      name: en["radar.holdInstead"].replace("{station}", "KAKQ"),
    });
    fireEvent.click(offer);
    expect(onHoldSite).toHaveBeenCalledWith("KAKQ");
  });

  it("says nothing while the office says the radar is working", () => {
    render(
      chrome(113, {
        sweepStatus: {
          station: "KLWX",
          status: "Operate",
          levelTwoAt: null,
          fault: null,
        },
        station: "KLWX",
      }),
    );
    expect(document.querySelector(".site-down")).toBeNull();
  });

  it("still says the radar stopped when nothing else can be offered", () => {
    // A reader in a corner of the coverage with one radar in reach still
    // needs to know it has stopped, even though there is nowhere to go.
    render(
      chrome(113, {
        sweepStatus: {
          station: "KLWX",
          status: null,
          levelTwoAt: null,
          fault: "notOperating",
        },
        sitesInReach: [{ station: "KLWX" }],
        station: "KLWX",
      }),
    );
    const line = document.querySelector(".site-down");
    expect(line?.textContent).toContain("KLWX");
    expect(line?.querySelector("button")).toBeNull();
  });
});
