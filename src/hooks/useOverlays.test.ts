import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import {
  IDLE_OVERLAY,
  overlayStatus,
  shouldRefetch,
  useOverlays,
  variantOf,
} from "./useOverlays";
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

describe("a snapshot that outlived the coverage record beside it", () => {
  afterEach(() => {
    online.reachable = true;
    vi.restoreAllMocks();
  });

  function only(id: OverlayId): Record<OverlayId, boolean> {
    const switches = {} as Record<OverlayId, boolean>;
    for (const adapter of OVERLAY_ADAPTERS) switches[adapter.id] = false;
    switches[id] = true;
    return switches;
  }

  const nothing = {} as Record<OverlayId, boolean>;
  for (const adapter of OVERLAY_ADAPTERS) nothing[adapter.id] = false;

  it("is not stamped with a question it does not answer when a later ask fails", async () => {
    // Switching a layer off drops its coverage record and leaves its data,
    // so the two part company. Asking the coverage "is what I hold stale?"
    // then answers "there is nothing to compare against", and the old day's
    // polygons were stamped with the new day's question and drawn under its
    // heading. The same failure the variant was added to prevent, coming
    // back through the path meant to close it.
    let answer: "ok" | "fail" = "ok";
    vi.spyOn(globalThis, "fetch").mockImplementation((async () => {
      if (answer === "fail") throw new Error("the outlook service is down");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          features: [
            {
              type: "Feature",
              geometry: {
                type: "Polygon",
                coordinates: [
                  [
                    [-88, 32],
                    [-86, 32],
                    [-86, 34],
                    [-88, 34],
                    [-88, 32],
                  ],
                ],
              },
              properties: { dn: 2, label: "TSTM", valid: "", expire: "" },
            },
          ],
        }),
      } as Response;
    }) as unknown as typeof fetch);

    const dayOne = DEFAULT_OVERLAY_CHOICES;
    const dayTwo = { ...DEFAULT_OVERLAY_CHOICES, spcDay: 2 as const };
    const view = renderHook<
      ReturnType<typeof useOverlays>,
      { on: Record<OverlayId, boolean>; choices: OverlayChoices }
    >(({ on, choices }) => useOverlays(on, ALABAMA, choices), {
      initialProps: { on: only("spcOutlooks"), choices: dayOne },
    });
    await waitFor(() =>
      expect(
        view.result.current.spcOutlooks.data.features.length,
      ).toBeGreaterThan(0),
    );

    // Off, which drops the coverage and keeps the data.
    view.rerender({ on: nothing, choices: dayOne });
    // Another day, and back on, and this time the service is down.
    answer = "fail";
    view.rerender({ on: only("spcOutlooks"), choices: dayTwo });
    await waitFor(() =>
      expect(view.result.current.spcOutlooks.error).not.toBeNull(),
    );

    // The error is what the reader is told, and Day 1's polygons are not
    // drawn under Day 2's heading beside it.
    expect(view.result.current.spcOutlooks.data.features).toHaveLength(0);
  });
});

