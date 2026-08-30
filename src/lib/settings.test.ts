import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  cameraFromSearch,
  cameraKey,
  normalizeSettings,
  sameCamera,
} from "./settings";

describe("settings normalization", () => {
  it("refuses a radar site that is not a four letter call sign", () => {
    for (const station of ["kdmx", "KDMX"]) {
      expect(normalizeSettings({ radar: { station } }).radar.station).toBe(
        "KDMX",
      );
    }
    for (const station of ["", "KD", "KDMX1", "../etc", 7, null]) {
      expect(
        normalizeSettings({ radar: { station } }).radar.station,
      ).toBeNull();
    }
  });

  it("refuses a product the native side cannot decode", () => {
    expect(
      normalizeSettings({ radar: { product: "velocity" } }).radar.product,
    ).toBe("velocity");
    expect(
      normalizeSettings({ radar: { product: "composite" } }).radar.product,
    ).toBe("reflectivity");
  });

  it("keeps the observed radar defaults", () => {
    const settings = normalizeSettings(undefined);
    expect(settings.radar.opacity).toBe(0.7);
    expect(settings.radar.animationSpeed).toBe(-0.1);
    expect(settings.radar.loopMinutes).toBe(120);
    expect(settings.layers.weatherAlerts).toBe(true);
    expect(settings.layers.earthquakes).toBe(false);
  });

  it("clamps corrupt camera and radar values", () => {
    const settings = normalizeSettings({
      projection: "globe",
      camera: { center: [999, -999], zoom: 80, bearing: -900, pitch: 100 },
      radar: { opacity: -3, animationSpeed: 9, loopMinutes: 5 },
    });
    expect(settings.projection).toBe("globe");
    expect(settings.camera).toEqual({
      center: [180, -85],
      zoom: 15,
      bearing: -180,
      pitch: 75,
    });
    expect(settings.radar.opacity).toBe(0.05);
    expect(settings.radar.animationSpeed).toBe(0.5);
    expect(settings.radar.loopMinutes).toBe(60);
  });

  it("loads a schema 1 file without the switches that had no source", () => {
    const settings = normalizeSettings({
      schemaVersion: 1,
      theme: "light",
      mapStyle: "pro-dark",
      radar: {
        opacity: 0.4,
        lightning: true,
        flashes: true,
        stormCenters: true,
        precipitationClassification: true,
      },
      layers: { weatherAlerts: false, powerOutages: true, droughts: true },
    });

    expect(settings.schemaVersion).toBe(2);
    expect(settings.theme).toBe("light");
    expect(settings.mapStyle).toBe("pro-dark");
    expect(settings.radar.opacity).toBe(0.4);
    expect(settings.layers.weatherAlerts).toBe(false);
    expect(Object.keys(settings.radar).sort()).toEqual([
      "animationSpeed",
      "dealias",
      "enabled",
      "futureRadar",
      "loopMinutes",
      "opacity",
      "product",
      "singleSite",
      "station",
      "tilt",
    ]);
    // Future radar came back as a real switch, off unless the file said on.
    expect(settings.radar.futureRadar).toBe(false);
    // So did single site, and a file written before it existed gets the
    // defaults rather than an undefined the panel would have to guard.
    expect(settings.radar.singleSite).toBe(true);
    // Unfolding is on for a file that predates it: a folded sweep is wrong,
    // not a preference.
    expect(settings.radar.dealias).toBe(true);
    expect(settings.radar.station).toBeNull();
    expect(settings.radar.product).toBe("reflectivity");
    expect(settings.radar.tilt).toBe(0);
    expect(Object.keys(settings.layers).sort()).toEqual([
      "customOverlay",
      "earthquakes",
      "hail",
      "lightningDensity",
      "lightningFlashes",
      "rotationTracks",
      "satellite",
      "spcDiscussions",
      "spcOutlooks",
      "stormReports",
      "surge",
      "tropical",
      "weatherAlerts",
      "wildfires",
      "wind",
    ]);
    // The schema 1 file predates both MRMS switches, so they come back off.
    expect(settings.layers.rotationTracks).toBe(false);
    expect(settings.layers.hail).toBe(false);
    expect(settings.layers.lightningDensity).toBe(false);
    expect(settings.layers.lightningFlashes).toBe(false);
    expect(settings.layers.wind).toBe(false);
  });

  it("always returns four safe preset slots", () => {
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      presets: [{ name: "Home", camera: DEFAULT_SETTINGS.camera }],
    });
    expect(settings.presets).toHaveLength(4);
    expect(settings.presets[0]?.name).toBe("Home");
    expect(settings.presets.slice(1)).toEqual([null, null, null]);
  });

  it("keeps the saved camera when a shared-view query is absent", () => {
    expect(cameraFromSearch("", DEFAULT_SETTINGS.camera)).toEqual(
      DEFAULT_SETTINGS.camera,
    );
  });

  it("treats near-identical cameras as equal so panes stop echoing", () => {
    const base = DEFAULT_SETTINGS.camera;
    expect(sameCamera(base, { ...base })).toBe(true);
    expect(
      sameCamera(base, {
        ...base,
        center: [base.center[0] + 1e-9, base.center[1]],
      }),
    ).toBe(true);
    // The published key and the equality test must agree exactly.
    expect(cameraKey(base)).toBe(
      cameraKey({ ...base, center: [base.center[0] + 1e-9, base.center[1]] }),
    );
    expect(
      sameCamera(base, {
        ...base,
        center: [base.center[0] + 0.01, base.center[1]],
      }),
    ).toBe(false);
    expect(sameCamera(base, { ...base, zoom: base.zoom + 0.5 })).toBe(false);
    expect(sameCamera(base, { ...base, bearing: 12 })).toBe(false);
    expect(sameCamera(base, { ...base, pitch: 30 })).toBe(false);
  });

  it("loads a complete shared-view camera", () => {
    expect(
      cameraFromSearch(
        "?lon=-96.8&lat=32.8&zoom=7.25&bearing=18&pitch=42",
        DEFAULT_SETTINGS.camera,
      ),
    ).toEqual({
      center: [-96.8, 32.8],
      zoom: 7.25,
      bearing: 18,
      pitch: 42,
    });
  });
});

