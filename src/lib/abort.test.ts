import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchGuidance } from "./guidance";
import { fetchTides, loadStations, resetStations } from "./tides";
import { fetchRoute, fetchRouteForecast } from "./route";
import { fetchForecast, searchPlaces } from "./weather";
import { fetchHrrrRun } from "./providers/hrrr";
import { rainviewerProvider } from "./providers/rainviewer";
import { ridgeProvider } from "./providers/ridge";
import { alertsOverlay, resetAlertTags } from "./overlays/alerts";
import { earthquakesOverlay } from "./overlays/earthquakes";
import { tropicalOverlay } from "./overlays/tropical";
import { wildfiresOverlay } from "./overlays/wildfires";
import { DEFAULT_OVERLAY_CHOICES } from "./overlays/registry";
import { fetchRadarTimeline } from "./providers";
import { providerHealth, resetHealth } from "./providers/health";

/**
 * Every request the workspace makes belongs to something a person can close or
 * move: a panel, a viewport, a timeline. When that happens the caller aborts,
 * and two things have to hold.
 *
 * The signal has to actually reach `fetch`, or the request runs on with nobody
 * waiting for it and its answer races the next one.
 *
 * And the rejection has to arrive as an `AbortError`. Every caller in the app
 * tells a cancelled request from a failed one by that name, so a module that
 * caught the abort and rethrew its own message would put a toast on screen for
 * a map the user simply panned away from.
 */

const bounds = { west: -100, south: 30, east: -90, north: 40 };
const point = { lon: -95, lat: 35 };

/** Lets any promise chain the call sets up run before we look at it. */
async function flush(turns = 8) {
  for (let turn = 0; turn < turns; turn += 1) await Promise.resolve();
}

/** A fetch that never answers, and rejects the way the real one does. */
function hangingFetch(): typeof globalThis.fetch {
  return vi.fn((_input: unknown, init?: { signal?: AbortSignal }) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return;
      if (signal.aborted) {
        reject(new DOMException("The operation was aborted.", "AbortError"));
        return;
      }
      signal.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      });
    });
  }) as unknown as typeof globalThis.fetch;
}

/** Each module, named the way the caller reaches it. */
const CALLS: Array<{
  name: string;
  call: (signal: AbortSignal) => Promise<unknown>;
  /** A countrywide singleton read is shared across callers and is not theirs to abort. */
  allowsSharedFetch?: boolean;
}> = [
  {
    name: "guidance",
    call: (signal) => fetchGuidance(point, ["gfs_seamless"], signal),
  },
  {
    name: "tides",
    call: (signal) =>
      fetchTides(
        { id: "8761724", name: "Grand Isle", state: "LA", lat: 29.2, lon: -90 },
        12,
        new Date(),
        signal,
      ),
  },
  {
    name: "route",
    call: (signal) => fetchRoute(point, { lon: -94, lat: 36 }, signal),
  },
  {
    name: "route forecast",
    call: (signal) =>
      fetchRouteForecast(
        [{ point, distanceMiles: 0, offsetSeconds: 0, index: 0 }],
        Date.now(),
        signal,
      ),
  },
  { name: "forecast", call: (signal) => fetchForecast(point, signal) },
  { name: "place search", call: (signal) => searchPlaces("dallas", signal) },
  { name: "HRRR run", call: (signal) => fetchHrrrRun(signal) },
  {
    name: "RainViewer frames",
    call: (signal) => rainviewerProvider.fetchFrames(120, signal),
  },
  {
    name: "RIDGE frames",
    call: (signal) => ridgeProvider.fetchFrames(120, signal),
  },
  {
    name: "alerts overlay",
    call: (signal) =>
      alertsOverlay.fetchData(bounds, signal, DEFAULT_OVERLAY_CHOICES),
    allowsSharedFetch: true,
  },
  {
    name: "earthquakes overlay",
    call: (signal) =>
      earthquakesOverlay.fetchData(bounds, signal, DEFAULT_OVERLAY_CHOICES),
  },
  {
    name: "tropical overlay",
    call: (signal) =>
      tropicalOverlay.fetchData(bounds, signal, DEFAULT_OVERLAY_CHOICES),
  },
  {
    name: "wildfires overlay",
    call: (signal) =>
      wildfiresOverlay.fetchData(bounds, signal, DEFAULT_OVERLAY_CHOICES),
  },
];

afterEach(() => {
  resetAlertTags();
  vi.unstubAllGlobals();
});

