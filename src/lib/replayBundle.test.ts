import { describe, expect, it } from "vitest";
import {
  BUNDLE_MAX_ZOOM,
  BUNDLE_MIN_ZOOM,
  bundleErrorText,
  bundleMissingNote,
  bundleReplay,
  captureRequestFor,
  type BundleManifest,
} from "./replayBundle";
import type { ArchiveReplay } from "../hooks/useRadarTimeline";
import type { RadarFrame } from "./providers/types";
import type { Storm } from "./hurdat";

function frame(time: number): RadarFrame {
  return {
    providerId: "archive",
    time,
    tileUrl: `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::USCOMP-N0Q-${time}/{z}/{x}/{y}.png`,
    tileSize: 256,
    maxZoom: 9,
    attribution: "Iowa State",
  };
}

const REPLAY: ArchiveReplay = {
  id: "AL092022",
  label: "Archive radar",
  attributionUrl: "https://mesonet.agron.iastate.edu/",
  frames: [frame(1_664_380_800), frame(1_664_381_700), frame(1_664_382_600)],
  focusTime: 1_664_391_900,
};

const STORM = {
  id: "AL092022",
  name: "IAN",
  year: 2022,
  basin: "AL",
  ace: 17.47,
  peakWindKt: 140,
  start: 1_663_900_000,
  end: 1_664_600_000,
  fixes: 40,
  track: [],
  statuses: [],
} as unknown as Storm;

const BOUNDS = { west: -84, south: 25, east: -80, north: 28 };
const CAMERA = {
  center: [-82, 26.5] as [number, number],
  zoom: 7.3,
  bearing: 0,
  pitch: 0,
};

describe("what a bundle is asked to hold", () => {
  it("keeps every frame, the view at three zooms, and the warnings for the window", () => {
    const request = captureRequestFor({
      replay: REPLAY,
      storm: STORM,
      bounds: BOUNDS,
      camera: CAMERA,
      workspace: null,
    });
    expect(request).not.toBeNull();
    expect(request?.label).toBe("IAN 2022");
    expect(request?.storm).toEqual({
      id: "AL092022",
      name: "IAN",
      year: 2022,
      focusTime: 1_664_391_900,
    });
    expect(request?.window).toEqual({ from: 1_664_380_800, to: 1_664_382_600 });
    expect(request?.frames).toHaveLength(3);
    expect(request?.frames[0].tileUrl).toContain("{z}/{x}/{y}");
    // The zoom the reader was at, rounded, and one either side.
    expect(request?.minZoom).toBe(6);
    expect(request?.maxZoom).toBe(8);
    // The three interval requests and the tag feed, for the frames' own
    // window in milliseconds.
    expect(request?.extraUrls).toHaveLength(4);
    for (const url of request?.extraUrls ?? []) {
      expect(url).toContain("2022-09-28T16:30:00Z");
    }
    expect(request?.workspace).toBeNull();
    expect(request?.camera).toEqual({
      center: [-82, 26.5],
      zoom: 7.3,
      bearing: 0,
      pitch: 0,
    });
  });

  it("stays inside the zooms the archive publishes", () => {
    const low = captureRequestFor({
      replay: REPLAY,
      storm: null,
      bounds: BOUNDS,
      camera: { ...CAMERA, zoom: 2.2 },
      workspace: null,
    });
    expect(low?.minZoom).toBe(BUNDLE_MIN_ZOOM);
    expect(low?.maxZoom).toBe(3);
    const high = captureRequestFor({
      replay: REPLAY,
      storm: null,
      bounds: BOUNDS,
      camera: { ...CAMERA, zoom: 11 },
      workspace: null,
    });
    expect(high?.minZoom).toBe(8);
    expect(high?.maxZoom).toBe(BUNDLE_MAX_ZOOM);
    // Without a storm the replay's own label names it.
    expect(low?.label).toBe("Archive radar");
    expect(low?.storm).toBeNull();
  });

  it("carries the workspace only when handed one", () => {
    const backup = {
      type: "OpenRadarWorkspace" as const,
      backupVersion: 2,
      settings: {} as never,
      overlayFiles: [],
    };
    const request = captureRequestFor({
      replay: REPLAY,
      storm: STORM,
      bounds: BOUNDS,
      camera: CAMERA,
      workspace: backup,
    });
    expect(request?.workspace).toBe(backup);
  });

  it("has nothing to ask for a replay with no frames", () => {
    expect(
      captureRequestFor({
        replay: { ...REPLAY, frames: [] },
        storm: STORM,
        bounds: BOUNDS,
        camera: CAMERA,
        workspace: null,
      }),
    ).toBeNull();
  });
});

