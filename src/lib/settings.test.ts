import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  readSettings,
  cameraFromSearch,
  cameraKey,
  looksLikeSettings,
  normalizeSettings,
  plainStart,
  resetSettingsRecovery,
  saveSettings,
  settingsRecovery,
  restoreSettings,
  watchedPlaces,
  sameCamera,
  withPalette,
  withPaletteAssigned,
  withoutPalette,
  SCHEMA_VERSION,
} from "./settings";
import {
  MAX_PALETTES,
  activePalettes,
  assignedPalette,
  parsePalette,
  writePalette,
  type Palette,
} from "./palette";

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

  it("keeps the site loop length a whole number of volumes, one to thirty", () => {
    // A listing is asked for a count of objects, so a stored 7.5 would go to
    // the native side as a request for seven and a half volumes; and a stored
    // 0 would list nothing, which is a site with no loop and no way back to
    // one from the slider.
    expect(normalizeSettings(undefined).radar.loopVolumes).toBe(10);
    expect(
      normalizeSettings({ radar: { loopVolumes: 7.5 } }).radar.loopVolumes,
    ).toBe(8);
    expect(
      normalizeSettings({ radar: { loopVolumes: 0 } }).radar.loopVolumes,
    ).toBe(1);
    expect(
      normalizeSettings({ radar: { loopVolumes: 900 } }).radar.loopVolumes,
    ).toBe(30);
    for (const bad of ["10", null, undefined, Number.NaN]) {
      expect(
        normalizeSettings({ radar: { loopVolumes: bad } }).radar.loopVolumes,
      ).toBe(10);
    }
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

    expect(settings.schemaVersion).toBe(SCHEMA_VERSION);
    expect(settings.theme).toBe("light");
    expect(settings.mapStyle).toBe("pro-dark");
    expect(settings.radar.opacity).toBe(0.4);
    expect(settings.layers.weatherAlerts).toBe(false);
    expect(Object.keys(settings.radar).sort()).toEqual([
      "animationSpeed",
      "classificationProduct",
      "dealias",
      "enabled",
      "futureRadar",
      "live",
      "loopMinutes",
      "loopVolumes",
      "opacity",
      "persistence",
      "product",
      "singleSite",
      "smoothGrids",
      "smoothSweep",
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
      "azShear",
      "cappi",
      "classification",
      "counties",
      "customOverlay",
      "earthquakes",
      "echoTops",
      "ffgHour",
      "ffgThreeHour",
      "forecastSmoke",
      "gaugeQpe",
      "hail",
      "hailSwath",
      "isothermReflectivity",
      "lightningDensity",
      "lightningFlashes",
      "lightningForecast",
      "lightningJump",
      "metar",
      "night",
      "posh",
      "precipRate",
      "precipType",
      "probSevere",
      "qpeDay",
      "qpeHour",
      "riverGauges",
      "rotationTracks",
      "satellite",
      "shi",
      "smoke",
      "spcDiscussions",
      "spcOutlooks",
      "stormCells",
      "stormReports",
      "surge",
      "tropical",
      "unitStreamflow",
      "vii",
      "vil",
      "vilDensity",
      "weatherAlerts",
      "wildfires",
      "wind",
      "wpcExcessiveRain",
      "wpcWinterSeverity",
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
    const settings = normalizeSettings({ palettes: [loaded] });
    expect(settings.palettes).toEqual([loaded]);
  });

  it("works out the skipped list again rather than believing the stored one", () => {
    // Everything else here does round-trip: a stored table is written back out
    // as a palette file and read in again, and what comes back is what went
    // in. `skipped` is the exception, and it has to be. It is what the parser
    // noticed while reading, not a field of the table, so a stored settings
    // file cannot tell the panel that something was skipped when nothing was,
    // or hide that something was.
    //
    // The test above survives only because its fixture happens to carry both
    // the `Product:` and `Step:` lines that produce its `skipped`. Take one
    // away and the claim goes with it, which is what this pins.
    const [without] = normalizeSettings({
      palettes: [{ ...loaded, product: null, skipped: ["product", "step"] }],
    }).palettes;
    expect(without.skipped).toEqual(["step"]);

    // And a stored list nothing in the table justifies is not believed. That
    // holds because the list is worked out from the text a table is written
    // back out as, and never copied off the stored object. A normaliser that
    // went back to copying fields across, which is the shape this one
    // replaced, would pass a made-up list straight through to the panel.
    const [invented] = normalizeSettings({
      palettes: [
        {
          ...loaded,
          product: null,
          step: null,
          skipped: ["product", "step", "colour of the sky"],
        },
      ],
    }).palettes;
    expect(invented.skipped).toEqual([]);
  });

  it("is written back out by the one writer, not a copy of it", () => {
    // A stored table is re-read from its own text, and the text used to be
    // built here by a second copy of what `writePalette` does. The copy asked
    // about a stop's second colour before its solid flag and the original asks
    // about solid first, so the two would answer differently for a stop that
    // set both: one writing a blend, the other a solid. Nothing produced such
    // a stop, which is why it sat there.
    const both = {
      ...loaded,
      skipped: [],
      stops: [{ value: 5, color: "#04e9e7", solid: true, toColor: "#019ff4" }],
    };
    const [stored] = normalizeSettings({ palettes: [both] }).palettes;
    const [written] = parsePalette(
      writePalette({ ...both, name: both.name } as Palette),
      both.name,
    )!.stops;
    expect(stored.stops[0]).toEqual(written);
    // And what that agreed answer is, so this says something rather than
    // comparing two calls to the same function: solid wins, and the second
    // colour a solid stop cannot have is gone.
    expect(stored.stops[0]).toMatchObject({ solid: true, toColor: null });
  });

  it("keeps the one table an older build held, and keeps it in force", () => {
    // A build before the library had exactly one, under `palette`, and it was
    // always applied. An upgrade is not a reason to throw somebody's colour
    // scale away or to leave the map suddenly plain.
    const settings = normalizeSettings({ palette: loaded });
    expect(settings.palettes).toEqual([loaded]);
    expect(settings.paletteAssignments).toEqual({ dbz: "reflectivity.pal" });
  });

  it("holds several at once and stops at the stated ceiling", () => {
    const many = Array.from({ length: MAX_PALETTES + 4 }, (_, at) => ({
      ...loaded,
      name: `table-${at}.pal`,
    }));
    expect(normalizeSettings({ palettes: many }).palettes).toHaveLength(
      MAX_PALETTES,
    );
  });

  it("holds one table per name, whatever a hand-edited file says", () => {
    const twice = normalizeSettings({ palettes: [loaded, loaded] });
    expect(twice.palettes).toHaveLength(1);
  });

  it("drops an assignment that is not a name", () => {
    const settings = normalizeSettings({
      palettes: [loaded],
      paletteAssignments: { dBZ: "reflectivity.pal", kt: 7, mm: "" },
    });
    // The unit is lowercased so the lookup cannot miss on capitalisation.
    expect(settings.paletteAssignments).toEqual({ dbz: "reflectivity.pal" });
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
    expect(meddled.palettes[0]?.stops).toEqual([
      { value: 50, color: "#fd0000", solid: true, toColor: null },
    ]);
  });

  it("keeps a product or a unit that was not stored as text", () => {
    // Both arrive from a stored settings file, so an older build or a hand
    // edit puts a number or a one-element array where a string belongs. The
    // units are what decide which readings a table colours, so dropping them
    // for being the wrong type silently repoints the table at something else.
    const [numbered] = normalizeSettings({
      palettes: [{ ...loaded, product: 5, units: 5 }],
    }).palettes;
    expect(numbered.product).toBe("5");
    expect(numbered.units).toBe("5");
    // And reported, for the product, which is read and then not acted on.
    expect(numbered.skipped).toContain("product");

    const [listed] = normalizeSettings({
      palettes: [{ ...loaded, units: ["dBZ"] }],
    }).palettes;
    expect(listed.units).toBe("dBZ");

    // Nothing at all still means nothing, rather than "null" or "false" as
    // four characters of units.
    const [empty] = normalizeSettings({
      palettes: [{ ...loaded, product: null, units: false }],
    }).palettes;
    expect(empty.product).toBeNull();
    expect(empty.units).toBeNull();
  });

  it("is nothing when there is nothing usable in it", () => {
    expect(normalizeSettings({}).palettes).toEqual([]);
    expect(normalizeSettings({ palette: null }).palettes).toEqual([]);
    expect(normalizeSettings({ palette: "a string" }).palettes).toEqual([]);
    expect(normalizeSettings({ palette: { stops: [] } }).palettes).toEqual([]);
    expect(
      normalizeSettings({ palette: { stops: [{ value: 1 }] } }).palettes,
    ).toEqual([]);
    expect(normalizeSettings({ palettes: "not a list" }).palettes).toEqual([]);
  });
});

