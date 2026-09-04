import { describe, expect, it } from "vitest";
import {
  deepLinkUrl,
  linkNamedUnknownRadar,
  viewFromDeepLink,
  webLinkUrl,
  radarFromSearch,
  sharedRadar,
} from "./deepLink";
import { DEFAULT_SETTINGS } from "./settings";

const view = {
  camera: {
    center: [-96.8, 32.78] as [number, number],
    zoom: 7.25,
    bearing: 18,
    pitch: 42,
  },
  projection: "globe" as const,
};

describe("share links", () => {
  it("writes a link the desktop app can be opened with", () => {
    expect(deepLinkUrl(view)).toBe(
      "openradar://view?lon=-96.80000&lat=32.78000&zoom=7.25&bearing=18.0&pitch=42.0&projection=globe",
    );
  });

  it("writes a plain web address for the browser preview", () => {
    expect(webLinkUrl(view, "http://127.0.0.1:1420/?old=1#frag")).toBe(
      "http://127.0.0.1:1420/?lon=-96.80000&lat=32.78000&zoom=7.25&bearing=18.0&pitch=42.0&projection=globe",
    );
  });

  it("round-trips a shared view", () => {
    const parsed = viewFromDeepLink(deepLinkUrl(view), DEFAULT_SETTINGS.camera);
    expect(parsed).toEqual({
      camera: {
        center: [-96.8, 32.78],
        zoom: 7.25,
        bearing: 18,
        pitch: 42,
      },
      projection: "globe",
    });
  });

  it("refuses anything that is not one of our view links", () => {
    const fallback = DEFAULT_SETTINGS.camera;
    expect(
      viewFromDeepLink("https://example.test/view?lon=1", fallback),
    ).toBeNull();
    expect(viewFromDeepLink("openradar://settings?lon=1", fallback)).toBeNull();
    expect(viewFromDeepLink("openradar://view", fallback)).toBeNull();
    expect(viewFromDeepLink("not a url", fallback)).toBeNull();
  });

  it("clamps a link that carries impossible numbers", () => {
    const parsed = viewFromDeepLink(
      "openradar://view?lon=999&lat=-999&zoom=80&bearing=-900&pitch=100",
      DEFAULT_SETTINGS.camera,
    );
    expect(parsed?.camera).toEqual({
      center: [180, -85],
      zoom: 15,
      bearing: -180,
      pitch: 75,
    });
    expect(parsed?.projection).toBe("mercator");
  });
});

describe("incomplete links", () => {
  const fallback = DEFAULT_SETTINGS.camera;

  it("refuses a link that is missing part of the camera", () => {
    expect(viewFromDeepLink("openradar://view?lon=-96.8", fallback)).toBeNull();
    expect(
      viewFromDeepLink("openradar://view?lon=-96.8&lat=32.8&zoom=7", fallback),
    ).toBeNull();
  });

  it("refuses a link whose numbers are not numbers", () => {
    expect(
      viewFromDeepLink(
        "openradar://view?lon=abc&lat=1&zoom=5&bearing=0&pitch=0",
        fallback,
      ),
    ).toBeNull();
    expect(
      viewFromDeepLink(
        "openradar://view?lon=&lat=1&zoom=5&bearing=0&pitch=0",
        fallback,
      ),
    ).toBeNull();
  });
});

