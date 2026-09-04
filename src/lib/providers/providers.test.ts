import { afterEach, describe, expect, it, vi } from "vitest";
import { createRollingRequestBudget } from "./budget";
import {
  BLANK_TILE_URL,
  coverageKey,
  fetchRadarTimeline,
  guardRadarRequest,
  providerChain,
  resetRadarBudgets,
} from "./index";
import { parseRainViewerFrames } from "./rainviewer";
import { durationSeconds, parseWmsTimeSteps, wmsTileUrl } from "./wms";
import { resetHealth, providerHealth } from "./health";
import { noteCachedResponse } from "../tileCache";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

const RIDGE_CAPABILITIES = `<?xml version="1.0" encoding="UTF-8"?>
<WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms">
  <Capability>
    <Layer>
      <Name>conus</Name>
      <Layer queryable="1">
        <Name>conus_bref_qcd</Name>
        <Title>Base Reflectivity</Title>
        <Dimension name="time" units="ISO8601" default="2026-08-30T06:30:12Z">2026-08-30T06:26:12.000Z,2026-08-30T06:28:12.000Z,2026-08-30T06:30:12.000Z</Dimension>
      </Layer>
      <Layer queryable="1">
        <Name>conus_cref_qcd</Name>
        <Dimension name="time" units="ISO8601">2026-08-30T06:20:00.000Z</Dimension>
      </Layer>
    </Layer>
  </Capability>
</WMS_Capabilities>`;

afterEach(() => {
  vi.unstubAllGlobals();
  resetRadarBudgets();
  resetHealth();
});

describe("WMS time dimension", () => {
  it("reads the requested layer and keeps the server's own time strings", () => {
    const steps = parseWmsTimeSteps(RIDGE_CAPABILITIES, "conus_bref_qcd");
    expect(steps).toHaveLength(3);
    expect(steps[0].iso).toBe("2026-08-30T06:26:12.000Z");
    expect(steps[2].time).toBe(
      Math.floor(Date.parse("2026-08-30T06:30:12.000Z") / 1000),
    );
    expect(steps[0].time).toBeLessThan(steps[1].time);
  });

  it("returns nothing for a layer the document does not publish", () => {
    expect(parseWmsTimeSteps(RIDGE_CAPABILITIES, "conus_missing")).toEqual([]);
    expect(parseWmsTimeSteps("not xml at all", "conus_bref_qcd")).toEqual([]);
  });

  it("expands an interval into the instants it stands for", () => {
    const document = `<?xml version="1.0"?>
<WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms">
  <Capability><Layer><Layer>
    <Name>conus_bref_qcd</Name>
    <Dimension name="time" units="ISO8601">2026-08-30T06:00:00.000Z/2026-08-30T06:08:00.000Z/PT2M</Dimension>
  </Layer></Layer></Capability>
</WMS_Capabilities>`;
    const steps = parseWmsTimeSteps(document, "conus_bref_qcd");
    expect(steps.map((step) => step.iso)).toEqual([
      "2026-08-30T06:00:00.000Z",
      "2026-08-30T06:02:00.000Z",
      "2026-08-30T06:04:00.000Z",
      "2026-08-30T06:06:00.000Z",
      "2026-08-30T06:08:00.000Z",
    ]);
  });

  it("reads the periods a WMS may publish", () => {
    expect(durationSeconds("PT2M")).toBe(120);
    expect(durationSeconds("PT1H30M")).toBe(5400);
    expect(durationSeconds("P1D")).toBe(86_400);
    expect(durationSeconds("PT0S")).toBeNull();
    expect(durationSeconds("every two minutes")).toBeNull();
  });

  it("builds a GetMap template MapLibre can substitute a bbox into", () => {
    const url = wmsTileUrl(
      "https://opengeo.ncep.noaa.gov/geoserver/conus/ows",
      "conus_bref_qcd",
      "2026-08-30T06:30:12.000Z",
    );
    expect(url).toContain("request=GetMap");
    expect(url).toContain("srs=EPSG%3A3857");
    expect(url).toContain("time=2026-08-30T06%3A30%3A12.000Z");
    expect(url.endsWith("&bbox={bbox-epsg-3857}")).toBe(true);
  });
});