function manifest(overrides: Partial<BundleManifest> = {}): BundleManifest {
  return {
    type: "OpenRadarReplayBundle",
    bundleVersion: 1,
    app: "0.6.0",
    id: "abc123def456",
    label: "IAN 2022",
    createdAt: "2026-08-30T12:00:00+00:00",
    storm: {
      id: "AL092022",
      name: "IAN",
      year: 2022,
      focusTime: 1_664_391_900,
    },
    window: { from: 1_664_380_800, to: 1_664_382_600 },
    frames: [frame(1_664_382_600), frame(1_664_380_800), frame(1_664_381_700)],
    bounds: BOUNDS,
    zooms: [6, 7, 8],
    camera: CAMERA,
    entries: [],
    missing: [],
    workspace: null,
    ...overrides,
  };
}

describe("what an opened bundle means", () => {
  it("is a replay named for the bundle, on the storm's moment, frames in order", () => {
    const replay = bundleReplay(manifest());
    expect(replay?.id).toBe("bundle:abc123def456");
    expect(replay?.focusTime).toBe(1_664_391_900);
    expect(replay?.frames.map((frame) => frame.time)).toEqual([
      1_664_380_800, 1_664_381_700, 1_664_382_600,
    ]);
    expect(replay?.label).toBe("Replay bundle");
  });

  it("opens on the first frame when the bundle names no storm", () => {
    const replay = bundleReplay(manifest({ storm: null }));
    expect(replay?.focusTime).toBe(1_664_380_800);
  });

  it("drops a frame from a provider this build does not draw, and refuses none at all", () => {
    const odd = manifest({
      frames: [
        { ...frame(1_664_380_800), providerId: "somebody-else" },
        frame(1_664_381_700),
      ],
    });
    expect(bundleReplay(odd)?.frames).toHaveLength(1);
    expect(bundleReplay(manifest({ frames: [] }))).toBeNull();
  });

  it("says what a bundle left out", () => {
    expect(bundleMissingNote(manifest())).toBeNull();
    expect(
      bundleMissingNote(
        manifest({
          missing: [
            {
              url: "https://mesonet.agron.iastate.edu/api/1/vtec/sbw_interval.geojson?x",
              reason: "404",
            },
          ],
        }),
      ),
    ).toContain("warnings");
    expect(
      bundleMissingNote(
        manifest({
          missing: [
            {
              url: "https://mesonet.agron.iastate.edu/cache/tile.py/a/5/1/1.png",
              reason: "504",
            },
            {
              url: "https://mesonet.agron.iastate.edu/cache/tile.py/a/5/1/2.png",
              reason: "504",
            },
          ],
        }),
      ),
    ).toContain("2");
  });
});

describe("what a refusal says", () => {
  it("uses the reader's wording for a code it knows", () => {
    expect(
      bundleErrorText({ code: "newer", args: ["3"], text: "raw" }),
    ).toContain("newer OpenRadar");
    expect(bundleErrorText({ code: "notABundle", args: [] })).toContain(
      "not an OpenRadar replay bundle",
    );
  });

  it("falls back to what the native side said, then to a plain sentence", () => {
    expect(
      bundleErrorText({ code: "nobody-knows", args: [], text: "as said" }),
    ).toBe("as said");
    expect(bundleErrorText(new Error("boom"))).toBe("boom");
    expect(bundleErrorText(undefined)).toContain("could not");
  });
});