describe("a link that carries what was drawn, not only where", () => {
  const camera = {
    center: [-93.723, 41.731] as [number, number],
    zoom: 9.5,
    bearing: 0,
    pitch: 0,
  };
  const held = {
    camera,
    projection: "mercator" as const,
    radar: {
      station: "KDMX",
      product: "velocity" as const,
      tilt: 2,
      threshold: 20,
    },
  };

  it("opens on the same site, product, tilt and threshold", () => {
    // The camera alone puts the receiver over the same ground with whatever
    // product their own workspace was on, which is a different picture of the
    // same storm.
    const read = viewFromDeepLink(deepLinkUrl(held), camera);
    expect(read?.radar).toEqual(held.radar);
  });

  it("says nothing about a radar when no site was held", () => {
    // Following whichever site the view is over belongs to the reader's
    // workspace rather than to the picture, so a link made that way must not
    // pin a site on whoever opens it.
    const link = deepLinkUrl({ camera, projection: "mercator" });
    expect(link).not.toContain("site=");
    expect(viewFromDeepLink(link, camera)?.radar).toBeUndefined();
  });

  it("still opens a link from before any of this existed", () => {
    const old =
      "openradar://view?lon=-93.72300&lat=41.73100&zoom=9.50&bearing=0.0&pitch=0.0&projection=mercator";
    const read = viewFromDeepLink(old, camera);
    expect(read).not.toBeNull();
    expect(read?.camera.zoom).toBeCloseTo(9.5, 2);
    expect(read?.radar).toBeUndefined();
    expect(linkNamedUnknownRadar(old)).toBe(false);
  });

  it("keeps the place when it cannot use the radar, and says so", () => {
    // A link naming a product this build does not know is still a link to a
    // place. Refusing the whole thing over one word would lose the camera.
    for (const bad of [
      "openradar://view?lon=-93.72300&lat=41.73100&zoom=9.50&bearing=0.0&pitch=0.0&projection=mercator&site=KDMX&product=nonsense",
      "openradar://view?lon=-93.72300&lat=41.73100&zoom=9.50&bearing=0.0&pitch=0.0&projection=mercator&site=NOTASITE&product=velocity",
    ]) {
      const read = viewFromDeepLink(bad, camera);
      expect(read).not.toBeNull();
      expect(read?.camera.zoom).toBeCloseTo(9.5, 2);
      expect(read?.radar).toBeUndefined();
      expect(linkNamedUnknownRadar(bad)).toBe(true);
    }
  });

  it("leaves out a threshold that was hiding nothing", () => {
    const link = deepLinkUrl({
      ...held,
      radar: { ...held.radar, threshold: null },
    });
    expect(link).not.toContain("threshold=");
    expect(viewFromDeepLink(link, camera)?.radar?.threshold).toBeNull();
  });

  it("refuses a tilt outside what a volume holds rather than carrying it", () => {
    const link =
      "openradar://view?lon=-93.72300&lat=41.73100&zoom=9.50&bearing=0.0&pitch=0.0&projection=mercator&site=KDMX&product=velocity&tilt=99";
    expect(viewFromDeepLink(link, camera)?.radar?.tilt).toBe(0);
    // A tilt it could not use is not a radar it could not use: the site and
    // the product are both real, so nothing is said about them.
    expect(linkNamedUnknownRadar(link)).toBe(false);
  });

  it("carries the same radar through a web link", () => {
    const link = webLinkUrl(held, "https://example.test/app");
    expect(
      viewFromDeepLink(
        link.replace("https://example.test/app", "openradar://view"),
        camera,
      )?.radar,
    ).toEqual(held.radar);
  });
});

describe("what a workspace puts into a link", () => {
  const holding = {
    enabled: true,
    singleSite: true,
    station: "KDMX",
    product: "velocity" as const,
    tilt: 2,
    thresholds: { velocity: 20, reflectivity: 5 },
  };

  it("names the product on screen, not the one the settings hold", () => {
    // A terminal radar has reflectivity, velocity and the long-range
    // picture and nothing else, so a workspace holding one with spectrum
    // width chosen draws reflectivity. The link named the choice, which sent
    // the receiver a product that radar cannot draw under the threshold of a
    // picture nobody was looking at, and the receiver's own workspace then
    // fell back to reflectivity with their own threshold on it.
    const terminal = sharedRadar({
      ...holding,
      station: "TDAL",
      product: "spectrum-width",
    });
    expect(terminal?.product).toBe("reflectivity");
    expect(terminal?.threshold).toBe(5);
    // And a product the radar does have travels as itself.
    expect(sharedRadar({ ...holding, station: "TDAL" })?.product).toBe(
      "velocity",
    );
  });

  it("says nothing when the reader is looking at the mosaic", () => {
    // Switching back to the national mosaic leaves the station set, so
    // `station` on its own is not "a site is being held": a mosaic view went
    // out as a link that pinned a site on whoever opened it, and a receiver
    // already on the mosaic had one set behind their back for the next time
    // they held anything.
    expect(sharedRadar({ ...holding, singleSite: false })).toBeUndefined();
    expect(sharedRadar({ ...holding, enabled: false })).toBeUndefined();
    expect(sharedRadar({ ...holding, station: null })).toBeUndefined();
    expect(sharedRadar(holding)).not.toBeUndefined();
  });

  it("carries no threshold for a product nothing was hidden on", () => {
    expect(
      sharedRadar({ ...holding, product: "reflectivity", thresholds: {} })
        ?.threshold,
    ).toBeNull();
  });

  it("reads the same radar back out of a plain address bar", () => {
    // The desktop build takes the link through the scheme and the browser
    // has the parameters in its own address bar. Only the camera was read
    // there, so a shared link opened the right place under whatever the
    // receiver's workspace happened to be on.
    const link = webLinkUrl(
      {
        camera: {
          center: [-93.723, 41.731],
          zoom: 9.5,
          bearing: 0,
          pitch: 0,
        },
        projection: "mercator",
        radar: sharedRadar(holding),
      },
      "https://example.test/",
    );
    expect(radarFromSearch(new URL(link).search)).toEqual({
      station: "KDMX",
      product: "velocity",
      tilt: 2,
      threshold: 20,
    });
    // And a plain address bar with nothing of the sort in it stays quiet.
    expect(radarFromSearch("?lon=-93&lat=41")).toBeUndefined();
  });
});