describe("the colour table library", () => {
  const table = (name: string, units: string) =>
    parsePalette(
      `Units: ${units}
Color: 5 4 233 231`,
      name,
    )!;

  const shelf = (...palettes: Palette[]) => ({
    ...DEFAULT_SETTINGS,
    palettes,
  });

  it("puts an imported table in force for what it says it is for", () => {
    const next = withPalette(shelf(), table("a.pal", "dBZ"))!;
    expect(next.palettes.map((one) => one.name)).toEqual(["a.pal"]);
    expect(next.paletteAssignments).toEqual({ dbz: "a.pal" });
  });

  it("replaces a table of the same name in place rather than appending", () => {
    const first = withPalette(shelf(), table("a.pal", "dBZ"))!;
    const with_b = withPalette(first, table("b.pal", "kt"))!;
    const again = withPalette(with_b, table("a.pal", "dBZ"))!;
    expect(again.palettes.map((one) => one.name)).toEqual(["a.pal", "b.pal"]);
  });

  it("refuses a new table when the shelf is full rather than dropping one", () => {
    let held = shelf();
    for (let at = 0; at < MAX_PALETTES; at += 1) {
      held = withPalette(held, table(`t${at}.pal`, "dBZ"))!;
    }
    expect(withPalette(held, table("one-more.pal", "dBZ"))).toBeNull();
    // But re-importing one already there is not a new table.
    expect(withPalette(held, table("t0.pal", "dBZ"))).not.toBeNull();
  });

  it("takes an assignment with the table it names", () => {
    const held = withPalette(shelf(), table("a.pal", "dBZ"))!;
    const gone = withoutPalette(held, "a.pal");
    expect(gone.palettes).toEqual([]);
    expect(gone.paletteAssignments).toEqual({});
  });

  it("keeps a reflectivity and a velocity table in force together", () => {
    const both = withPalette(
      withPalette(shelf(), table("r.pal", "dBZ"))!,
      table("v.pal", "kt"),
    )!;
    expect(activePalettes(both.palettes, both.paletteAssignments)).toHaveLength(
      2,
    );
    expect(
      assignedPalette(both.palettes, both.paletteAssignments, "dBZ")?.name,
    ).toBe("r.pal");
    expect(
      assignedPalette(both.palettes, both.paletteAssignments, "kt")?.name,
    ).toBe("v.pal");
  });

  it("draws nothing for a unit whose table was taken off the shelf", () => {
    const held = withPalette(shelf(), table("a.pal", "dBZ"))!;
    const gone = withoutPalette(held, "a.pal");
    expect(assignedPalette(gone.palettes, gone.paletteAssignments, "dBZ")).toBe(
      null,
    );
    expect(activePalettes(gone.palettes, gone.paletteAssignments)).toEqual([]);
  });

  it("ignores an assignment naming a table that is not on the shelf", () => {
    const held = {
      ...shelf(table("a.pal", "dBZ")),
      paletteAssignments: { dbz: "gone.pal" },
    };
    expect(assignedPalette(held.palettes, held.paletteAssignments, "dBZ")).toBe(
      null,
    );
  });

  it("takes a table out of force without taking it off the shelf", () => {
    const held = withPalette(shelf(), table("a.pal", "dBZ"))!;
    const off = withPaletteAssigned(held, "dBZ", null);
    expect(off.palettes).toHaveLength(1);
    expect(activePalettes(off.palettes, off.paletteAssignments)).toEqual([]);
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

describe("the places a reader watches", () => {
  it("keeps a well formed place and gives it an identity", () => {
    const settings = normalizeSettings({
      watchPlaces: [
        {
          id: "school",
          name: "  School  ",
          enabled: true,
          center: [-96.75, 32.8],
          radiusMiles: 15,
          minSeverity: "moderate",
          sound: true,
        },
      ],
    });
    expect(settings.watchPlaces).toHaveLength(1);
    expect(settings.watchPlaces[0].id).toBe("school");
    expect(settings.watchPlaces[0].name).toBe("School");
    expect(settings.watchPlaces[0].radiusMiles).toBe(15);
    expect(settings.watchPlaces[0].minSeverity).toBe("moderate");
    expect(settings.watchPlaces[0].sound).toBe(true);
    // Quiet hours arrive whether or not the file had them.
    expect(settings.watchPlaces[0].quietHours).toBeTruthy();
  });

  it("drops a place with nowhere to be rather than inventing one", () => {
    // A watch with no position is a notification that never fires, which is
    // worse than a place that is simply not in the list.
    const settings = normalizeSettings({
      watchPlaces: [
        { name: "Nowhere" },
        { name: "Broken", center: ["north", "west"] },
        { name: "Real", center: [-96.75, 32.8] },
      ],
    });
    expect(settings.watchPlaces.map((place) => place.name)).toEqual(["Real"]);
  });

  it("holds the list to nine, because home is the tenth", () => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      id: `place-${index}`,
      name: `Place ${index}`,
      center: [-96 - index / 100, 32 + index / 100],
    }));
    const settings = normalizeSettings({ watchPlaces: many });
    expect(settings.watchPlaces).toHaveLength(9);
    expect(watchedPlaces(settings)).toHaveLength(10);
  });

  it("re-identifies a duplicate rather than losing the place", () => {
    // Two entries with one identity is a hand-edited file, and both of them
    // are still places somebody meant to watch. Dropping one would silently
    // stop watching somewhere; giving the second its own identity keeps both
    // and keeps the invariant the list depends on.
    const settings = normalizeSettings({
      watchPlaces: [
        { id: "same", name: "First", center: [-96.7, 32.8] },
        { id: "same", name: "Second", center: [-96.6, 32.9] },
      ],
    });
    expect(settings.watchPlaces.map((place) => place.name)).toEqual([
      "First",
      "Second",
    ]);
    const [first, second] = settings.watchPlaces;
    expect(first.id).not.toBe(second.id);
  });

  it("puts home first, whatever else is in the list", () => {
    const settings = normalizeSettings({
      watch: { enabled: true, center: [-96.8, 32.78] },
      watchPlaces: [{ id: "s", name: "School", center: [-96.75, 32.8] }],
    });
    const places = watchedPlaces(settings);
    expect(places[0].id).toBe("home");
    expect(places[0].center).toEqual([-96.8, 32.78]);
    expect(places[1].name).toBe("School");
  });

  it("round-trips a list of places through a settings file", () => {
    const settings = normalizeSettings({
      watchPlaces: [
        {
          id: "school",
          name: "School",
          enabled: true,
          center: [-96.75, 32.8],
          radiusMiles: 15,
          minSeverity: "moderate",
          sound: true,
          quietHours: { enabled: true, startMinute: 1320, endMinute: 420 },
        },
      ],
    });
    const again = normalizeSettings(JSON.parse(JSON.stringify(settings)));
    expect(again.watchPlaces).toEqual(settings.watchPlaces);
  });

  it("has no places at all until somebody adds one", () => {
    expect(normalizeSettings({}).watchPlaces).toEqual([]);
    expect(DEFAULT_SETTINGS.watchPlaces).toEqual([]);
  });
});