describe("a stored palette", () => {
  const loaded = {
    name: "reflectivity.pal",
    product: "BR",
    units: "dBZ",
    step: 5,
    stops: [
      { value: 5, color: "#04e9e7", solid: false, toColor: "#019ff4" },
      { value: 50, color: "#fd0000", solid: true, toColor: null },
    ],
    rangeFolded: "#77007d",
    // Both are kept in the object and neither changes how the map is drawn,
    // which is what the panel reports them as.
    skipped: ["product", "step"],
  };

  it("comes back the way it went in", () => {
    const settings = normalizeSettings({ palette: loaded });
    expect(settings.palette).toEqual(loaded);
  });

  it("is read again rather than trusted, so a hand-edited file cannot inject", () => {
    const meddled = normalizeSettings({
      palette: {
        ...loaded,
        // A colour that is not a colour, and a value that is not a number.
        stops: [
          { value: 5, color: "javascript:alert(1)", toColor: null },
          { value: "twenty", color: "#04e9e7", toColor: null },
          { value: 50, color: "#fd0000", solid: true, toColor: null },
        ],
      },
    });
    // Only the one stop that survives the parser.
    expect(meddled.palette?.stops).toEqual([
      { value: 50, color: "#fd0000", solid: true, toColor: null },
    ]);
  });

  it("is nothing when there is nothing usable in it", () => {
    expect(normalizeSettings({}).palette).toBeNull();
    expect(normalizeSettings({ palette: null }).palette).toBeNull();
    expect(normalizeSettings({ palette: "a string" }).palette).toBeNull();
    expect(normalizeSettings({ palette: { stops: [] } }).palette).toBeNull();
    expect(
      normalizeSettings({ palette: { stops: [{ value: 1 }] } }).palette,
    ).toBeNull();
  });
});
