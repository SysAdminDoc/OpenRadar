import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  cameraFromSearch,
  cameraKey,
  looksLikeSettings,
  normalizeSettings,
  restoreSettings,
  sameCamera,
  SCHEMA_VERSION,
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

  it("keeps only bounded, path-free incident pack references", () => {
    const settings = normalizeSettings({
      incidentPacks: {
        diskLimitMb: 999_999,
        selectedId: "0123456789ABCDEF01234567",
        references: [
          {
            id: "0123456789ABCDEF01234567",
            name: "  Storm response  ",
            bounds: { west: -94, south: 40, east: -93, north: 41 },
            minZoom: 5,
            maxZoom: 10,
            bytes: 42,
            sha256: "A".repeat(64),
            attribution: "USGS The National Map",
            path: "C:\\private\\basemap.pmtiles",
          },
          {
            id: "../../outside",
            name: "Bad",
            bounds: { west: -94, south: 40, east: -93, north: 41 },
            minZoom: 5,
            maxZoom: 10,
            bytes: 42,
            sha256: "b".repeat(64),
            attribution: "USGS",
          },
        ],
      },
    });
    expect(settings.incidentPacks.diskLimitMb).toBe(32_768);
    expect(settings.incidentPacks.selectedId).toBe("0123456789abcdef01234567");
    expect(settings.incidentPacks.references).toEqual([
      {
        id: "0123456789abcdef01234567",
        name: "Storm response",
        bounds: { west: -94, south: 40, east: -93, north: 41 },
        minZoom: 5,
        maxZoom: 10,
        bytes: 42,
        sha256: "a".repeat(64),
        attribution: "USGS The National Map",
      },
    ]);
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
      "live",
      "loopMinutes",
      "opacity",
      "product",
      "singleSite",
      "station",
      "stormMotion",
      "thresholds",
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
      "echoTops",
      "hail",
      "hailSwath",
      "lightningDensity",
      "lightningFlashes",
      "precipRate",
      "probSevere",
      "qpeDay",
      "qpeHour",
      "rotationTracks",
      "satellite",
      "spcDiscussions",
      "spcOutlooks",
      "stormCells",
      "stormReports",
      "surge",
      "tropical",
      "vil",
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

describe("a settings file dropped back in", () => {
  it("tells a settings export from something to draw", () => {
    // The Upload panel takes GeoJSON, placefiles, colour tables and now this,
    // so the four have to be told apart from their contents alone.
    expect(looksLikeSettings(JSON.stringify(DEFAULT_SETTINGS))).toBe(true);
    expect(
      looksLikeSettings(
        JSON.stringify({ type: "FeatureCollection", features: [] }),
      ),
    ).toBe(false);
    expect(
      looksLikeSettings(
        JSON.stringify({ type: "Feature", schemaVersion: 2, geometry: {} }),
      ),
    ).toBe(false);
    expect(looksLikeSettings("Threshold: 5")).toBe(false);
    expect(looksLikeSettings("")).toBe(false);
    expect(looksLikeSettings("null")).toBe(false);
  });

  it("comes back through the same normalizer a stored file does", () => {
    // An exported file is hand-editable, so it is not trusted any further than
    // the settings file on disk is.
    const exported = JSON.stringify({
      ...DEFAULT_SETTINGS,
      radar: { ...DEFAULT_SETTINGS.radar, opacity: 40, tilt: -3 },
      units: "klingon",
      textScale: 900,
    });
    const restored = normalizeSettings(JSON.parse(exported));
    expect(restored.radar.opacity).toBeLessThanOrEqual(1);
    expect(restored.radar.tilt).toBeGreaterThanOrEqual(0);
    expect(restored.units).toBe("imperial");
    expect(restored.textScale).toBe(100);
  });

  it("says so when it could not take the whole file", () => {
    // A file from a newer build loads with whatever this build understands,
    // which is the right thing to do and the wrong thing to call a full
    // restore. Reporting the same sentence either way told the reader their
    // workspace was back when part of it had been dropped on the floor.
    const plain = restoreSettings(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)));
    expect(plain.fromNewerBuild).toBe(false);
    expect(plain.unread).toEqual([]);

    const newer = restoreSettings({
      ...DEFAULT_SETTINGS,
      schemaVersion: SCHEMA_VERSION + 1,
      soundscape: { alerts: true },
      lightningBuckets: 4,
    });
    expect(newer.fromNewerBuild).toBe(true);
    expect(newer.unread).toEqual(["lightningBuckets", "soundscape"]);
    // What it did understand still comes back.
    expect(newer.settings.mapStyle).toBe(DEFAULT_SETTINGS.mapStyle);
    expect(newer.settings.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("does not call an older file partial", () => {
    // Schema 1 files load whole, because everything dropped since then is
    // simply not read. Warning about them would be noise.
    const older = restoreSettings({ ...DEFAULT_SETTINGS, schemaVersion: 1 });
    expect(older.fromNewerBuild).toBe(false);
    expect(older.unread).toEqual([]);
  });

  it("reports unknown keys nested inside closed settings records", () => {
    const restored = restoreSettings({
      ...DEFAULT_SETTINGS,
      camera: { ...DEFAULT_SETTINGS.camera, terrainLock: true },
      radar: {
        ...DEFAULT_SETTINGS.radar,
        nextSweepMode: "adaptive",
        stormMotion: { speedMs: 12, fromDegrees: 90, gustBias: 4 },
      },
      layers: { ...DEFAULT_SETTINGS.layers, experimentalLayer: true },
      watch: { ...DEFAULT_SETTINGS.watch, notifyByEmail: true },
      presets: [
        {
          name: "Home",
          camera: { ...DEFAULT_SETTINGS.camera, followTerrain: true },
          projection: "mercator",
          mapStyle: "dark",
          pinned: true,
        },
      ],
    });

    expect(restored.unread).toEqual([
      "camera.terrainLock",
      "layers.experimentalLayer",
      "presets.0.camera.followTerrain",
      "presets.0.pinned",
      "radar.nextSweepMode",
      "radar.stormMotion.gustBias",
      "watch.notifyByEmail",
    ]);
  });
});

describe("quiet hours out of a settings file", () => {
  // A file written before quiet hours existed, which is every file until now.
  it("loads a file that has never heard of them", () => {
    const loaded = normalizeSettings({
      watch: { enabled: true, radiusMiles: 40 },
    });
    expect(loaded.watch.quietHours).toEqual(DEFAULT_SETTINGS.watch.quietHours);
    expect(loaded.watch.radiusMiles).toBe(40);
  });

  it("keeps a window it can read", () => {
    const loaded = normalizeSettings({
      watch: {
        quietHours: {
          enabled: true,
          startMinute: 1350,
          endMinute: 400,
          overrideSeverity: "severe",
        },
      },
    });
    expect(loaded.watch.quietHours).toEqual({
      enabled: true,
      startMinute: 1350,
      endMinute: 400,
      overrideSeverity: "severe",
    });
  });

  // A hand-edited file must not be able to reach a state where nothing can
  // ever get through, which is the one outcome that matters here.
  it("refuses a window and an override it cannot read", () => {
    const loaded = normalizeSettings({
      watch: {
        quietHours: {
          enabled: true,
          startMinute: 99_999,
          endMinute: -5,
          overrideSeverity: "nothing at all",
        },
      },
    });
    expect(loaded.watch.quietHours.startMinute).toBeGreaterThanOrEqual(0);
    expect(loaded.watch.quietHours.startMinute).toBeLessThan(1440);
    expect(loaded.watch.quietHours.endMinute).toBeGreaterThanOrEqual(0);
    expect(loaded.watch.quietHours.overrideSeverity).toBe(
      DEFAULT_SETTINGS.watch.quietHours.overrideSeverity,
    );
  });

  it("comes back through a settings file dropped in again", () => {
    const changed = {
      ...DEFAULT_SETTINGS,
      watch: {
        ...DEFAULT_SETTINGS.watch,
        quietHours: {
          enabled: true,
          startMinute: 1290,
          endMinute: 360,
          overrideSeverity: "severe" as const,
        },
      },
    };
    const restored = restoreSettings(JSON.parse(JSON.stringify(changed)));
    expect(restored.settings.watch.quietHours).toEqual(
      changed.watch.quietHours,
    );
    expect(restored.unread).not.toContain("watch.quietHours");
  });
});