describe("reading the settings when the store will not answer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is the difference between something to draw and something to write", async () => {
    // Two callers want opposite things from a failed read. A workspace
    // starting up wants something to draw, which is what `loadSettings`
    // answers with. A caller about to write back what it read wants to know
    // it failed: the crash screen's Reset layout reads, resets the
    // arrangement and saves, and a read failure paired with a working write
    // would have replaced the reader's watched places, colour tables, packs
    // and presets with the defaults. That is the inverse of what the button
    // promises, and it is silent.
    // On the prototype: assigning to `window.localStorage.getItem` leaves the
    // storage object's own lookup untouched in jsdom, so the throw never
    // happened and the test passed for the wrong reason.
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("no storage in this window");
    });

    await expect(readSettings()).rejects.toThrow("no storage");
    await expect(loadSettings()).resolves.toEqual(
      expect.objectContaining({ textScale: DEFAULT_SETTINGS.textScale }),
    );
  });
});

describe("a settings document that will not parse", () => {
  const LIVE = "openradar.settings";
  const PREVIOUS = "openradar.settings.previous";
  const KEPT = "openradar.settings.unreadable";

  beforeEach(() => {
    for (const key of [LIVE, PREVIOUS, KEPT]) {
      window.localStorage.removeItem(key);
    }
    resetSettingsRecovery();
  });

  /** A stored workspace with one thing in it worth losing. */
  function stored(place: string): string {
    return JSON.stringify({
      ...DEFAULT_SETTINGS,
      watchPlaces: [
        {
          id: "one",
          name: place,
          center: [-93.7, 41.7],
          radiusMiles: 30,
          minSeverity: "severe",
        },
      ],
    });
  }

  it("keeps a copy of what was there before each write", async () => {
    // The copy is the state the reader had before whatever went wrong next.
    // Taken after the write instead, it would be a copy of whatever was just
    // written, which on a bad write is the bad thing itself.
    await saveSettings(normalizeSettings(JSON.parse(stored("Casa"))));
    await saveSettings(normalizeSettings(JSON.parse(stored("Trabajo"))));
    const copy = window.localStorage.getItem(PREVIOUS);
    expect(copy).toContain("Casa");
    expect(copy).not.toContain("Trabajo");
  });

  it("puts the copy back and keeps the one it could not read", async () => {
    window.localStorage.setItem(PREVIOUS, stored("Casa"));
    // A write torn in half, which is what a power cut leaves behind.
    window.localStorage.setItem(LIVE, stored("Casa").slice(0, 40));

    const read = await readSettings();
    expect(
      read.watchPlaces.map((place) => place.name),
      "the reader's places did not come back",
    ).toEqual(["Casa"]);
    expect(settingsRecovery()).toEqual({ keptAt: KEPT, restored: true });
    expect(window.localStorage.getItem(KEPT)).toBe(stored("Casa").slice(0, 40));
    // And the live document is readable again, so the next launch is quiet.
    expect(looksLikeSettings(window.localStorage.getItem(LIVE) ?? "")).toBe(
      true,
    );
  });

  it("opens plain and says so when there is no copy to go back to", async () => {
    window.localStorage.setItem(LIVE, "{oh dear");

    const read = await readSettings();
    expect(read.watchPlaces).toEqual([]);
    expect(settingsRecovery()).toEqual({ keptAt: KEPT, restored: false });
    // Kept, because somebody who edited it by hand wants to see what they
    // wrote. Out of the way, because leaving it in place means every launch
    // from here on reads the same unreadable document.
    expect(window.localStorage.getItem(KEPT)).toBe("{oh dear");
    expect(window.localStorage.getItem(LIVE)).toBeNull();
    // Not read as a first run: their units were picked long ago and asking
    // again because a file rotted is a second thing going wrong.
    expect(read.unitsChosen).toBe(true);
  });

  it("says nothing on an ordinary load", async () => {
    // The positive control. Without it every case above passes against a
    // build that reports a recovery every time, which is its own wrong
    // answer: a toast about damaged settings on a launch where nothing
    // happened is worse than no toast at all.
    window.localStorage.setItem(LIVE, stored("Casa"));
    const read = await readSettings();
    expect(read.watchPlaces.map((place) => place.name)).toEqual(["Casa"]);
    expect(settingsRecovery()).toBeNull();
    expect(window.localStorage.getItem(KEPT)).toBeNull();
  });

  it("does not copy an unreadable document forward", async () => {
    // The write path runs on every settings change, including the first one
    // after something damaged the file. Copying that forward would put the
    // damage over the only good copy there is.
    window.localStorage.setItem(PREVIOUS, stored("Casa"));
    window.localStorage.setItem(LIVE, "not json at all");
    await saveSettings(normalizeSettings(JSON.parse(stored("Trabajo"))));
    expect(window.localStorage.getItem(PREVIOUS)).toContain("Casa");
  });
});

