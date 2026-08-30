import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchGuidance } from "./guidance";
import { fetchTides } from "./tides";
import { fetchRoute, fetchRouteForecast } from "./route";
import { fetchForecast, searchPlaces } from "./weather";
import { fetchHrrrRun } from "./providers/hrrr";
import { rainviewerProvider } from "./providers/rainviewer";
import { ridgeProvider } from "./providers/ridge";
import { alertsOverlay } from "./overlays/alerts";
import { earthquakesOverlay } from "./overlays/earthquakes";
import { tropicalOverlay } from "./overlays/tropical";
import { wildfiresOverlay } from "./overlays/wildfires";
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
}> = [
  { name: "guidance", call: (signal) => fetchGuidance(point, ["gfs"], signal) },
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
    call: (signal) => alertsOverlay.fetchData(bounds, signal),
  },
  {
    name: "earthquakes overlay",
    call: (signal) => earthquakesOverlay.fetchData(bounds, signal),
  },
  {
    name: "tropical overlay",
    call: (signal) => tropicalOverlay.fetchData(bounds, signal),
  },
  {
    name: "wildfires overlay",
    call: (signal) => wildfiresOverlay.fetchData(bounds, signal),
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a request nobody is waiting for is cancelled", () => {
  for (const { name, call } of CALLS) {
    it(`${name} hands the caller's signal to fetch`, async () => {
      const stub = hangingFetch();
      vi.stubGlobal("fetch", stub);
      const controller = new AbortController();
      const pending = call(controller.signal);
      // Swallowed here; the assertion below is about what fetch was given.
      pending.catch(() => {});
      await Promise.resolve();

      expect(stub).toHaveBeenCalled();
      const init = (stub as unknown as { mock: { calls: unknown[][] } }).mock
        .calls[0][1] as { signal?: AbortSignal } | undefined;
      expect(init?.signal, `${name} dropped the signal`).toBe(
        controller.signal,
      );
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
});

describe("cancelling does not blame the provider", () => {
  it("leaves every source healthy when the caller aborts mid-request", async () => {
    // The failover chain reads a rejection as "this source is down" and moves
    // to the next one. An abort is the user moving the map, so treating it as
    // a failure would walk the whole chain and light up Diagnostics for
    // sources that answered perfectly well the moment before.
    resetHealth();
    vi.stubGlobal("fetch", hangingFetch());
    const controller = new AbortController();
    const pending = fetchRadarTimeline([-95, 35], 120, controller.signal);
    const settled = pending.then(
      () => null,
      (reason: unknown) => reason,
    );
    await Promise.resolve();
    controller.abort();
    const reason = await settled;

    expect(reason).not.toBeNull();
    for (const health of providerHealth()) {
      expect(
        health.consecutiveFailures,
        `${health.id} was blamed for a cancelled request`,
      ).toBe(0);
      expect(
        health.lastFailure,
        `${health.id} recorded a failure time for a cancelled request`,
      ).toBeNull();
    }
  });
});