describe("provider selection", () => {
  it("prefers the NOAA mosaics over CONUS and keeps RainViewer for the rest", () => {
    expect(providerChain(-96.8, 32.8).map((provider) => provider.id)).toEqual([
      "ridge",
      "nowcoast",
    ]);
    expect(providerChain(-149.9, 61.2).map((provider) => provider.id)).toEqual([
      "nowcoast",
    ]);
    // Havana sits inside a loose CONUS rectangle but has no NOAA mosaic.
    expect(providerChain(-82.4, 23.1).map((provider) => provider.id)).toEqual([
      "rainviewer",
    ]);
    expect(providerChain(2.35, 48.85).map((provider) => provider.id)).toEqual([
      "rainviewer",
    ]);
    expect(coverageKey(-96.8, 32.8)).toBe("ridge+nowcoast");
  });
});

describe("failover", () => {
  it("takes the next source when RIDGE fails and names it in the timeline", async () => {
    const nowcoast = `<?xml version="1.0"?>
<WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms">
  <Capability><Layer><Layer>
    <Name>base_reflectivity_mosaic</Name>
    <Dimension name="time" units="ISO8601">2026-08-30T06:24:00.000Z,2026-08-30T06:28:00.000Z</Dimension>
  </Layer></Layer></Capability>
</WMS_Capabilities>`;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("opengeo.ncep.noaa.gov")) {
          return new Response("", { status: 503 });
        }
        return new Response(nowcoast, { status: 200 });
      }),
    );

    const timeline = await fetchRadarTimeline([-96.8, 32.8], 120);
    expect(timeline.provider.id).toBe("nowcoast");
    expect(timeline.frames).toHaveLength(2);
    expect(timeline.frames[0].tileUrl).toContain("base_reflectivity_mosaic");

    const health = providerHealth();
    // What a reader is told, which is what to do about it rather than the
    // protocol's number. The number itself goes to the log on the way past,
    // which is what a bug report carries.
    expect(health.find((item) => item.id === "ridge")?.lastError).toContain(
      "is busy",
    );
    expect(health.find((item) => item.id === "nowcoast")?.frameCount).toBe(2);
  });

  it("does not label a live fallback with a failed provider's cache age", async () => {
    const nowcoast = `<?xml version="1.0"?>
<WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms">
  <Capability><Layer><Layer>
    <Name>base_reflectivity_mosaic</Name>
    <Dimension name="time" units="ISO8601">2026-08-30T06:28:00.000Z</Dimension>
  </Layer></Layer></Capability>
</WMS_Capabilities>`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("opengeo.ncep.noaa.gov")) {
          return new Response("", {
            status: 503,
            headers: { "X-OpenRadar-Age": "900" },
          });
        }
        return new Response(nowcoast, { status: 200 });
      }),
    );

    const timeline = await fetchRadarTimeline([-96.8, 32.8], 120);
    expect(timeline.provider.id).toBe("nowcoast");
    expect(timeline.cachedAgeSeconds).toBeNull();
  });

  it("does not mix an unrelated cached response into a pending timeline", async () => {
    const response = deferred<Response>();
    const fetchMock = vi.fn(() => response.promise);
    vi.stubGlobal("fetch", fetchMock);

    const timelinePromise = fetchRadarTimeline([-96.8, 32.8], 120);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    noteCachedResponse(
      new Response("", { headers: { "X-OpenRadar-Age": "1200" } }),
    );
    response.resolve(new Response(RIDGE_CAPABILITIES, { status: 200 }));

    const timeline = await timelinePromise;
    expect(timeline.provider.id).toBe("ridge");
    expect(timeline.cachedAgeSeconds).toBeNull();
  });

  it("reports every failure when no source answers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 500 })),
    );
    await expect(fetchRadarTimeline([-96.8, 32.8], 120)).rejects.toThrow(
      /RIDGE II/,
    );
  });
});

