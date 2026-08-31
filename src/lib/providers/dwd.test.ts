import { describe, expect, it, vi } from "vitest";
import { dwdProvider, DWD_REFLECTIVITY_RAMP } from "./dwd";
import { coverageKey, providerChain } from "./index";
import { covers } from "./types";
import { parseWmsTimeSteps } from "./wms";
import { mosaicLegend } from "../mosaicLegend";
import { legendScale } from "../legend";

/**
 * The shape the DWD's GeoServer actually publishes, cut down.
 *
 * The time dimension is an interval rather than a list of instants, which is
 * legal and is what this server does. A reader that only understood a comma
 * list would come away with no times and draw nothing at all.
 */
const CAPABILITIES = `<?xml version="1.0" encoding="UTF-8"?>
<WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms">
  <Capability>
    <Layer>
      <Title>DWD GeoServer WMS</Title>
      <Layer queryable="1">
        <Name>Radar_wn-analysis_1x1km_ger</Name>
        <Title>Deutsches Radarkomposit</Title>
        <CRS>EPSG:4326</CRS>
        <Dimension name="time" units="ISO8601" default="2026-08-31T02:15:00Z">2026-08-31T00:00:00.000Z/2026-08-31T02:15:00.000Z/PT5M</Dimension>
      </Layer>
      <Layer queryable="1">
        <Name>Radar_rv_product_1x1km_ger</Name>
        <Title>Analyse und Vorhersage</Title>
        <Dimension name="time" units="ISO8601">2026-08-31T00:00:00.000Z/2026-08-31T04:15:00.000Z/PT5M</Dimension>
        <Dimension name="REFERENCE_TIME" units="ISO8601">2026-08-31T02:15:00.000Z</Dimension>
      </Layer>
    </Layer>
  </Capability>
</WMS_Capabilities>`;