describe("opening plain after two starts that did not finish", () => {
  it("switches the arrangement off and keeps everything it is made of", () => {
    // Switches only. What can wedge a window is the arrangement, and what a
    // reader would have to set up again is the things it is made of: the
    // colour tables, the packs, the places. Turning one off has to be one
    // press to undo or the remedy costs more than the fault.
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      camera: { center: [-93.6, 41.6], zoom: 9, bearing: 30, pitch: 45 },
      // Keyed by the directive a theme file writes rather than the property
      // it sets: a theme whose tokens are not real ones normalises to
      // nothing, and naming the property here would trip the rule that keeps
      // those out of every file but the theme module's own.
      workspaceTheme: {
        name: "mine",
        base: "dark",
        tokens: { Accent: "#00ff00" },
      },
      occasions: { enabled: true, declined: {}, seen: {} },
      ambient: true,
      palettes: [{ name: "table", product: "reflectivity", stops: [] }],
      paletteAssignments: { reflectivity: "table" },
      watchPlaces: [
        {
          id: "one",
          name: "Casa",
          center: [-93.7, 41.7],
          radiusMiles: 30,
          minSeverity: "severe",
        },
      ],
    });

    const plain = plainStart(settings);
    expect(
      settings.workspaceTheme,
      "the fixture lost its theme",
    ).not.toBeNull();
    expect(plain.workspaceTheme).toBeNull();
    expect(plain.occasions.enabled).toBe(false);
    expect(plain.ambient).toBe(false);
    expect(plain.paletteAssignments).toEqual({});
    expect(plain.camera).toEqual(DEFAULT_SETTINGS.camera);
    // And nothing a reader built is gone with it.
    expect(plain.palettes).toEqual(settings.palettes);
    expect(plain.watchPlaces).toEqual(settings.watchPlaces);
  });

  it("leaves a workspace alone that has nothing switched on", () => {
    // The positive control: this must be a change to what was on, not a
    // reset of everything it touches.
    const plain = plainStart(normalizeSettings(DEFAULT_SETTINGS));
    expect(plain.occasions.enabled).toBe(false);
    expect(plain.watchPlaces).toEqual([]);
    expect(plain.palettes).toEqual([]);
  });
});