describe("request budget", () => {
  it("never lets more than the limit through inside the window", () => {
    const budget = createRollingRequestBudget(3, 1000);
    expect(budget.tryConsume(0)).toBe(true);
    expect(budget.tryConsume(100)).toBe(true);
    expect(budget.tryConsume(200)).toBe(true);
    expect(budget.tryConsume(300)).toBe(false);
    expect(budget.remaining(300)).toBe(0);
    expect(budget.tryConsume(1101)).toBe(true);
  });

  it("keeps a tile soak from starving the timeline request", async () => {
    const start = Date.UTC(2026, 7, 30, 6, 0, 0);
    let clock = start;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => clock);

    // A minute of playback at a rate no real session reaches.
    for (let second = 0; second < 60; second += 1) {
      clock = start + second * 1000;
      for (let tile = 0; tile < 60; tile += 1) {
        guardRadarRequest(
          "https://opengeo.ncep.noaa.gov/geoserver/conus/ows?bbox=1",
        );
      }
    }

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(RIDGE_CAPABILITIES, { status: 200 })),
    );
    const timeline = await fetchRadarTimeline([-96.8, 32.8], 120);
    spy.mockRestore();

    expect(timeline.provider.id).toBe("ridge");
    expect(timeline.frames).toHaveLength(3);
  });

  it("holds a ten minute tile soak inside the RIDGE budget", () => {
    const start = Date.UTC(2026, 7, 30, 6, 0, 0);
    let allowed = 0;
    let blocked = 0;
    let clock = start;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => clock);

    // Sixty tile requests a second for ten minutes, well past the ceiling.
    for (let second = 0; second < 600; second += 1) {
      clock = start + second * 1000;
      for (let tile = 0; tile < 60; tile += 1) {
        const url = guardRadarRequest(
          "https://opengeo.ncep.noaa.gov/geoserver/conus/ows?bbox=1",
        );
        if (url === BLANK_TILE_URL) blocked += 1;
        else allowed += 1;
      }
    }
    spy.mockRestore();

    expect(blocked).toBeGreaterThan(0);
    // Ten windows of 3,000 requests is the hard ceiling for the soak.
    expect(allowed).toBeLessThanOrEqual(30_000);
    expect(allowed).toBeGreaterThan(0);
  });

  it("leaves requests to other hosts alone", () => {
    expect(guardRadarRequest("https://tiles.openfreemap.org/styles/dark")).toBe(
      "https://tiles.openfreemap.org/styles/dark",
    );
  });
});

describe("RainViewer adapter", () => {
  it("normalizes, deduplicates, and sorts trusted frames", () => {
    const frames = parseRainViewerFrames({
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
    expect(frames[0].tileUrl).toBe(
      "https://tilecache.rainviewer.com/v2/radar/100/512/{z}/{x}/{y}/2/1_1.png",
    );
    expect(frames[0].tileSize).toBe(512);
  });

  it("rejects untrusted hosts and malformed paths", () => {
    expect(
      parseRainViewerFrames({
        host: "https://rainviewer.com.example.net",
        radar: { past: [{ time: 100, path: "/v2/radar/100" }] },
      }),
    ).toEqual([]);
    expect(
      parseRainViewerFrames({
        host: "https://tilecache.rainviewer.com",
        radar: { past: [{ time: 100, path: "https://example.net/tile" }] },
      }),
    ).toEqual([]);
  });
});

describe("long time intervals", () => {
  it("keeps the newest instants a long interval covers", () => {
    const document = `<?xml version="1.0"?>
<WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms">
  <Capability><Layer><Layer>
    <Name>conus_bref_qcd</Name>
    <Dimension name="time" units="ISO8601">2026-08-01T00:00:00.000Z/2026-08-30T06:00:00.000Z/PT2M</Dimension>
  </Layer></Layer></Capability>
</WMS_Capabilities>`;
    const steps = parseWmsTimeSteps(document, "conus_bref_qcd");
    expect(steps).toHaveLength(240);
    expect(steps.at(-1)?.iso).toBe("2026-08-30T06:00:00.000Z");
    // Eight hours back at two-minute steps, not the first day of the month.
    expect(steps[0].iso).toBe("2026-08-29T22:02:00.000Z");
  });
});
