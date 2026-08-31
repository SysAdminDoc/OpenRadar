import { describe, expect, it } from "vitest";
import {
  overlayProvenance,
  provenanceLines,
  provenanceProblems,
  provenanceStale,
  provenanceValid,
  radarProvenance,
  type Provenance,
} from "./provenance";
import { OVERLAY_ADAPTERS } from "./overlays";
import type { RadarFrame, RadarProvider } from "./providers/types";

const OBSERVED_AT = Date.parse("2026-08-31T12:00:00Z");
const FETCHED_AT = Date.parse("2026-08-31T12:01:00Z");

function observation(overrides: Partial<Provenance> = {}): Provenance {
  return {
    sourceId: "mrms",
    label: "MRMS",
    attribution: "NOAA MRMS",
    kind: "observation",
    observedAt: OBSERVED_AT,
    validAt: OBSERVED_AT,
    fetchedAt: FETCHED_AT,
    freshForMs: 120_000,
    cachedAgeSeconds: null,
    ...overrides,
  };
}

function forecast(overrides: Partial<Provenance> = {}): Provenance {
  return {
    sourceId: "hrrr",
    label: "HRRR",
    attribution: "NOAA HRRR via Iowa State Mesonet",
    kind: "forecast",
    observedAt: null,
    validAt: OBSERVED_AT + 3_600_000,
    fetchedAt: FETCHED_AT,
    freshForMs: null,
    cachedAgeSeconds: null,
    modelRun: { initUtc: "2026-08-31T12:00:00Z", leadMinutes: 60 },
    ...overrides,
  };
}

describe("the provenance contract", () => {
  it("accepts a well formed observation and forecast", () => {
    expect(provenanceProblems(observation())).toEqual([]);
    expect(provenanceProblems(forecast())).toEqual([]);
    expect(provenanceValid(observation())).toBe(true);
  });

  it("refuses a record that cannot say who to credit", () => {
    expect(provenanceProblems(observation({ attribution: "  " }))).toContain(
      "attribution is empty.",
    );
    expect(provenanceProblems(observation({ sourceId: "" }))).toContain(
      "sourceId is empty.",
    );
    expect(provenanceProblems(observation({ label: "" }))).toContain(
      "label is empty.",
    );
  });

  it("refuses a record with no moment of its own", () => {
    expect(provenanceProblems(observation({ fetchedAt: 0 }))).toContain(
      "fetchedAt is not a moment.",
    );
    expect(
      provenanceProblems(observation({ fetchedAt: Number.NaN })),
    ).toContain("fetchedAt is not a moment.");
    expect(provenanceProblems(observation({ observedAt: null }))).toContain(
      "An observation layer must say when it was observed.",
    );
  });

  it("refuses nonsense durations and cache ages", () => {
    expect(provenanceProblems(observation({ freshForMs: 0 }))).toContain(
      "freshForMs is not a duration.",
    );
    expect(provenanceProblems(observation({ cachedAgeSeconds: -1 }))).toContain(
      "cachedAgeSeconds is negative.",
    );
  });

  // The confusion the type exists to prevent, tested from both directions.
  it("refuses an observation wearing a model run", () => {
    const mislabelled = observation({
      modelRun: { initUtc: "2026-08-31T12:00:00Z", leadMinutes: 60 },
    });
    expect(provenanceProblems(mislabelled)).toContain(
      "An observation layer cannot carry a model run.",
    );
  });

  it("refuses a forecast claiming something observed it", () => {
    expect(provenanceProblems(forecast({ observedAt: OBSERVED_AT }))).toContain(
      "A forecast cannot claim an observed time.",
    );
  });

  it("refuses a forecast that cannot name its run", () => {
    expect(provenanceProblems(forecast({ modelRun: undefined }))).toContain(
      "A forecast must name the run that produced it.",
    );
    expect(provenanceProblems(forecast({ validAt: null }))).toContain(
      "A forecast must say when it is valid.",
    );
  });

  it("refuses a forecast valid before its own run", () => {
    const backwards = forecast({
      validAt: Date.parse("2026-08-31T11:00:00Z"),
    });
    expect(provenanceProblems(backwards)).toContain(
      "A forecast cannot be valid before its own run.",
    );
  });

  it("refuses a run that is not a time and a lead that runs backwards", () => {
    expect(
      provenanceProblems(
        forecast({ modelRun: { initUtc: "whenever", leadMinutes: 60 } }),
      ),
    ).toContain("The model run initialisation is not a time.");
    expect(
      provenanceProblems(
        forecast({
          modelRun: { initUtc: "2026-08-31T12:00:00Z", leadMinutes: -5 },
        }),
      ),
    ).toContain("A forecast cannot lead backwards from its run.");
  });

  it("makes a derived layer say what was done to it", () => {
    const derived = observation({ kind: "derived" });
    expect(provenanceProblems(derived)).toContain(
      "A derived layer must say what was done to it.",
    );
    expect(
      provenanceProblems({ ...derived, derivedFrom: "velocity unfolded" }),
    ).toEqual([]);
  });
});

