import { describe, expect, it } from "vitest";
import { LAYER_SOURCES, layerProvenance } from "./layerProvenance";
import { provenanceProblems } from "./provenance";
import { DEFAULT_SETTINGS } from "./settings";
import { OVERLAY_ADAPTERS } from "./overlays";

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
  // The contract refuses a forecast that cannot name its run, and inventing
  // one would be worse than saying less. So the record reports what is
  // actually known: when the statement was fetched.
  it("reports what was fetched rather than claiming a model run", () => {
    const record = layerProvenance({
      layer: "tropical",
      fetchedAt: FETCHED_AT,
      observedAt: OBSERVED_AT,
    });
    expect(record.kind).toBe("observation");
    expect(record.modelRun).toBeUndefined();
    expect(provenanceProblems(record)).toEqual([]);
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

  it("gives every layer a source id of its own", () => {
    const ids = Object.values(LAYER_SOURCES).map((source) => source.sourceId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