describe("reading what the DWD publishes", () => {
  it("expands the interval the service gives instead of a list", () => {
    const steps = parseWmsTimeSteps(
      CAPABILITIES,
      "Radar_wn-analysis_1x1km_ger",
    );
    // Two and a quarter hours at five minutes, ends included.
    expect(steps).toHaveLength(28);
    expect(steps[0].iso).toBe("2026-08-31T00:00:00.000Z");
    expect(steps.at(-1)?.iso).toBe("2026-08-31T02:15:00.000Z");
    // Five minutes apart, in order.
    for (let at = 1; at < steps.length; at += 1) {
      expect(steps[at].time - steps[at - 1].time).toBe(300);
    }
  });

  it("takes the observation layer and not the forecast one", () => {
    // The second layer is the same composite with two hours of extrapolation
    // on the end. That is a forecast, and it does not belong on a timeline of
    // what happened: its last instant is two hours from now.
    const observed = parseWmsTimeSteps(
      CAPABILITIES,
      "Radar_wn-analysis_1x1km_ger",
    );
    const forecast = parseWmsTimeSteps(
      CAPABILITIES,
      "Radar_rv_product_1x1km_ger",
    );
    expect(observed.at(-1)?.time).toBeLessThan(forecast.at(-1)?.time ?? 0);
    expect(dwdProvider.id).toBe("dwd");
  });

  it("asks the layer it says it does", async () => {
    const fetchMock = vi.fn(async () => new Response(CAPABILITIES, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const frames = await dwdProvider.fetchFrames(120);
      expect(frames.length).toBeGreaterThan(0);
      for (const frame of frames) {
        expect(frame.providerId).toBe("dwd");
        expect(frame.tileUrl).toContain("layers=Radar_wn-analysis_1x1km_ger");
        expect(frame.tileUrl).toContain("maps.dwd.de");
        // The map substitutes this, so it has to survive the encoding.
        expect(frame.tileUrl).toContain("{bbox-epsg-3857}");
        expect(frame.tileUrl).toContain("srs=EPSG%3A3857");
      }
      // Newest last, which is what a timeline reads.
      expect(frames.at(-1)!.time).toBeGreaterThan(frames[0].time);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("where the German composite answers", () => {
  const PLACES: Array<[string, number, number, boolean]> = [
    ["Berlin", 13.4, 52.5, true],
    ["Munich", 11.6, 48.1, true],
    ["Hamburg", 10.0, 53.55, true],
    ["Cologne", 6.96, 50.94, true],
    ["London", -0.1, 51.5, false],
    ["Madrid", -3.7, 40.4, false],
    ["Warsaw", 21.0, 52.2, false],
    ["Oklahoma City", -97.5, 35.5, false],
  ];

  it("covers Germany and stops there", () => {
    // A box drawn too wide is worse than one drawn too tight: the chain stops
    // at the first source that says yes, so claiming Madrid would mean an
    // empty map there rather than falling through to something that draws.
    for (const [place, lon, lat, inside] of PLACES) {
      expect(covers(dwdProvider, lon, lat), place).toBe(inside);
    }
  });

  it("leads over Germany, with something behind it", () => {
    // The service is offered with no availability guarantee, so it going down
    // has to mean a worse picture rather than none.
    const chain = providerChain(13.4, 52.5).map((provider) => provider.id);
    expect(chain[0]).toBe("dwd");
    expect(chain.length).toBeGreaterThan(1);
    expect(chain).toContain("rainviewer");
  });

  it("is what a viewport over Germany refetches on", () => {
    // Moving from London to Berlin has to change the key, or the map keeps
    // asking RainViewer for tiles while the panel says DWD.
    expect(coverageKey(13.4, 52.5)).not.toBe(coverageKey(-0.1, 51.5));
    expect(coverageKey(13.4, 52.5)).toContain("dwd");
    expect(coverageKey(-0.1, 51.5)).not.toContain("dwd");
    // And a pan within Germany does not.
    expect(coverageKey(13.4, 52.5)).toBe(coverageKey(11.6, 48.1));
  });

  it("does not leave RainViewer as the answer over Germany", () => {
    // The reason for the whole thing: Europe fell through to a personal-use
    // tier, and the one keyless European service with a view service is this.
    expect(providerChain(13.4, 52.5)[0].id).not.toBe("rainviewer");
  });
});

describe("the scale the German composite is painted with", () => {
  it("is reflectivity, on the service's own colours", () => {
    // The layer is titled "reflectivity in dBZ", not a rain rate, so the bar
    // has to say dBZ. It is not the American ramp: past fifty decibels the
    // DWD turns blue and then magenta, which is the German convention for
    // hail, and the tiles arrive already painted that way.
    const legend = mosaicLegend("dwd");
    expect(legend.unit).toBe("dBZ");
    expect(legend.scale).toBe("dwd-reflectivity");
    const scale = legendScale(legend.scale);
    expect(scale?.unit).toBe("dBZ");
    expect(scale?.min).toBe(DWD_REFLECTIVITY_RAMP[0][0]);
    expect(scale?.max).toBe(DWD_REFLECTIVITY_RAMP.at(-1)![0]);
    expect(scale?.ramp).toContain("legend-ramp--dwd");
    // Every labelled stop has to fall on the bar it labels.
    for (const stop of scale!.stops) {
      expect(stop).toBeGreaterThanOrEqual(scale!.min);
      expect(stop).toBeLessThanOrEqual(scale!.max);
    }
  });

  it("keeps the ramp in order and in the range it claims", () => {
    for (let at = 1; at < DWD_REFLECTIVITY_RAMP.length; at += 1) {
      expect(DWD_REFLECTIVITY_RAMP[at][0]).toBeGreaterThan(
        DWD_REFLECTIVITY_RAMP[at - 1][0],
      );
    }
    for (const [, colour] of DWD_REFLECTIVITY_RAMP) {
      expect(colour).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("does not give the German picture Canada's scale or America's", () => {
    expect(mosaicLegend("geomet").scale).toBe("rain-rate");
    expect(mosaicLegend("mrms").scale).toBe("reflectivity");
    expect(mosaicLegend("dwd").scale).not.toBe("reflectivity");
    expect(mosaicLegend("dwd").scale).not.toBe("rain-rate");
    expect(mosaicLegend(undefined).scale).toBe("reflectivity");
  });
});
