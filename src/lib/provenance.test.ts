import { describe, expect, it } from "vitest";
import {
  attributionText,
  overlayProvenance,
  provenanceCredit,
  provenanceDocument,
  provenanceLines,
  provenanceProblems,
  provenanceStale,
  provenanceValid,
  radarProvenance,
  sweepProvenance,
  type Provenance,
} from "./provenance";
import { provenanceFileName } from "./export";
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

describe("a record for one volume of one radar", () => {
  const sweep = {
    station: "KDMX",
    product: "Reflectivity",
    collected: "2026-08-31T12:00:00.000Z",
    source: {
      kind: "archive" as const,
      label: "NOAA NEXRAD Level II archive",
      url: "https://registry.opendata.aws/noaa-nexrad/",
    },
  } as unknown as Parameters<typeof sweepProvenance>[0]["sweep"];

  it("is well formed and credits the archive rather than the mosaic", () => {
    const record = sweepProvenance({ sweep, fetchedAt: FETCHED_AT });
    expect(provenanceProblems(record)).toEqual([]);
    expect(record.sourceId).toBe("level2:KDMX");
    expect(record.attribution).toBe("NOAA NEXRAD Level II archive");
    expect(record.kind).toBe("observation");
    expect(record.observedAt).toBe(OBSERVED_AT);
  });

  it("takes the volume it is asked about, not the one on screen", () => {
    // The loop export captions ten volumes from the one sweep it holds. If
    // the time came off that sweep every frame of the saved loop would carry
    // the same stamp, which is the defect the walk exists to fix.
    const earlier = OBSERVED_AT - 5 * 60_000;
    const record = sweepProvenance({
      sweep,
      at: earlier,
      fetchedAt: FETCHED_AT,
    });
    expect(record.observedAt).toBe(earlier);
    expect(record.validAt).toBe(earlier);
    expect(provenanceProblems(record)).toEqual([]);
  });

  it("says how long a volume had been held rather than nothing at all", () => {
    // A loop reads its own volumes back, and the second reading is not an
    // arrival. Every frame of a saved loop used to be stamped with the moment
    // its caption was written, which for a held volume can be minutes early,
    // and to report no cache age, which this record's own type documents as
    // meaning the bytes came off the network.
    const record = sweepProvenance({
      sweep,
      at: OBSERVED_AT,
      fetchedAt: FETCHED_AT - 8 * 60_000,
      cachedAgeSeconds: 8 * 60,
    });
    expect(record.fetchedAt).toBe(FETCHED_AT - 8 * 60_000);
    expect(record.cachedAgeSeconds).toBe(8 * 60);
    expect(provenanceProblems(record)).toEqual([]);
    expect(provenanceLines(record).join("\n")).toContain("cache 480s old");
  });

  it("still says live for a volume that has just arrived", () => {
    const record = sweepProvenance({ sweep, fetchedAt: FETCHED_AT });
    expect(record.cachedAgeSeconds).toBeNull();
    expect(provenanceLines(record).join("\n")).toContain("cache live");
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

// Everything below was found by an adversarial review of the first version of
// this file on 2026-08-31. Each case passed the validator before it was fixed.
describe("what the first version of the validator let through", () => {
  it("refuses a time that is not a number, rather than throwing later", () => {
    const broken = observation({ observedAt: Number.NaN });
    expect(provenanceProblems(broken)).toContain("observedAt is not a moment.");
    // The actual failure: this used to pass every check and then throw a
    // RangeError out of the formatter, taking the diagnostics copy with it.
    expect(() => provenanceLines(broken)).not.toThrow();
  });

  it("refuses a NaN duration and a NaN cache age", () => {
    expect(
      provenanceProblems(observation({ freshForMs: Number.NaN })),
    ).toContain("freshForMs is not a duration.");
    expect(
      provenanceProblems(observation({ cachedAgeSeconds: Number.NaN })),
    ).toContain("cachedAgeSeconds is negative.");
  });

  it("makes an observation say when it is valid", () => {
    expect(provenanceProblems(observation({ validAt: null }))).toContain(
      "An observation layer must say when it is valid.",
    );
  });

  it("refuses a forecast whose valid time is not a number", () => {
    expect(provenanceProblems(forecast({ validAt: Number.NaN }))).toContain(
      "validAt is not a moment.",
    );
  });

  // A frame from the forecast tail or an archive replay is not made by
  // whichever live provider the timeline is pointed at.
  it("ignores a provider that did not make the frame", () => {
    const hrrr = {
      id: "hrrr",
      label: "HRRR",
      attribution: "Iowa State Mesonet",
      attributionUrl: "https://mesonet.agron.iastate.edu/",
    } as RadarProvider;
    const record = radarProvenance({
      frame: {
        providerId: "archive",
        time: OBSERVED_AT / 1000,
        tileUrl: "https://example.invalid/{z}/{x}/{y}.png",
        tileSize: 512,
        maxZoom: 10,
        attribution: "NOAA archive",
      },
      provider: hrrr,
      fetchedAt: FETCHED_AT,
    });
    expect(record.sourceId).toBe("archive");
    expect(record.label).not.toBe("HRRR");
    expect(record.attributionUrl).toBeUndefined();
    expect(record.attribution).toBe("NOAA archive");
  });
});

describe("the record that travels with an exported file", () => {
  const MRMS_ANCHOR =
    '<a href="https://www.nssl.noaa.gov/projects/mrms/">NOAA MRMS</a>';

  it("writes the credit as words, because a caption cannot draw a tag", () => {
    expect(attributionText(MRMS_ANCHOR)).toBe("NOAA MRMS");
    expect(
      attributionText(
        'Kartendaten: &copy; <a href="https://osm.org">OpenStreetMap</a>-Mitwirkende',
      ),
    ).toBe("Kartendaten: © OpenStreetMap-Mitwirkende");
    expect(attributionText("")).toBe("");
  });

  it("names the source that made the frame in the burned credit", () => {
    const live = provenanceCredit(
      "OpenStreetMap",
      observation({ attribution: MRMS_ANCHOR }),
    );
    expect(live).toBe("OpenRadar · OpenStreetMap · NOAA MRMS");
    // The whole point of the change: a replayed 2005 hurricane no longer
    // credits whichever live service the timeline happens to be pointed at.
    const replay = provenanceCredit(
      "OpenStreetMap",
      observation({
        sourceId: "archive",
        label: "archive",
        attribution:
          '<a href="https://mesonet.agron.iastate.edu/">Iowa State Mesonet NEXRAD archive</a>',
      }),
    );
    expect(replay).toBe(
      "OpenRadar · OpenStreetMap · Iowa State Mesonet NEXRAD archive",
    );
    expect(replay).not.toContain("NOAA");
  });

  it("still credits the map when there is no frame to credit", () => {
    expect(provenanceCredit("OpenStreetMap", null)).toBe(
      "OpenRadar · OpenStreetMap",
    );
  });

  it("carries a live frame, a forecast, and a replay in timeline order", () => {
    const document = provenanceDocument({
      picture: "openradar-loop-2026-08-31.webm",
      application: "OpenRadar 0.6.0",
      basemap: "OpenStreetMap",
      writtenAt: FETCHED_AT,
      frames: [
        // Handed over out of order, the way a GIF walks the tail first.
        { index: 4, record: forecast() },
        { index: 0, record: observation({ attribution: MRMS_ANCHOR }) },
        {
          index: 2,
          record: observation({
            sourceId: "archive",
            label: "archive",
            attribution:
              '<a href="https://mesonet.agron.iastate.edu/">Iowa State Mesonet NEXRAD archive</a>',
          }),
        },
      ],
    });

    expect(document.format).toBe("openradar-provenance");
    expect(document.formatVersion).toBe(1);
    expect(document.picture).toBe("openradar-loop-2026-08-31.webm");
    expect(document.frames.map((frame) => frame.index)).toEqual([0, 2, 4]);

    const [live, replay, ahead] = document.frames;

    expect(live.kind).toBe("observation");
    expect(live.observed).toBe("2026-08-31T12:00:00.000Z");
    expect(live.attribution).toBe("NOAA MRMS");
    // The link was only ever inside the markup for a frame no provider made,
    // and dropping it while writing a provenance file would be the one loss
    // that matters here.
    expect(live.attributionUrl).toBe(
      "https://www.nssl.noaa.gov/projects/mrms/",
    );

    expect(replay.sourceId).toBe("archive");
    expect(replay.observed).toBe("2026-08-31T12:00:00.000Z");
    expect(replay.attribution).toBe("Iowa State Mesonet NEXRAD archive");

    // A forecast has not been observed by anything, and the file says so
    // rather than borrowing the moment it was fetched.
    expect(ahead.kind).toBe("forecast");
    expect(ahead.observed).toBeNull();
    expect(ahead.modelRun?.initUtc).toBe("2026-08-31T12:00:00Z");
    expect(ahead.modelRun?.leadMinutes).toBe(60);
  });

  it("survives a round trip through JSON with no markup left in it", () => {
    const document = provenanceDocument({
      picture: "openradar.png",
      application: "OpenRadar 0.6.0",
      basemap: "OpenStreetMap",
      writtenAt: FETCHED_AT,
      frames: [{ index: 7, record: observation({ attribution: MRMS_ANCHOR }) }],
    });
    const text = JSON.stringify(document, null, 2);
    expect(text).not.toContain("<a ");
    expect(JSON.parse(text)).toEqual(document);
  });
});

describe("naming the record beside the picture", () => {
  it("keeps the picture's own name in front of it", () => {
    expect(provenanceFileName("openradar-2026-08-31.png")).toBe(
      "openradar-2026-08-31-provenance.json",
    );
    expect(provenanceFileName("openradar-loop-2026-08-31.webm")).toBe(
      "openradar-loop-2026-08-31-provenance.json",
    );
  });

  it("does not mistake a leading dot for an extension", () => {
    expect(provenanceFileName(".openradar")).toBe(".openradar-provenance.json");
  });
});
