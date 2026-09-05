import { describe, expect, it } from "vitest";
import {
  domainFor,
  frameLimit,
  MAX_LOOP_FRAMES,
  mrmsProvider,
  thinFrames,
  tileUrl,
} from "./mrms";
import { covers } from "./types";

describe("MRMS tiles", () => {
  it("builds a tile template the map can substitute into", () => {
    // The region leads the address, because each one is a separate grid and
    // two regions' tiles must never be served for one another.
    expect(tileUrl("http://mrms.localhost/", "composite", 1788083202)).toBe(
      "http://mrms.localhost/CONUS/composite/1788083202/{z}/{x}/{y}.png?p=0",
    );
    // The scheme is spelled differently away from Windows, and the template
    // has to follow whatever Tauri hands over.
    expect(tileUrl("mrms://localhost/", "mesh", 1)).toBe(
      "mrms://localhost/CONUS/mesh/1/{z}/{x}/{y}.png?p=0",
    );
    expect(
      tileUrl("mrms://localhost/", "composite", 1, 0, null, "HAWAII"),
    ).toBe("mrms://localhost/HAWAII/composite/1/{z}/{x}/{y}.png?p=0");
  });

  it("knows which region a place falls in", () => {
    expect(domainFor([-93.7, 41.7])?.id).toBe("CONUS");
    expect(domainFor([-149.9, 61.2])?.id).toBe("ALASKA");
    expect(domainFor([-157.8, 21.3])?.id).toBe("HAWAII");
    expect(domainFor([144.8, 13.5])?.id).toBe("GUAM");
    expect(domainFor([-66.1, 18.4])?.id).toBe("CARIB");
    // Nowhere the network publishes.
    expect(domainFor([2.35, 48.85])).toBeNull();
    expect(domainFor(undefined)).toBeNull();
  });

  it("has somewhere that unambiguously belongs to each region", () => {
    // The boxes are not quite disjoint: CONUS and Alaska share a corner
    // between 130 and 126 west above 50 north, which is open Pacific either
    // way. What has to hold is that every region is reachable, or one of them
    // would be dead code and the map would fall through to a personal-use
    // tier for everybody in it.
    const reached = new Set(
      (
        [
          [-93.7, 41.7],
          [-149.9, 61.2],
          [-157.8, 21.3],
          [144.8, 13.5],
          [-66.1, 18.4],
        ] as Array<[number, number]>
      ).map((place) => domainFor(place)?.id),
    );
    expect([...reached].sort()).toEqual([
      "ALASKA",
      "CARIB",
      "CONUS",
      "GUAM",
      "HAWAII",
    ]);
  });

  it("answers the same way twice where two regions meet", () => {
    // In the corner they share, one of them has to win and it has to be the
    // same one every time, or the map would swap grids as the view drifted.
    const corner: [number, number] = [-128, 52];
    expect(domainFor(corner)?.id).toBe(domainFor(corner)?.id);
    expect(domainFor(corner)?.id).toBe("CONUS");
  });

  it("gives a tile a new address when a colour table is loaded", () => {
    // The map caches tiles by address, so a table that is not in the address
    // would leave the old colours on screen until every tile happened to be
    // asked for again.
    const before = tileUrl("http://mrms.localhost/", "composite", 1, 0);
    const after = tileUrl("http://mrms.localhost/", "composite", 1, 3);
    expect(after).not.toBe(before);
    expect(after).toContain("p=3");
  });

  it("gives a tile a new address when more contrast is asked for", () => {
    // The grids are drawn on this machine, so more contrast is a different
    // picture rather than a different stylesheet. Without the flag in the
    // address the map would keep serving the ones it already has.
    const ordinary = tileUrl("http://mrms.localhost/", "composite", 1);
    const contrast = tileUrl(
      "http://mrms.localhost/",
      "composite",
      1,
      0,
      null,
      "CONUS",
      true,
    );
    expect(ordinary).not.toContain("hc=1");
    expect(contrast).toContain("hc=1");
    expect(contrast).not.toBe(ordinary);
  });

  it("keeps the threshold and the ramp in one address", () => {
    expect(
      tileUrl("http://mrms.localhost/", "composite", 1, 2, 35, "HAWAII", true),
    ).toBe(
      "http://mrms.localhost/HAWAII/composite/1/{z}/{x}/{y}.png?p=2&min=35&hc=1",
    );
  });

  it("keeps the smoothing in the address too", () => {
    // Every input to the picture is in the address, so neither the map's own
    // tile cache nor the native side's can serve one for the other. A tile
    // read between the cells and the same tile read at the nearest one are
    // two pictures of the same ground.
    const nearest = tileUrl("http://mrms.localhost/", "composite", 1);
    const between = tileUrl(
      "http://mrms.localhost/",
      "composite",
      1,
      0,
      null,
      "CONUS",
      false,
      null,
      true,
    );
    expect(nearest).not.toContain("smooth=1");
    expect(between).toContain("smooth=1");
    expect(between).not.toBe(nearest);
  });

  it("asks for one frame per two minutes of loop, within reason", () => {
    expect(frameLimit(120)).toBe(60);
    expect(frameLimit(60)).toBe(30);
    // Never so few that there is nothing to animate, never more than an hour.
    expect(frameLimit(2)).toBe(5);
    expect(frameLimit(600)).toBe(60);
  });
});

