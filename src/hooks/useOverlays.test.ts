import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { shouldRefetch, useOverlays, variantOf } from "./useOverlays";
import { DEFAULT_OVERLAY_CHOICES } from "../lib/overlays/registry";
import { OVERLAY_ADAPTERS } from "../lib/overlays";
import { stormReportsOverlay } from "../lib/overlays/reports";
import { spcOutlooksOverlay } from "../lib/overlays/spc";
import type {
  OverlayBounds,
  OverlayChoices,
  OverlayId,
} from "../lib/overlays/registry";

const online = vi.hoisted(() => ({ reachable: true }));
vi.mock("../lib/online", () => ({
  isOnline: () => online.reachable,
  noteReached: () => {},
}));

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

describe("a snapshot of a day the reader has left", () => {
  afterEach(() => {
    online.reachable = true;
    vi.restoreAllMocks();
  });

  /** Every layer off but the one under test. */
  function only(id: OverlayId): Record<OverlayId, boolean> {
    const switches = {} as Record<OverlayId, boolean>;
    for (const adapter of OVERLAY_ADAPTERS) switches[adapter.id] = false;
    switches[id] = true;
    return switches;
  }

  it("is dropped when the question changes, even with no network to ask again", async () => {
    // The sequence: a replay is on and its reports are drawn, the machine
    // loses the network, and the reader ends the replay. The effect re-runs,
    // aborts nothing, and returns before it asks for anything, because there
    // is no network to ask over. Nothing else was clearing the snapshot, so
    // an afternoon in 2011 stayed drawn over the present with no label, for
    // as long as the machine stayed offline.
    const answering = vi.spyOn(globalThis, "fetch").mockImplementation(
      (async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            features: [
              {
                type: "Feature",
                geometry: { type: "Point", coordinates: [-87, 33] },
                properties: {
                  valid: "2011-04-27T22:00:00Z",
                  type: "T",
                  typetext: "TORNADO",
                },
              },
            ],
          }),
        }) as Response) as unknown as typeof fetch,
    );

    const replaying = { ...DEFAULT_OVERLAY_CHOICES, replay: REPLAY };
    const view = renderHook<
      ReturnType<typeof useOverlays>,
      { choices: OverlayChoices }
    >(({ choices }) => useOverlays(only("stormReports"), ALABAMA, choices), {
      initialProps: { choices: replaying },
    });
    await waitFor(() =>
      expect(view.result.current.stormReports.data.features).toHaveLength(1),
    );

    // The network goes, and then the reader ends the replay.
    online.reachable = false;
    view.rerender({ choices: DEFAULT_OVERLAY_CHOICES });

    expect(view.result.current.stormReports.data.features).toHaveLength(0);
    expect(view.result.current.stormReports.fetchedAt).toBeNull();
    // And nothing was asked for, which is the half that makes this the
    // offline case rather than a refetch quietly covering for it.
    const asked = answering.mock.calls.length;
    await new Promise((wake) => setTimeout(wake, 20));
    expect(answering.mock.calls.length).toBe(asked);
  });

  it("keeps a snapshot that still answers the question being asked", async () => {
    // The other direction, so the check above cannot pass by dropping
    // everything: a re-render that changes nothing leaves the map alone.
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            features: [
              {
                type: "Feature",
                geometry: { type: "Point", coordinates: [-87, 33] },
                properties: {
                  valid: "2011-04-27T22:00:00Z",
                  type: "H",
                  typetext: "HAIL",
                },
              },
            ],
          }),
        }) as Response) as unknown as typeof fetch,
    );

    const replaying = { ...DEFAULT_OVERLAY_CHOICES, replay: REPLAY };
    const view = renderHook<
      ReturnType<typeof useOverlays>,
      { choices: OverlayChoices }
    >(({ choices }) => useOverlays(only("stormReports"), ALABAMA, choices), {
      initialProps: { choices: replaying },
    });
    await waitFor(() =>
      expect(view.result.current.stormReports.data.features).toHaveLength(1),
    );

    online.reachable = false;
    view.rerender({ choices: { ...replaying } });
    expect(view.result.current.stormReports.data.features).toHaveLength(1);
  });
});