describe("a request nobody is waiting for is cancelled", () => {
  for (const { name, call, allowsSharedFetch } of CALLS) {
    it(`${name} hands the caller's signal to fetch`, async () => {
      const stub = hangingFetch();
      vi.stubGlobal("fetch", stub);
      const controller = new AbortController();
      const pending = call(controller.signal);
      // Swallowed here; the assertion below is about what fetch was given.
      pending.catch(() => {});
      // Several turns, not one: a request can sit behind a queue of its own
      // before it is issued, which is what the OSRM route does.
      await flush();

      expect(stub).toHaveBeenCalled();
      // Every request, not just the first: the tropical overlay fetches one
      // document per layer, and a signal dropped on the second would
      // otherwise go unnoticed.
      const calls = (stub as unknown as { mock: { calls: unknown[][] } }).mock
        .calls;
      let bound = 0;
      for (const [at, call] of calls.entries()) {
        const init = call[1] as { signal?: AbortSignal } | undefined;
        if (allowsSharedFetch && !init?.signal) continue;
        expect(
          init?.signal,
          `${name} dropped the signal on request ${at}`,
        ).toBe(controller.signal);
        bound += 1;
      }
      if (!allowsSharedFetch) {
        expect(
          bound,
          `${name} made no request tied to its caller`,
        ).toBeGreaterThan(0);
      }
      controller.abort();
      await expect(pending).rejects.toThrow();
    });

    it(`${name} rejects with an AbortError rather than its own message`, async () => {
      vi.stubGlobal("fetch", hangingFetch());
      const controller = new AbortController();
      const pending = call(controller.signal);
      const settled = pending.then(
        () => null,
        (reason: unknown) => reason,
      );
      controller.abort();
      const reason = await settled;

      expect(reason, `${name} resolved instead of rejecting`).not.toBeNull();
      expect(
        reason instanceof DOMException && reason.name === "AbortError",
        `${name} rejected with ${String(reason)}`,
      ).toBe(true);
    });
  }

  it("alerts ties the bounds-limited polygon read to its caller", async () => {
    const wait = hangingFetch();
    const stub = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ type: "FeatureCollection", features: [] }),
          {
            status: 200,
            headers: { "content-type": "application/geo+json" },
          },
        ),
      )
      .mockImplementation(wait);
    vi.stubGlobal("fetch", stub);
    const controller = new AbortController();
    const pending = alertsOverlay.fetchData(
      bounds,
      controller.signal,
      DEFAULT_OVERLAY_CHOICES,
    );
    await flush(12);

    expect(stub).toHaveBeenCalledTimes(2);
    expect(stub.mock.calls[1][1]?.signal).toBe(controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("cancelling does not blame the provider", () => {
  /** Runs the failover chain against a fetch that behaves as given. */
  async function runChain(
    answer: typeof globalThis.fetch,
    cancel: boolean,
  ): Promise<unknown> {
    resetHealth();
    vi.stubGlobal("fetch", answer);
    const controller = new AbortController();
    const settled = fetchRadarTimeline([-95, 35], 120, controller.signal).then(
      () => null,
      (reason: unknown) => reason,
    );
    await Promise.resolve();
    if (cancel) controller.abort();
    return settled;
  }

  it("blames a source that really did fail", async () => {
    // The control for the test below. Without it "no source was blamed" would
    // pass just as well against a chain that recorded nothing at all, because
    // the published snapshot starts empty and only a record fills it.
    const refuse = vi.fn(() =>
      Promise.reject(new Error("the service is down")),
    ) as unknown as typeof globalThis.fetch;
    const reason = await runChain(refuse, false);

    expect(reason).not.toBeNull();
    expect(
      providerHealth().filter((health) => health.consecutiveFailures > 0)
        .length,
      "a real failure should be recorded",
    ).toBeGreaterThan(0);
  });

  it("leaves every source healthy when the caller aborts mid-request", async () => {
    // The failover chain reads a rejection as "this source is down" and moves
    // to the next one. An abort is the user moving the map, so treating it as
    // a failure would walk the whole chain and light up Diagnostics for
    // sources that answered perfectly well the moment before.
    const reason = await runChain(hangingFetch(), true);

    expect(reason).not.toBeNull();
    expect(
      providerHealth().filter((health) => health.consecutiveFailures > 0),
      "a cancelled request blamed a source",
    ).toEqual([]);
    expect(
      providerHealth().filter((health) => health.lastFailure !== null),
      "a cancelled request recorded a failure time",
    ).toEqual([]);
  });
});

describe("the two shared loaders take no signal on purpose", () => {
  // Both read a file bundled with the app and hand every caller the same
  // promise, so one caller's signal would cancel the load the others are
  // waiting on. The panels guard their own state writes instead.
  it("hands every caller one in-flight request and no signal", async () => {
    resetStations();
    const stub = vi.fn(() =>
      Promise.resolve(
        new Response("[]", { headers: { "content-type": "application/json" } }),
      ),
    ) as unknown as typeof globalThis.fetch;
    vi.stubGlobal("fetch", stub);

    const [first, second] = await Promise.all([loadStations(), loadStations()]);

    expect(stub).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    const init = (stub as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][1] as { signal?: AbortSignal } | undefined;
    expect(
      init?.signal,
      "a shared loader must not take a caller's signal",
    ).toBeUndefined();
  });
});