describe("whether the reader has picked their units", () => {
  it("starts unpicked on a workspace with nothing stored", async () => {
    // Through `readSettings`, which is the path a launch actually takes.
    // Asserting on `normalizeSettings(DEFAULT_SETTINGS)` proves nothing about
    // it: that object is the pre-hydration placeholder, and every real first
    // run hands `normalizeSettings` an `undefined` or a `null` instead, which
    // took the older-file branch and marked a brand-new install as already
    // picked. The whole feature was dead in the product and four mutation
    // proofs missed it, because none of them went through here.
    vi.spyOn(Storage.prototype, "getItem").mockReturnValue(null);
    await expect(readSettings()).resolves.toEqual(
      expect.objectContaining({ unitsChosen: false }),
    );
  });

  it("reads a stored workspace with no flag in it as picked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockReturnValue(
      JSON.stringify({ schemaVersion: 2, language: "fr", units: "imperial" }),
    );
    const read = await readSettings();
    expect(read.unitsChosen).toBe(true);
    expect(read.units).toBe("imperial");
  });

  it("reads a file written before the flag existed as picked", () => {
    // There is no way to know what an older reader meant, and flipping
    // somebody who is happy with miles the moment they change language is
    // the worse mistake of the two.
    const older = { schemaVersion: 2, language: "fr", units: "imperial" };
    expect(normalizeSettings(older).unitsChosen).toBe(true);
    expect(normalizeSettings(older).units).toBe("imperial");
  });

  it("keeps what the file says once it says something", () => {
    expect(
      normalizeSettings({ ...DEFAULT_SETTINGS, unitsChosen: true }).unitsChosen,
    ).toBe(true);
    expect(
      normalizeSettings({ ...DEFAULT_SETTINGS, unitsChosen: false })
        .unitsChosen,
    ).toBe(false);
  });
});
