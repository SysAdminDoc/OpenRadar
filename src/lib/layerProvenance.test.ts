import { describe, expect, it } from "vitest";
import { LAYER_SOURCES, layerProvenance } from "./layerProvenance";
import { overlayProvenance, provenanceProblems } from "./provenance";
import { DEFAULT_SETTINGS } from "./settings";
import { OVERLAY_ADAPTERS } from "./overlays";
import { MRMS_PRODUCT_IDS } from "./providers/mrms";

const FETCHED_AT = Date.parse("2026-08-31T12:01:00Z");
const OBSERVED_AT = Date.parse("2026-08-31T12:00:00Z");

describe("every layer a reader can switch on", () => {
  // The point of the table. A layer added to the switches later cannot arrive
  // without a source, a credit, and an answer to what kind of statement it is,
  // because this fails the moment the two lists disagree.
  it("has a source in the table, and the table has no layer that is not one", () => {
    const switches = Object.keys(DEFAULT_SETTINGS.layers).sort();
    const described = Object.keys(LAYER_SOURCES).sort();
    expect(described).toEqual(switches);
  });

  it("produces a record the contract accepts", () => {
    for (const layer of Object.keys(LAYER_SOURCES) as Array<
      keyof typeof LAYER_SOURCES
    >) {
      const record = layerProvenance({
        layer,
        fetchedAt: FETCHED_AT,
        observedAt: OBSERVED_AT,
      });
      expect(provenanceProblems(record), layer).toEqual([]);
    }
  });

  it("credits somebody for every layer", () => {
    for (const [layer, source] of Object.entries(LAYER_SOURCES)) {
      expect(source.attribution.trim().length, layer).toBeGreaterThan(0);
      expect(source.label.trim().length, layer).toBeGreaterThan(0);
    }
  });

  // The two products the provenance module's own comment calls derived are
  // exactly the ones that had nothing to report before this.
  it("says what was done to a derived product", () => {
    expect(LAYER_SOURCES.rotationTracks.kind).toBe("derived");
    expect(LAYER_SOURCES.rotationTracks.derivedFrom).toContain("shear");
    expect(LAYER_SOURCES.vil.derivedFrom).toContain("column");
    const record = layerProvenance({
      layer: "rotationTracks",
      fetchedAt: FETCHED_AT,
      observedAt: OBSERVED_AT,
    });
    expect(record.kind).toBe("derived");
    expect(provenanceProblems(record)).toEqual([]);
  });
});

describe("a forecast layer with no run behind it", () => {
  // It stays a forecast and says the run is unknown.
  //
  // The first version of this downgraded such a layer to an observation so the
  // record would pass the contract. That bought a valid record at the cost of
  // a true one: an SPC outlook is a statement about tomorrow, and reporting it
  // as something observed at the moment it was fetched is precisely the
  // confusion the contract exists to refuse.
  it("stays a forecast and says the run is not published", () => {
    const record = layerProvenance({
      layer: "surge",
      fetchedAt: FETCHED_AT,
      observedAt: OBSERVED_AT,
    });
    expect(record.kind).toBe("forecast");
    expect(record.runUnknown).toBe(true);
    expect(record.modelRun).toBeUndefined();
    // Nothing observed a forecast, so it must not claim a time for it.
    expect(record.observedAt).toBeNull();
    expect(provenanceProblems(record)).toEqual([]);
  });

  it("cannot both name a run and not know it", () => {
    expect(
      provenanceProblems({
        sourceId: "x",
        label: "X",
        attribution: "X",
        kind: "forecast",
        observedAt: null,
        validAt: OBSERVED_AT,
        fetchedAt: FETCHED_AT,
        freshForMs: null,
        cachedAgeSeconds: null,
        modelRun: { initUtc: "2026-08-31T12:00:00Z", leadMinutes: 60 },
        runUnknown: true,
      }),
    ).toContain("A forecast cannot both name its run and not know it.");
  });

  it("reports a forecast properly once the run is known", () => {
    const record = layerProvenance({
      layer: "wind",
      fetchedAt: FETCHED_AT,
      validAt: OBSERVED_AT + 3_600_000,
      modelRun: { initUtc: "2026-08-31T12:00:00Z", leadMinutes: 60 },
    });
    expect(record.kind).toBe("forecast");
    expect(record.observedAt).toBeNull();
    expect(record.modelRun?.leadMinutes).toBe(60);
    expect(provenanceProblems(record)).toEqual([]);
  });
});

describe("the split between the adapters and the table", () => {
  // The two lists name the same layer differently: the overlay adapter is
  // `alerts` and the switch that draws it is `weatherAlerts`. Matching the
  // switch name against the adapter names would have reported that one layer
  // twice, so the diagnostics list matches on the source id instead. This
  // holds the pairing the code relies on.
  it("gives every adapter-backed switch the adapter's own source id", () => {
    const adapters = new Set(OVERLAY_ADAPTERS.map((adapter) => adapter.id));
    const matched = Object.values(LAYER_SOURCES).filter((source) =>
      adapters.has(source.sourceId as never),
    );
    expect(matched).toHaveLength(adapters.size);
  });

  /**
   * The path the app actually takes for these layers.
   *
   * `layerProvenance` is the table's own reader and the test above uses it.
   * An adapter-backed switch never goes through it: the workspace builds
   * those records with `overlayProvenance` and skips the table's loop
   * entirely. Testing only the table meant the smoke layer's record was
   * malformed at runtime, saying "a derived layer must say what was done to
   * it", while every test here passed.
   */
  it("produces a record the contract accepts through the adapter path too", () => {
    for (const adapter of OVERLAY_ADAPTERS) {
      const described = Object.values(LAYER_SOURCES).find(
        (source) => source.sourceId === adapter.id,
      );
      const record = overlayProvenance({
        adapter,
        fetchedAt: FETCHED_AT,
        kind: described?.kind,
        derivedFrom: described?.derivedFrom,
      });
      expect(provenanceProblems(record), adapter.id).toEqual([]);
      // And it is the same statement the table makes, so the diagnostics
      // block and the ledger cannot disagree about what a layer is.
      expect(record.kind, adapter.id).toBe(described?.kind ?? "observation");
    }
  });

  it("gives every layer a source id of its own", () => {
    const ids = Object.values(LAYER_SOURCES).map((source) => source.sourceId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the MRMS layers and the grids that feed them", () => {
  // The diagnostics list looks a grid's observed time up by source id, and the
  // lookup was written with a cast that would accept a renamed id and silently
  // fall back to reporting a fabricated observation time. This holds the two
  // id spaces together instead.
  it("names a real MRMS product for every MRMS-backed layer", () => {
    const products = new Set<string>(MRMS_PRODUCT_IDS);
    const mrmsLayers = [
      "rotationTracks",
      "hail",
      "hailSwath",
      "echoTops",
      "vil",
      "precipRate",
      "qpeHour",
      "qpeDay",
      "precipType",
      "lightningDensity",
    ] as const;
    for (const layer of mrmsLayers) {
      expect(products, layer).toContain(LAYER_SOURCES[layer].sourceId);
    }
  });
});