describe("MRMS coverage", () => {
  it("claims every region the network publishes, and nothing outside them", () => {
    // This used to be the lower forty-eight alone, and the map fell through to
    // a personal-use tier everywhere else. The other four are published on the
    // same bucket, at the same cadence, and are decoded by the same code: the
    // grid geometry comes out of the file rather than being written down here.
    expect(covers(mrmsProvider, -93.7, 41.7)).toBe(true);
    expect(covers(mrmsProvider, -122.3, 47.6)).toBe(true);
    expect(covers(mrmsProvider, -80.2, 25.8)).toBe(true);
    expect(covers(mrmsProvider, -149.9, 61.2)).toBe(true);
    expect(covers(mrmsProvider, -157.8, 21.3)).toBe(true);
    expect(covers(mrmsProvider, 144.8, 13.5)).toBe(true);
    expect(covers(mrmsProvider, -66.1, 18.4)).toBe(true);
    // And still nothing where there is no radar to read.
    expect(covers(mrmsProvider, 2.35, 48.85)).toBe(false);
    expect(covers(mrmsProvider, 151.2, -33.9)).toBe(false);
  });

  it("leads with a national grid rather than a mosaic of pictures", () => {
    expect(mrmsProvider.id).toBe("mrms");
    // Tiles are drawn on this machine, so there is no public service to spare.
    expect(mrmsProvider.tileBudgetLimit).toBeGreaterThan(10_000);
    expect(mrmsProvider.discoveryBudgetLimit).toBeLessThan(100);
  });
});

describe("thinning a long loop", () => {
  const frames = Array.from({ length: 60 }, (_, index) => index);

  it("keeps the newest frame whatever the step works out to", () => {
    for (const most of [1, 3, 7, 20, 59]) {
      expect(thinFrames(frames, most).at(-1)).toBe(59);
    }
  });

  it("never returns more than it was asked for", () => {
    for (const most of [1, 3, 7, 20, 59]) {
      expect(thinFrames(frames, most).length).toBeLessThanOrEqual(most);
    }
  });

  it("still spans the window rather than taking the newest few", () => {
    const kept = thinFrames(frames, MAX_LOOP_FRAMES);
    // Twenty frames out of sixty is one every six minutes across two hours.
    expect(kept.length).toBe(20);
    expect(kept[0]).toBe(2);
    expect(kept[1] - kept[0]).toBe(3);
    expect(kept).toEqual([...kept].sort((left, right) => left - right));
  });

  it("leaves a loop that already fits alone", () => {
    const short = [1, 2, 3];
    expect(thinFrames(short, 20)).toBe(short);
    expect(thinFrames([], 20)).toEqual([]);
  });
});
