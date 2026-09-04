import { describe, expect, it } from "vitest";
import { shouldRefetch, variantOf } from "./useOverlays";
import { DEFAULT_OVERLAY_CHOICES } from "../lib/overlays/registry";
import { stormReportsOverlay } from "../lib/overlays/reports";
import { spcOutlooksOverlay } from "../lib/overlays/spc";
import type { OverlayBounds } from "../lib/overlays/registry";

const ALABAMA: OverlayBounds = {
  west: -88.5,
  south: 32.0,
  east: -85.0,
  north: 35.0,
};
const MISSISSIPPI: OverlayBounds = {
  west: -91.5,
  south: 31.0,
  east: -88.5,
  north: 34.5,
};

const REPLAY = {
  from: Date.UTC(2011, 3, 27, 18),
  to: Date.UTC(2011, 3, 27, 23),
};

function coverageFor(
  adapter: typeof stormReportsOverlay,
  choices: typeof DEFAULT_OVERLAY_CHOICES,
  bounds: OverlayBounds,
  at: number,
) {
  return { bounds, at, variant: variantOf(adapter, choices) };
}

describe("whether a layer is asked again", () => {
  it("does not re-ask the archive for a window that has already happened", () => {
    // A parked replay used to ask for the same fixed past afternoon every
    // five minutes for as long as the panel stayed open, because the
    // freshness branch ran before anything knew the window was in the past.
    // The Rust cache does not stop it either: that is a fallback for a failed
    // request, not a store with a lifetime.
    const choices = { ...DEFAULT_OVERLAY_CHOICES, replay: REPLAY };
    const at = 1_000_000;
    const coverage = coverageFor(stormReportsOverlay, choices, ALABAMA, at);
    // Well past both adapters' refresh windows.
    const later = at + 60 * 60_000;
    expect(
      shouldRefetch(stormReportsOverlay, coverage, ALABAMA, later, choices),
    ).toBe(false);
    expect(
      shouldRefetch(
        spcOutlooksOverlay,
        coverageFor(spcOutlooksOverlay, choices, ALABAMA, at),
        ALABAMA,
        later,
        choices,
      ),
    ).toBe(false);
  });

  it("still re-asks the live feed on its own timer", () => {
    // The same branch, proved to still do its job when nothing is replayed.
    const choices = DEFAULT_OVERLAY_CHOICES;
    const at = 1_000_000;
    const coverage = coverageFor(stormReportsOverlay, choices, ALABAMA, at);
    expect(
      shouldRefetch(
        stormReportsOverlay,
        coverage,
        ALABAMA,
        at + stormReportsOverlay.refreshMs,
        choices,
      ),
    ).toBe(true);
  });

  it("asks again when a replay is panned somewhere the archive was not asked about", () => {
    // The live reports feed is one request for the whole country, so panning
    // changes nothing and the adapter is marked global. The archive path is
    // not: it is asked by a point and a radius taken from the box on screen.
    // Start over Alabama, pan to Mississippi, and the reports stayed the ones
    // fetched around the first centre, mostly off the side of the map.
    const choices = { ...DEFAULT_OVERLAY_CHOICES, replay: REPLAY };
    const at = 1_000_000;
    const coverage = coverageFor(stormReportsOverlay, choices, ALABAMA, at);
    expect(
      shouldRefetch(stormReportsOverlay, coverage, MISSISSIPPI, at, choices),
    ).toBe(true);
    // And panning inside what was already asked about does not.
    expect(
      shouldRefetch(
        stormReportsOverlay,
        coverage,
        { west: -88.0, south: 32.5, east: -86.0, north: 34.0 },
        at,
        choices,
      ),
    ).toBe(false);
  });

  it("leaves the live global feed alone whatever the camera does", () => {
    const choices = DEFAULT_OVERLAY_CHOICES;
    const at = 1_000_000;
    const coverage = coverageFor(stormReportsOverlay, choices, ALABAMA, at);
    expect(
      shouldRefetch(stormReportsOverlay, coverage, MISSISSIPPI, at, choices),
    ).toBe(false);
  });

  it("asks again the moment the question changes", () => {
    // Before freshness and before the box: a snapshot of another day is not
    // a stale answer, it is the wrong one.
    const replaying = { ...DEFAULT_OVERLAY_CHOICES, replay: REPLAY };
    const live = DEFAULT_OVERLAY_CHOICES;
    const at = 1_000_000;
    const coverage = coverageFor(stormReportsOverlay, replaying, ALABAMA, at);
    expect(
      shouldRefetch(stormReportsOverlay, coverage, ALABAMA, at, live),
    ).toBe(true);
  });
});