describe("what a switched-on layer has to say for itself", () => {
  const REFRESH = 5 * 60_000;
  const NOW = Date.parse("2026-09-09T18:00:00Z");

  it("tells a quiet afternoon from a source that is down", () => {
    // The whole point of the row. A reader switches a layer on, sees nothing,
    // and has no way to tell an afternoon with no earthquakes in it from a
    // service that is not answering. Both draw nothing.
    const quiet = {
      ...IDLE_OVERLAY,
      fetchedAt: NOW - 60_000,
    };
    const down = {
      ...IDLE_OVERLAY,
      fetchedAt: NOW - 60_000,
      error: "The request failed.",
    };
    expect(overlayStatus(quiet, REFRESH, NOW).health).toBe("fresh");
    const failed = overlayStatus(down, REFRESH, NOW);
    expect(failed.health).toBe("failed");
    expect(failed.error).toBe("The request failed.");
    // The age of what is still drawn, not of the failure: the older picture
    // is the reason the layer is still showing something.
    expect(failed.ageSeconds).toBe(60);
  });

  it("measures old against the layer's own cadence", () => {
    // These run from half a minute to six hours apart, so one number for all
    // of them is either always old or never. A snapshot that has outlived two
    // of its own refreshes has missed at least one.
    const at = (agoMs: number) => ({ ...IDLE_OVERLAY, fetchedAt: NOW - agoMs });
    expect(overlayStatus(at(REFRESH), REFRESH, NOW).health).toBe("fresh");
    expect(overlayStatus(at(REFRESH * 2 + 1), REFRESH, NOW).health).toBe(
      "stale",
    );
    // And a slower layer at the same age is not old at all.
    expect(overlayStatus(at(REFRESH * 2 + 1), REFRESH * 4, NOW).health).toBe(
      "fresh",
    );
  });

  it("separates waiting from asking", () => {
    // A layer just switched on and a layer whose request is out look the same
    // from the snapshot alone, and they are different news: one of them is
    // about to answer.
    expect(overlayStatus(IDLE_OVERLAY, REFRESH, NOW).health).toBe("waiting");
    expect(
      overlayStatus({ ...IDLE_OVERLAY, fetching: true }, REFRESH, NOW).health,
    ).toBe("fetching");
    // Nothing has ever arrived, so there is no age to give.
    expect(overlayStatus(IDLE_OVERLAY, REFRESH, NOW).ageSeconds).toBeNull();
  });
});

describe("a request that was cancelled rather than answered", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Every layer off but the one under test. */
  function only(id: OverlayId): Record<OverlayId, boolean> {
    const switches = {} as Record<OverlayId, boolean>;
    for (const adapter of OVERLAY_ADAPTERS) switches[adapter.id] = false;
    switches[id] = true;
    return switches;
  }

  it("stops the row saying it is still asking", async () => {
    // Every abort takes the request out of the map before the promise
    // settles, so a settle that checked "do I still own the slot" returned
    // before clearing anything, in exactly the case it was written for. The
    // row then read as asking until the layer's next refresh came round,
    // which for the wildfire layer is ten minutes and for the winter severity
    // one is twenty.
    const NEAR = { west: -122.5, south: 37.5, east: -122.0, north: 38.0 };
    const AWAY = { west: -100.0, south: 40.0, east: -99.5, north: 40.5 };
    let asked = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((async (
      _url: string,
      init?: { signal?: AbortSignal },
    ) => {
      asked += 1;
      if (asked === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ features: [] }),
        } as Response;
      }
      // Every later one hangs until it is cancelled, which is what a request
      // for somewhere the reader has left does.
      return new Promise<Response>((_, refuse) => {
        init?.signal?.addEventListener("abort", () =>
          refuse(new DOMException("aborted", "AbortError")),
        );
      });
    }) as unknown as typeof fetch);

    const view = renderHook<
      ReturnType<typeof useOverlays>,
      { bounds: OverlayBounds }
    >(
      ({ bounds }) =>
        useOverlays(only("wildfires"), bounds, DEFAULT_OVERLAY_CHOICES),
      { initialProps: { bounds: NEAR } },
    );
    await waitFor(() =>
      expect(view.result.current.wildfires.fetchedAt).not.toBeNull(),
    );

    // Away, which is a new request, and back before it lands, which cancels
    // it and asks for nothing: what is already held covers where the reader
    // is again.
    view.rerender({ bounds: AWAY });
    await waitFor(() => expect(asked).toBe(2));
    expect(view.result.current.wildfires.fetching).toBe(true);
    view.rerender({ bounds: NEAR });

    await waitFor(() =>
      expect(
        view.result.current.wildfires.fetching,
        "the row was left saying it was still asking",
      ).toBe(false),
    );
    // And nothing was asked for on the way back, which is what makes this the
    // cancelled case rather than a successor quietly covering for it.
    expect(asked).toBe(2);
  });
});