describe("freshness", () => {
  it("is stale once the source's own cadence has passed", () => {
    const record = observation({ freshForMs: 120_000 });
    expect(provenanceStale(record, FETCHED_AT + 60_000)).toBe(false);
    expect(provenanceStale(record, FETCHED_AT + 180_000)).toBe(true);
  });

  it("cannot be stale when the source publishes no cadence", () => {
    const record = observation({ freshForMs: null });
    expect(provenanceStale(record, FETCHED_AT + 86_400_000)).toBe(false);
  });
});

describe("building records from what the app already has", () => {
  const provider = {
    id: "hrrr",
    label: "HRRR",
    attribution: "Iowa State Mesonet",
    attributionUrl: "https://mesonet.agron.iastate.edu/",
  } as RadarProvider;

  function frame(overrides: Partial<RadarFrame> = {}): RadarFrame {
    return {
      providerId: "mrms",
      // Frames carry seconds, which is the conversion this builder owns.
      time: OBSERVED_AT / 1000,
      tileUrl: "https://example.invalid/{z}/{x}/{y}.png",
      tileSize: 512,
      maxZoom: 10,
      attribution: "NOAA MRMS",
      ...overrides,
    };
  }

  it("reads a past frame as an observation in milliseconds", () => {
    const record = radarProvenance({
      frame: frame(),
      provider: null,
      fetchedAt: FETCHED_AT,
    });
    expect(record.kind).toBe("observation");
    expect(record.observedAt).toBe(OBSERVED_AT);
    expect(record.modelRun).toBeUndefined();
    expect(provenanceProblems(record)).toEqual([]);
  });

  it("reads a frame that has not happened as a forecast", () => {
    const record = radarProvenance({
      frame: frame({
        providerId: "hrrr",
        time: (OBSERVED_AT + 3_600_000) / 1000,
        forecast: { initUtc: "2026-08-31T12:00:00Z", leadMinutes: 60 },
      }),
      provider,
      fetchedAt: FETCHED_AT,
    });
    expect(record.kind).toBe("forecast");
    expect(record.observedAt).toBeNull();
    expect(record.modelRun?.leadMinutes).toBe(60);
    expect(provenanceProblems(record)).toEqual([]);
  });

  it("carries the cache age a request reported", () => {
    const record = radarProvenance({
      frame: frame(),
      provider: null,
      fetchedAt: FETCHED_AT,
      cachedAgeSeconds: 420,
    });
    expect(record.cachedAgeSeconds).toBe(420);
    expect(provenanceLines(record).join("\n")).toContain("cache 420s old");
  });

  // The contract is worth nothing if the adapters shipped today cannot meet
  // it, so this holds every one of them rather than a sample.
  it("is met by every overlay adapter in the registry", () => {
    for (const adapter of OVERLAY_ADAPTERS) {
      const record = overlayProvenance({ adapter, fetchedAt: FETCHED_AT });
      expect(
        provenanceProblems(record),
        `${adapter.id} does not meet the provenance contract`,
      ).toEqual([]);
      expect(record.freshForMs).toBe(adapter.refreshMs);
    }
  });
});

describe("writing a record down", () => {
  it("names the kind, the times, and the credit", () => {
    const text = provenanceLines(observation()).join("\n");
    expect(text).toContain("MRMS (mrms) · observation");
    expect(text).toContain("observed 2026-08-31T12:00:00.000Z");
    expect(text).toContain("credit NOAA MRMS");
    expect(text).toContain("cache live");
  });

  it("says a forecast's run rather than an observed time", () => {
    const text = provenanceLines(forecast()).join("\n");
    expect(text).toContain("observed none");
    expect(text).toContain("run 2026-08-31T12:00:00Z +60 min");
  });

  it("says so when the bytes have outlived their cadence", () => {
    const text = provenanceLines(observation(), FETCHED_AT + 600_000).join(
      "\n",
    );
    expect(text).toContain("stale past its refresh");
  });
});
